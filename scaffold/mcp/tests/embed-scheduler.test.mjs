import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SCHEDULER_OPTIONS,
  groupDuplicates,
  packWorkUnits,
  resolvePoolConfig,
  runWorkUnits,
  sliceBatchVectors
} from "../dist/embedScheduler.js";

function measured(text, tokens, indexes) {
  return { text, tokens, indexes };
}

function fakeTensor(rows) {
  return { dims: [rows.length, rows[0]?.length ?? 0], data: Float32Array.from(rows.flat()) };
}

// ─── dedup ───────────────────────────────────────────────────────────────────

test("groupDuplicates: identical texts share one unique entry with all indexes", () => {
  const unique = groupDuplicates([
    { index: 0, text: "same" },
    { index: 3, text: "other" },
    { index: 7, text: "same" }
  ]);
  assert.equal(unique.length, 2);
  const same = unique.find((u) => u.text === "same");
  assert.deepEqual(same.indexes, [0, 7]);
});

// ─── packing ─────────────────────────────────────────────────────────────────

test("packWorkUnits: long texts become singles, shorts are batched", () => {
  const units = packWorkUnits(
    [
      measured("long", 4000, [0]),
      measured("s1", 20, [1]),
      measured("s2", 21, [2]),
      measured("s3", 22, [3])
    ],
    DEFAULT_SCHEDULER_OPTIONS
  );
  const single = units.find((u) => u.texts.includes("long"));
  assert.equal(single.kind, "single");
  const batch = units.find((u) => u.kind === "batch");
  assert.deepEqual(batch.texts.sort(), ["s1", "s2", "s3"]);
});

test("packWorkUnits: respects the pad-waste bound", () => {
  // 10-token and 100-token texts in one batch would waste 45% padding.
  const units = packWorkUnits(
    [measured("tiny", 10, [0]), measured("bigger", 100, [1])],
    { ...DEFAULT_SCHEDULER_OPTIONS, shortMaxTokens: 128 }
  );
  assert.equal(units.length, 2);
  assert.ok(units.every((u) => u.texts.length === 1));
});

test("packWorkUnits: respects token budget and max items", () => {
  const many = Array.from({ length: 100 }, (_, i) => measured(`t${i}`, 64, [i]));
  const units = packWorkUnits(many, {
    ...DEFAULT_SCHEDULER_OPTIONS,
    batchTokenBudget: 64 * 8,
    batchMaxItems: 8
  });
  assert.ok(units.every((u) => u.texts.length <= 8));
  assert.ok(units.every((u) => u.texts.length * u.maxTokens <= 64 * 8));
  const total = units.reduce((acc, u) => acc + u.texts.length, 0);
  assert.equal(total, 100);
});

test("packWorkUnits: batchMaxItems=1 disables batching entirely", () => {
  const units = packWorkUnits(
    [measured("a", 10, [0]), measured("b", 11, [1])],
    { ...DEFAULT_SCHEDULER_OPTIONS, batchMaxItems: 1 }
  );
  assert.ok(units.every((u) => u.kind === "single"));
});

test("packWorkUnits: orders units by descending cost", () => {
  const units = packWorkUnits(
    [measured("small", 10, [0]), measured("huge", 5000, [1]), measured("mid", 500, [2])],
    DEFAULT_SCHEDULER_OPTIONS
  );
  const costs = units.map((u) => u.cost);
  assert.deepEqual(costs, [...costs].sort((a, b) => b - a));
  assert.equal(units[0].texts[0], "huge");
});

// ─── pool config ─────────────────────────────────────────────────────────────

test("resolvePoolConfig: splits the budget into 4-thread sessions", () => {
  assert.deepEqual(resolvePoolConfig({ threadBudget: 12, uniqueCount: 1000 }), {
    sessions: 3,
    threadsPerSession: 4
  });
  assert.deepEqual(resolvePoolConfig({ threadBudget: 4, uniqueCount: 1000 }), {
    sessions: 1,
    threadsPerSession: 4
  });
  assert.deepEqual(resolvePoolConfig({ threadBudget: 2, uniqueCount: 1000 }), {
    sessions: 1,
    threadsPerSession: 2
  });
});

test("resolvePoolConfig: tiny workloads skip the pool", () => {
  assert.deepEqual(resolvePoolConfig({ threadBudget: 12, uniqueCount: 10 }), {
    sessions: 1,
    threadsPerSession: 12
  });
});

test("resolvePoolConfig: explicit override wins", () => {
  assert.deepEqual(resolvePoolConfig({ threadBudget: 12, poolOverride: 2, uniqueCount: 10 }), {
    sessions: 2,
    threadsPerSession: 6
  });
});

// ─── execution ───────────────────────────────────────────────────────────────

test("runWorkUnits: assigns vectors to every duplicate index", async () => {
  const extractor = async (texts) => {
    const list = Array.isArray(texts) ? texts : [texts];
    return fakeTensor(list.map((t) => [t.length, 1]));
  };
  const units = packWorkUnits(
    [measured("aaa", 3, [0, 5]), measured("bb", 2, [1])],
    DEFAULT_SCHEDULER_OPTIONS
  );
  const result = await runWorkUnits(units, [extractor]);
  assert.equal(result.failures.length, 0);
  assert.deepEqual(result.vectors.get(0), [3, 1]);
  assert.deepEqual(result.vectors.get(5), [3, 1]);
  assert.deepEqual(result.vectors.get(1), [2, 1]);
});

test("runWorkUnits: batch failure retries per item and isolates the poison text", async () => {
  const extractor = async (texts) => {
    if (Array.isArray(texts)) {
      throw new Error("batch exploded");
    }
    if (texts === "bad") {
      throw new Error("poison");
    }
    return fakeTensor([[texts.length]]);
  };
  const units = [
    {
      kind: "batch",
      texts: ["ok", "bad", "fine"],
      members: [[0], [1, 9], [2]],
      maxTokens: 4,
      cost: 48
    }
  ];
  const result = await runWorkUnits(units, [extractor]);
  assert.deepEqual(result.vectors.get(0), [2]);
  assert.deepEqual(result.vectors.get(2), [4]);
  assert.equal(result.vectors.has(1), false);
  // the poison text fails for every index it owns
  assert.deepEqual(result.failures.map((f) => f.index).sort(), [1, 9]);
});

test("runWorkUnits: distributes units across multiple extractors", async () => {
  const calls = { a: 0, b: 0 };
  const make = (name) => async (texts) => {
    calls[name] += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const list = Array.isArray(texts) ? texts : [texts];
    return fakeTensor(list.map((t) => [t.length]));
  };
  const units = Array.from({ length: 8 }, (_, i) => ({
    kind: "single",
    texts: [`t${i}`],
    members: [[i]],
    maxTokens: 2,
    cost: 4
  }));
  const result = await runWorkUnits(units, [make("a"), make("b")]);
  assert.equal(result.vectors.size, 8);
  assert.ok(calls.a > 0 && calls.b > 0, `expected both lanes used, got ${JSON.stringify(calls)}`);
});

test("sliceBatchVectors: rejects shape mismatches", () => {
  assert.throws(
    () => sliceBatchVectors({ dims: [2, 3], data: Float32Array.from([1, 2, 3, 4, 5]) }, 2),
    /shape mismatch/
  );
});

test("runWorkUnits: in-flight token gate serializes giant units", async () => {
  let concurrent = 0;
  let peak = 0;
  const extractor = async (texts) => {
    concurrent += 1;
    peak = Math.max(peak, concurrent);
    await new Promise((resolve) => setTimeout(resolve, 10));
    concurrent -= 1;
    const list = Array.isArray(texts) ? texts : [texts];
    return { dims: [list.length, 1], data: Float32Array.from(list.map((t) => t.length)) };
  };
  // three giants of 8000 tokens each; gate of 12288 allows only one at a time
  const units = Array.from({ length: 3 }, (_, i) => ({
    kind: "single",
    texts: [`giant${i}`],
    members: [[i]],
    maxTokens: 8000,
    cost: 8000 * 8000
  }));
  const result = await runWorkUnits(units, [extractor, extractor, extractor], {
    maxInFlightTokens: 12288
  });
  assert.equal(result.vectors.size, 3);
  assert.equal(peak, 1, `expected serialized giants, saw peak concurrency ${peak}`);
});

test("runWorkUnits: shorts flow while a giant occupies the budget", async () => {
  const seen = [];
  const extractor = async (texts) => {
    const list = Array.isArray(texts) ? texts : [texts];
    seen.push(list[0]);
    await new Promise((resolve) => setTimeout(resolve, list[0].startsWith("giant") ? 40 : 5));
    return { dims: [list.length, 1], data: Float32Array.from(list.map((t) => t.length)) };
  };
  const units = [
    { kind: "single", texts: ["giant"], members: [[0]], maxTokens: 8000, cost: 64e6 },
    ...Array.from({ length: 6 }, (_, i) => ({
      kind: "single",
      texts: [`s${i}`],
      members: [[i + 1]],
      maxTokens: 50,
      cost: 2500
    }))
  ];
  const result = await runWorkUnits(units, [extractor, extractor], { maxInFlightTokens: 12288 });
  assert.equal(result.vectors.size, 7);
  // shorts must have run while the giant was in flight (second lane busy)
  assert.ok(seen.slice(0, 3).some((t) => t.startsWith("s")), `lane starvation: ${seen.join(",")}`);
});

test("runWorkUnits: gate never deadlocks on units larger than the budget", async () => {
  const extractor = async (texts) => {
    const list = Array.isArray(texts) ? texts : [texts];
    return { dims: [list.length, 1], data: Float32Array.from(list.map((t) => t.length)) };
  };
  const units = [
    { kind: "single", texts: ["mega"], members: [[0]], maxTokens: 50000, cost: 25e8 }
  ];
  const result = await runWorkUnits(units, [extractor], { maxInFlightTokens: 1000 });
  assert.equal(result.vectors.size, 1);
});
