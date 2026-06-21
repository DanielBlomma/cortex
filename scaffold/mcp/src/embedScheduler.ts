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
 * Usable memory for embedding work, from raw OS/process signals:
 * - container limits (cgroups) cap everything: os.totalmem()/freemem() see
 *   the HOST, which would size pools/gates dangerously large inside a
 *   limited container;
 * - "free" memory understates reality on platforms that count reclaimable
 *   cache as used (macOS reports ~0.5GB free on an idle 24GB laptop), so it
 *   is floored at a fraction of the effective total;
 * - never plan beyond half of the effective total.
 */
export function resolveMemoryHeadroom({
  freeMemory,
  totalMemory,
  constrainedMemory,
  availableMemory
}: {
  freeMemory: number;
  totalMemory: number;
  constrainedMemory?: number | null;
  availableMemory?: number | null;
}): number {
  const total = Number.isFinite(totalMemory) && totalMemory > 0 ? totalMemory : 8e9;
  const limit =
    Number.isFinite(constrainedMemory ?? NaN) && (constrainedMemory as number) > 0
      ? (constrainedMemory as number)
      : Infinity;
  const effectiveTotal = Math.min(total, limit);
  const free = Number.isFinite(freeMemory) && freeMemory >= 0 ? freeMemory : 0;
  const available =
    Number.isFinite(availableMemory ?? NaN) && (availableMemory as number) > 0
      ? (availableMemory as number)
      : free;
  return Math.min(effectiveTotal * 0.5, Math.max(available, effectiveTotal * 0.375));
}

/** Sanitizes a tokenizer-reported maximum sequence length. Sentinel and
 * absurd values (some configs report 1e30) fall back to 8192; anything
 * beyond 128k tokens is treated as absurd. */
export function resolveModelMaxTokens(raw: unknown, overrideRaw?: unknown): number {
  const value = Number(raw);
  const modelMax = Number.isFinite(value) && value >= 1 && value <= 131072 ? Math.floor(value) : 8192;
  const override = Number(overrideRaw);
  if (Number.isFinite(override) && override >= 16 && override <= 131072) {
    return Math.min(modelMax, Math.floor(override));
  }
  return modelMax;
}

export type TokenBudgetChoice = {
  cap: number | null;
  mode: "auto" | "auto_degraded" | "explicit" | "model";
  reason: string;
};

/**
 * Chooses the requested embedding token budget before model load, so cache
 * signatures can include the same cap that inference will later enforce.
 * Auto mode is quality-preserving: it uses the model's own maximum by default
 * and only truncates when the user explicitly requests a numeric cap.
 */
export function resolveTokenBudgetChoice(overrideRaw: unknown, uniqueCount: number): TokenBudgetChoice {
  const raw = String(overrideRaw ?? "").trim().toLowerCase();
  const override = Number(raw);
  if (Number.isFinite(override) && override >= 16 && override <= 131072) {
    const cap = Math.floor(override);
    return { cap, mode: "explicit", reason: "env_override" };
  }

  if (raw === "model" || raw === "none" || raw === "off" || raw === "full") {
    return { cap: null, mode: "model", reason: "env_full_model" };
  }

  const count = Number.isFinite(uniqueCount) && uniqueCount > 0 ? Math.floor(uniqueCount) : 0;
  return {
    cap: null,
    mode: "auto",
    reason: `quality_preserving_model_max:unique=${count}`
  };
}

const AUTO_TOKEN_BUDGET_CANDIDATES = [8192, 4096, 2048];
const AUTO_TOKEN_BUDGET_MIN = 2048;
const AUTO_TOKEN_BUDGET_SESSION_BYTES = 2.4e9;
const AUTO_TOKEN_BUDGET_ACTIVATION_BYTES_AT_4096 = 3e9;
const AUTO_TOKEN_BUDGET_MEMORY_MARGIN = 0.95;

function estimateTokenBudgetMemoryBytes(maxTokens: number, sessions: number): number {
  const sessionCount = Number.isFinite(sessions) && sessions >= 1 ? Math.floor(sessions) : 1;
  const tokenCount = Number.isFinite(maxTokens) && maxTokens >= 1 ? Math.floor(maxTokens) : 8192;
  const activationBytes =
    AUTO_TOKEN_BUDGET_ACTIVATION_BYTES_AT_4096 * Math.pow(tokenCount / 4096, 2);
  return sessionCount * AUTO_TOKEN_BUDGET_SESSION_BYTES + activationBytes;
}

/**
 * Keeps auto quality-first but avoids choosing a token budget that is likely
 * to OOM this process. Explicit numeric caps and explicit full-model modes are
 * operator choices and are never degraded here.
 */
export function resolveEffectiveTokenBudget({
  choice,
  modelMaxTokens,
  memoryBytes,
  sessions
}: {
  choice: TokenBudgetChoice;
  modelMaxTokens: number;
  memoryBytes?: number;
  sessions?: number;
}): TokenBudgetChoice {
  if (choice.mode !== "auto" || choice.cap !== null) {
    return choice;
  }
  const modelMax =
    Number.isFinite(modelMaxTokens) && modelMaxTokens >= 1 ? Math.floor(modelMaxTokens) : 8192;
  if (modelMax <= AUTO_TOKEN_BUDGET_MIN) {
    return choice;
  }
  if (!Number.isFinite(memoryBytes) || (memoryBytes as number) <= 0) {
    return choice;
  }

  const available = (memoryBytes as number) * AUTO_TOKEN_BUDGET_MEMORY_MARGIN;
  const candidates = AUTO_TOKEN_BUDGET_CANDIDATES
    .filter((candidate) => candidate <= modelMax)
    .sort((a, b) => b - a);
  if (!candidates.includes(AUTO_TOKEN_BUDGET_MIN)) {
    candidates.push(AUTO_TOKEN_BUDGET_MIN);
  }

  const selected =
    candidates.find((candidate) => estimateTokenBudgetMemoryBytes(candidate, sessions ?? 1) <= available) ??
    AUTO_TOKEN_BUDGET_MIN;

  if (selected >= modelMax) {
    return choice;
  }

  return {
    cap: selected,
    mode: "auto_degraded",
    reason: `memory_headroom cap=${selected} model_max=${modelMax} sessions=${Math.max(
      1,
      Math.floor(sessions ?? 1)
    )} headroom_mb=${Math.round((memoryBytes as number) / 1024 / 1024)}`
  };
}

/**
 * Builds a token counter from a tokenizer callable. Falls back to a
 * chars/4 estimate when the tokenizer is unavailable, misbehaves, or
 * returns an unexpected shape; always clamps at the model maximum, since
 * inference truncates there anyway.
 */
export function createTokenCounter(
  tokenizer: unknown,
  modelMaxTokens: number
): (text: string) => number {
  return (text: string): number => {
    let tokens = Math.max(1, Math.ceil(text.length / 4));
    try {
      if (typeof tokenizer === "function") {
        const encoded = (tokenizer as (t: string) => { input_ids?: { dims?: number[] } })(text);
        const dims = encoded?.input_ids?.dims;
        const last = Array.isArray(dims) ? Number(dims[dims.length - 1]) : NaN;
        if (Number.isFinite(last) && last > 0) {
          tokens = last;
        }
      }
    } catch {
      // keep the character estimate
    }
    return Math.min(tokens, modelMaxTokens);
  };
}

export function truncateTextToTokenBudget(
  text: string,
  countTokens: (text: string) => number,
  maxTokens: number
): string {
  if (!Number.isFinite(maxTokens) || maxTokens < 1 || countTokens(text) <= maxTokens) {
    return text;
  }

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (countTokens(text.slice(0, mid)) <= maxTokens) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return text.slice(0, low).trimEnd();
}

/** Estimated working memory one full pool session needs (model copy plus
 * inference activations for a base-size model). Used only as a derating
 * heuristic; deliberately conservative. */
const BYTES_PER_SESSION_ESTIMATE = 3e9;

/**
 * Chooses the session-pool shape from a total thread budget and available
 * memory. Four threads per session is the measured sweet spot; the session
 * count derates on low-memory machines (each session holds its own model
 * copy); tiny workloads skip the pool to avoid paying several model loads
 * for seconds of inference. Everything is derived from the machine — no
 * user configuration expected.
 */
export function resolvePoolConfig({
  threadBudget,
  poolOverride,
  uniqueCount,
  memoryBytes
}: {
  threadBudget: number;
  poolOverride?: number | null;
  uniqueCount: number;
  memoryBytes?: number;
}): PoolConfig {
  const budget = Number.isFinite(threadBudget) && threadBudget >= 1 ? Math.floor(threadBudget) : 1;
  const memorySessionCap =
    Number.isFinite(memoryBytes) && (memoryBytes as number) > 0
      ? Math.max(1, Math.floor((memoryBytes as number) / BYTES_PER_SESSION_ESTIMATE))
      : 4;
  if (poolOverride && Number.isFinite(poolOverride) && poolOverride >= 1) {
    // The override never exceeds the thread budget: CORTEX_EMBED_THREADS is a
    // contract for co-located instances. Hard upper clamp keeps model-copy
    // memory bounded even on huge machines. Deliberately NOT memory-derated:
    // the explicit override is the operator's escape hatch when the
    // heuristics misjudge a machine.
    const sessions = Math.max(1, Math.min(Math.floor(poolOverride), budget, 8));
    return { sessions, threadsPerSession: Math.max(1, Math.floor(budget / sessions)) };
  }
  if (uniqueCount < 64) {
    return { sessions: 1, threadsPerSession: budget };
  }
  const threadsPerSession = Math.min(4, budget);
  const sessions = Math.min(
    4,
    memorySessionCap,
    Math.max(1, Math.floor(budget / threadsPerSession))
  );
  return { sessions, threadsPerSession };
}

/** Estimated activation memory per padded token for a base-size model at
 * full context (linearized from a measured ~3GB per 8k-token inference;
 * overcharges short texts, which is the safe direction). */
const BYTES_PER_IN_FLIGHT_TOKEN = 366_000;

/**
 * Adapts the concurrent-token gate to the machine: enough budget to overlap
 * several long texts when memory allows, never less than one model-max unit
 * (so the largest possible text can always run), never more than eight.
 */
export function resolveInFlightTokens({
  memoryBytes,
  modelMaxTokens
}: {
  memoryBytes?: number;
  modelMaxTokens: number;
}): number {
  const maxUnit = Number.isFinite(modelMaxTokens) && modelMaxTokens >= 1 ? Math.floor(modelMaxTokens) : 8192;
  if (!Number.isFinite(memoryBytes) || (memoryBytes as number) <= 0) {
    return Math.max(DEFAULT_MAX_IN_FLIGHT_TOKENS, maxUnit);
  }
  const affordable = Math.floor((memoryBytes as number) / BYTES_PER_IN_FLIGHT_TOKEN);
  return Math.min(Math.max(affordable, maxUnit), 8 * maxUnit);
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
  onVector?: (index: number, vector: number[]) => void;
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
  const vectors = new Map<number, number[]>();
  const failures: Array<{ index: number; message: string }> = [];

  const assign = (members: number[], vector: number[]) => {
    for (const index of members) {
      if (options.onVector) {
        options.onVector(index, vector);
      } else {
        vectors.set(index, vector);
      }
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
  let untakenCount = units.length;
  let scanHead = 0; // first possibly-untaken index; avoids O(U^2) rescans
  let inFlight = 0;
  let waiters: Array<() => void> = [];

  const unitTokens = (unit: WorkUnit) => unit.texts.length * unit.maxTokens;

  const takeNext = (): number | null => {
    while (scanHead < units.length && taken[scanHead]) {
      scanHead += 1;
    }
    for (let i = scanHead; i < units.length; i += 1) {
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
        untakenCount -= 1;
        inFlight += tokens;
        return i;
      }
    }
    return null;
  };
  const remaining = () => untakenCount > 0;
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
