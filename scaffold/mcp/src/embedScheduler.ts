/**
 * Embedding scheduler: maximizes embedding throughput with zero change to the
 * produced vectors (same model, same per-text inference semantics).
 *
 * Measured motivation (onnxruntime-node CPU):
 *  - One session cannot saturate many cores: 3 sessions x 4 threads beat
 *    1 session x 12 threads by ~2x for BOTH short and long texts.
 *  - Batching pays only for short, similar-length texts; mixed-length batches
 *    lose badly to padding (attention cost is quadratic in padded length).
 *
 * Strategy: deduplicate identical texts, measure token lengths, micro-batch
 * only short texts under a strict pad-waste bound, run everything through a
 * pool of small-thread sessions, longest work first.
 */

export type PendingText = { index: number; text: string };

/** One unique text with every entity slot index it must fill. */
export type UniqueText = { text: string; indexes: number[] };

export type MeasuredText = UniqueText & { tokens: number };

export type WorkUnit = {
  kind: "single" | "batch";
  texts: string[];
  /** Per text: the slot indexes that receive its vector. */
  members: number[][];
  maxTokens: number;
  /** Padded-compute proxy used for longest-first ordering. */
  cost: number;
};

export type SchedulerOptions = {
  /** Texts at or below this token count are eligible for micro-batching. */
  shortMaxTokens: number;
  /** Upper bound for batchSize x maxTokens of a micro-batch. */
  batchTokenBudget: number;
  /** Maximum texts per micro-batch (1 disables batching). */
  batchMaxItems: number;
  /** Maximum fraction of padded compute wasted on padding within a batch. */
  maxPadWaste: number;
};

export const DEFAULT_SCHEDULER_OPTIONS: SchedulerOptions = {
  shortMaxTokens: 128,
  batchTokenBudget: 2048,
  // Micro-batching is OFF by default: batched GEMM uses different tiling than
  // batch-of-1, which flips ~1e-6 rounding boundaries in the stored vectors
  // (measured: 76/120 rounded vectors differ; cosine impact ~1e-9). The pool
  // and dedup deliver the throughput win with byte-identical output; set
  // CORTEX_EMBED_BATCH_SIZE>1 to opt in where byte identity does not matter.
  batchMaxItems: 1,
  maxPadWaste: 0.1
};

/** Groups identical texts so each unique string is embedded exactly once. */
export function groupDuplicates(pending: PendingText[]): UniqueText[] {
  const byText = new Map<string, number[]>();
  for (const item of pending) {
    const indexes = byText.get(item.text);
    if (indexes) {
      indexes.push(item.index);
    } else {
      byText.set(item.text, [item.index]);
    }
  }
  return [...byText.entries()].map(([text, indexes]) => ({ text, indexes }));
}

function singleUnit(item: MeasuredText): WorkUnit {
  return {
    kind: "single",
    texts: [item.text],
    members: [item.indexes],
    maxTokens: item.tokens,
    cost: item.tokens * item.tokens
  };
}

function batchUnit(items: MeasuredText[]): WorkUnit {
  const maxTokens = items[items.length - 1].tokens; // items arrive sorted asc
  return {
    kind: items.length === 1 ? "single" : "batch",
    texts: items.map((item) => item.text),
    members: items.map((item) => item.indexes),
    maxTokens,
    cost: items.length * maxTokens * maxTokens
  };
}

/**
 * Packs measured texts into work units. Long texts run alone (padding-free);
 * short texts are greedily packed, ascending by length, into batches bounded
 * by token budget, item count, and a pad-waste ceiling. Units are returned
 * longest-cost-first so the pool does not end on a single long straggler.
 */
export function packWorkUnits(unique: MeasuredText[], options: SchedulerOptions): WorkUnit[] {
  if (options.batchMaxItems < 1) {
    throw new Error(`Invalid batchMaxItems: ${options.batchMaxItems}`);
  }
  const units: WorkUnit[] = [];
  const shorts: MeasuredText[] = [];

  for (const item of unique) {
    if (options.batchMaxItems > 1 && item.tokens <= options.shortMaxTokens) {
      shorts.push(item);
    } else {
      units.push(singleUnit(item));
    }
  }

  shorts.sort((a, b) => a.tokens - b.tokens);
  let current: MeasuredText[] = [];
  let currentSum = 0;

  const flush = () => {
    if (current.length > 0) {
      units.push(batchUnit(current));
      current = [];
      currentSum = 0;
    }
  };

  for (const item of shorts) {
    if (current.length > 0) {
      const nextCount = current.length + 1;
      const nextMax = item.tokens; // ascending order: the newcomer is the max
      const paddedCompute = nextCount * nextMax;
      const padWaste = (paddedCompute - (currentSum + item.tokens)) / paddedCompute;
      if (
        nextCount > options.batchMaxItems ||
        paddedCompute > options.batchTokenBudget ||
        padWaste > options.maxPadWaste
      ) {
        flush();
      }
    }
    current.push(item);
    currentSum += item.tokens;
  }
  flush();

  return units.sort((a, b) => b.cost - a.cost);
}

export type PoolConfig = { sessions: number; threadsPerSession: number };

/**
 * Chooses the session-pool shape from a total thread budget. Four threads per
 * session is the measured sweet spot; tiny workloads skip the pool to avoid
 * paying several model loads for seconds of inference.
 */
export function resolvePoolConfig({
  threadBudget,
  poolOverride,
  uniqueCount
}: {
  threadBudget: number;
  poolOverride?: number | null;
  uniqueCount: number;
}): PoolConfig {
  const budget = Number.isFinite(threadBudget) && threadBudget >= 1 ? Math.floor(threadBudget) : 1;
  if (poolOverride && Number.isFinite(poolOverride) && poolOverride >= 1) {
    // The override never exceeds the thread budget: CORTEX_EMBED_THREADS is a
    // contract for co-located instances. Hard upper clamp keeps model-copy
    // memory bounded even on huge machines.
    const sessions = Math.max(1, Math.min(Math.floor(poolOverride), budget, 8));
    return { sessions, threadsPerSession: Math.max(1, Math.floor(budget / sessions)) };
  }
  if (uniqueCount < 64) {
    return { sessions: 1, threadsPerSession: budget };
  }
  const threadsPerSession = Math.min(4, budget);
  const sessions = Math.min(4, Math.max(1, Math.floor(budget / threadsPerSession)));
  return { sessions, threadsPerSession };
}

export function toEmbeddingVector(output: unknown): number[] {
  if (!output || typeof output !== "object") {
    throw new Error("Invalid embedding output type");
  }
  const data = (output as { data?: unknown }).data;
  if (!data || typeof (data as ArrayLike<number>).length !== "number") {
    throw new Error("Missing embedding data");
  }
  return Array.from(data as ArrayLike<number>).map((value) => Number(value));
}

/** Splits a batched [batch, dim] feature-extraction output into row vectors. */
export function sliceBatchVectors(output: unknown, batchLength: number): number[][] {
  const flat = toEmbeddingVector(output);
  if (batchLength < 1) {
    throw new Error(`Invalid batch length: ${batchLength}`);
  }
  const dims = (output as { dims?: unknown }).dims;
  const lastDim =
    Array.isArray(dims) && dims.length > 0 && typeof dims[dims.length - 1] === "number"
      ? Number(dims[dims.length - 1])
      : null;
  const dimensions = lastDim && lastDim > 0 ? lastDim : flat.length / batchLength;
  if (!Number.isInteger(dimensions) || dimensions < 1 || flat.length !== dimensions * batchLength) {
    throw new Error(
      `Batched embedding output shape mismatch: ${flat.length} values for ${batchLength} inputs`
    );
  }
  const vectors: number[][] = [];
  for (let row = 0; row < batchLength; row += 1) {
    vectors.push(flat.slice(row * dimensions, (row + 1) * dimensions));
  }
  return vectors;
}

export type EmbedExtractor = (
  texts: string | string[],
  options: { pooling: "mean"; normalize: boolean }
) => Promise<unknown>;

export type ScheduleResult = {
  vectors: Map<number, number[]>;
  failures: Array<{ index: number; message: string }>;
};

export type RunOptions = {
  /**
   * Maximum padded tokens in flight across all lanes. Long-sequence
   * activations are large (attention memory grows quadratically), and several
   * concurrent 8k-token inferences can OOM the process — measured, not
   * theoretical. The gate serializes giant units while short work keeps every
   * lane busy. Default keeps roughly one 8k giant plus a stream of shorts.
   */
  maxInFlightTokens?: number;
  onUnitDone?: (unit: WorkUnit) => void;
};

export const DEFAULT_MAX_IN_FLIGHT_TOKENS = 12288;

/**
 * Executes work units across a pool of extractors via promise lanes (ORT
 * inference releases the JS thread, so sessions genuinely run concurrently).
 * A failed batch is retried per item; a failed text records a failure for
 * every slot index it owns. Vectors for deduplicated texts are shared
 * (callers must not mutate them in place).
 */
export async function runWorkUnits(
  units: WorkUnit[],
  extractors: EmbedExtractor[],
  options: RunOptions = {}
): Promise<ScheduleResult> {
  if (extractors.length === 0) {
    throw new Error("runWorkUnits requires at least one extractor");
  }
  for (const unit of units) {
    if (!Number.isFinite(unit.maxTokens) || unit.maxTokens < 1) {
      throw new Error(`Work unit has invalid maxTokens: ${unit.maxTokens}`);
    }
  }
  const maxInFlight = options.maxInFlightTokens ?? DEFAULT_MAX_IN_FLIGHT_TOKENS;
  const onUnitDone = options.onUnitDone;
  const vectors = new Map<number, number[]>();
  const failures: Array<{ index: number; message: string }> = [];

  const assign = (members: number[], vector: number[]) => {
    for (const index of members) {
      vectors.set(index, vector);
    }
  };
  const recordFailure = (members: number[], error: unknown) => {
    const message = error instanceof Error ? error.message : "embedding generation failed";
    for (const index of members) {
      failures.push({ index, message });
    }
  };

  const embedSingle = async (extractor: EmbedExtractor, text: string, members: number[]) => {
    try {
      const output = await extractor(text, { pooling: "mean", normalize: true });
      const vector = toEmbeddingVector(output);
      if (vector.length === 0) {
        throw new Error("Empty embedding vector");
      }
      assign(members, vector);
    } catch (error) {
      recordFailure(members, error);
    }
  };

  const runUnit = async (extractor: EmbedExtractor, unit: WorkUnit) => {
    if (unit.texts.length === 1) {
      await embedSingle(extractor, unit.texts[0], unit.members[0]);
      return;
    }
    try {
      const output = await extractor(unit.texts, { pooling: "mean", normalize: true });
      const rows = sliceBatchVectors(output, unit.texts.length);
      unit.texts.forEach((_, row) => {
        const vector = rows[row];
        if (!vector || vector.length === 0) {
          recordFailure(unit.members[row], new Error("Empty embedding vector"));
          return;
        }
        assign(unit.members[row], vector);
      });
    } catch {
      // Batch-level failure: isolate the poison input by retrying singly.
      for (let row = 0; row < unit.texts.length; row += 1) {
        await embedSingle(extractor, unit.texts[row], unit.members[row]);
      }
    }
  };

  // Work distribution with a memory gate: a lane takes the next unit only
  // when its padded token mass fits the in-flight budget; otherwise it scans
  // for the first smaller unit that does (longest-first order means smaller
  // work is always further down the list). Single-threaded JS makes the
  // take-then-increment bookkeeping race-free.
  const taken = new Array<boolean>(units.length).fill(false);
  let inFlight = 0;
  let waiters: Array<() => void> = [];

  const unitTokens = (unit: WorkUnit) => unit.texts.length * unit.maxTokens;

  const takeNext = (): number | null => {
    for (let i = 0; i < units.length; i += 1) {
      if (taken[i]) {
        continue;
      }
      // Normal admission: the unit fits the remaining budget. Oversized
      // units (larger than the whole budget) run exclusively: they may only
      // start when nothing is in flight, and their token mass then blocks
      // every other unit until they release. This keeps one giant from
      // silently disabling the gate for the rest of the run.
      const tokens = unitTokens(units[i]);
      if (inFlight + tokens <= maxInFlight || inFlight === 0) {
        taken[i] = true;
        inFlight += tokens;
        return i;
      }
    }
    return null;
  };
  const remaining = () => taken.some((t) => !t);
  const release = (unit: WorkUnit) => {
    inFlight -= unitTokens(unit);
    const wake = waiters;
    waiters = [];
    for (const resolve of wake) {
      resolve();
    }
  };

  const lanes = extractors.map(async (extractor) => {
    while (remaining()) {
      const index = takeNext();
      if (index === null) {
        // Budget exhausted by other lanes' in-flight work: wait for a release.
        if (inFlight === 0) {
          return; // nothing in flight and nothing fits: defensive exit
        }
        await new Promise<void>((resolve) => waiters.push(resolve));
        continue;
      }
      const unit = units[index];
      try {
        await runUnit(extractor, unit);
      } finally {
        release(unit);
      }
      if (onUnitDone) {
        onUnitDone(unit);
      }
    }
  });
  await Promise.all(lanes);

  // Defensive: a unit that no lane ever took (cannot happen with the
  // exclusive-admission rule, but silent loss would be worse than noise).
  units.forEach((unit, index) => {
    if (!taken[index]) {
      for (const members of unit.members) {
        recordFailure(members, new Error("work unit was never scheduled"));
      }
    }
  });

  failures.sort((a, b) => a.index - b.index);
  return { vectors, failures };
}
