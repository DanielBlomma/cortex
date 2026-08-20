import test from "node:test";
import assert from "node:assert/strict";

import {
  compareExpectedHits,
  expectedHitSet,
  processTreeMetrics
} from "../benchmark/bootstrapbench/wo046-progressive-angular.mjs";

test("WO-046 process metrics include the selected process tree only", () => {
  const table = [
    { pid: 10, ppid: 1, rss_kb: 100, cpu_percent: 10 },
    { pid: 11, ppid: 10, rss_kb: 50, cpu_percent: 20 },
    { pid: 12, ppid: 11, rss_kb: 25, cpu_percent: 5 },
    { pid: 99, ppid: 1, rss_kb: 999, cpu_percent: 99 }
  ];
  assert.deepEqual(processTreeMetrics(10, table), {
    rss_kb: 175,
    cpu_percent: 35,
    process_count: 3
  });
});

test("WO-046 expected-hit deltas report gained and lost hits per query", () => {
  const output = (hits) => ({
    queries: [{ id: "q1", expected: hits.map(([expected, found]) => ({ expected, match_level: found ? "path" : "missing" })) }]
  });
  const baseline = output([["a", true], ["b", false], ["c", true]]);
  const candidate = output([["a", false], ["b", true], ["c", true]]);
  assert.deepEqual([...expectedHitSet(baseline)].sort(), ["q1\u0000a", "q1\u0000c"]);
  assert.deepEqual(compareExpectedHits(baseline, candidate), {
    gained: ["q1\u0000b"],
    lost: ["q1\u0000a"]
  });
});
