import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  REGISTERED_RULE_IDS,
  createAuthorityManifest,
  createObservation,
  createSourceAuthorityRegistry,
  evaluateAnalysisState,
} from "../dist/core/analysis-state/engine.js";
import { evaluateAnalysisState as evaluateStage0 } from "../../../benchmark/bootstrapbench/maintained-analysis-state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_PATH = path.join(
  ROOT,
  "benchmark/bootstrapbench/fixtures/maintained-analysis-state/wo055-v1.json",
);

function fixtureInput() {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  return {
    fixture,
    input: {
      schema_version: fixture.schema_version,
      rule_ids: fixture.rule_ids,
      observations: fixture.observations,
    },
  };
}

function registryFor(observations) {
  const mutable = new Map();
  for (const observation of observations) {
    const existing = mutable.get(observation.source.path) ?? {
      sha256: observation.source.sha256,
      authorities: new Set(),
    };
    assert.equal(existing.sha256, observation.source.sha256);
    existing.authorities.add(observation.authority);
    mutable.set(observation.source.path, existing);
  }
  return createSourceAuthorityRegistry(Object.fromEntries(
    [...mutable.entries()].map(([sourcePath, value]) => [sourcePath, {
      sha256: value.sha256,
      authorities: [...value.authorities].sort(),
    }]),
  ));
}

test("native engine reproduces the accepted Stage 0 snapshot and explanations byte-for-byte", () => {
  const { fixture, input } = fixtureInput();
  const native = evaluateAnalysisState(input, fixture.authority_manifest, registryFor(input.observations));
  const oracle = evaluateStage0(input, fixture.authority_manifest);

  assert.equal(native.snapshotBytes, oracle.snapshotBytes);
  assert.deepEqual(native.statistics, oracle.statistics);
  for (const subject of ["wo055a-sql-002", "wo055a-typescript-002", "WO-055A"]) {
    for (const predicate of ["task_binding_viable", "blocked", "review_ready", "accepted"]) {
      assert.deepEqual(native.query(subject, predicate), oracle.query(subject, predicate));
    }
  }
  assert.deepEqual(native.whyNot("WO-055A", "accepted"), oracle.whyNot("WO-055A", "accepted"));
  assert.deepEqual(native.changesSince(0), oracle.changesSince(0));
});

test("source policy is caller-supplied, closed, and claim-bound", () => {
  const source = { path: "evidence/review.json", sha256: "a".repeat(64), selector: "review" };
  const observationInput = {
    schema_version: 1,
    subject: "WO-TEST",
    predicate: "human_approval",
    object: true,
    operation: "assert",
    observed_at: "2026-08-30T10:00:00Z",
    authority: "reviewer",
    source,
    scope: { repository: "cortex", work_order: "WO-TEST", phase: "review" },
    supersedes: [],
  };
  const observation = createObservation(observationInput);
  const input = { schema_version: 1, rule_ids: REGISTERED_RULE_IDS, observations: [observation] };
  const manifest = createAuthorityManifest(input.observations);
  const policy = createSourceAuthorityRegistry({
    [source.path]: { sha256: source.sha256, authorities: ["reviewer"] },
  });

  const state = evaluateAnalysisState(input, manifest, policy);
  assert.equal(state.query("WO-TEST", "human_approval").length, 1);
  assert.throws(
    () => evaluateAnalysisState(input, manifest, createSourceAuthorityRegistry({
      [source.path]: { sha256: "b".repeat(64), authorities: ["reviewer"] },
    })),
    /source hash is not authorized/u,
  );
  const opposite = createObservation({ ...observationInput, object: false });
  assert.throws(
    () => evaluateAnalysisState(
      { ...input, observations: [opposite] },
      manifest,
      policy,
    ),
    /absent from or differs/u,
  );
});

test("source registry rejects traversal, duplicate authorities, and unknown authority", () => {
  assert.throws(
    () => createSourceAuthorityRegistry({ "../outside": { sha256: "a".repeat(64), authorities: ["tool"] } }),
    /source path is unsafe/u,
  );
  assert.throws(
    () => createSourceAuthorityRegistry({ "evidence/a": { sha256: "a".repeat(64), authorities: ["tool", "tool"] } }),
    /unique/u,
  );
  assert.throws(
    () => createSourceAuthorityRegistry({ "evidence/a": { sha256: "a".repeat(64), authorities: ["root"] } }),
    /unknown authority/u,
  );
});
