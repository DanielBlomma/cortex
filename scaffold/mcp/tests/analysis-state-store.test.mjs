import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  REGISTERED_RULE_IDS,
  createAuthorityManifest,
  createObservation,
  createSourceAuthorityRegistry,
} from "../dist/core/analysis-state/engine.js";
import {
  publishAnalysisState,
  readAnalysisState,
  recoverAnalysisState,
} from "../dist/core/analysis-state/store.js";

const SOURCE = {
  path: "evidence/workflow-review.json",
  sha256: "a".repeat(64),
  selector: "review",
};
const SOURCE_AUTHORITIES = createSourceAuthorityRegistry({
  [SOURCE.path]: { sha256: SOURCE.sha256, authorities: ["reviewer"] },
});

function makeRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-analysis-state-")));
}

function observation(predicate, object, observedAt, extra = {}) {
  return createObservation({
    schema_version: 1,
    subject: "WO-TEST",
    predicate,
    object,
    operation: "assert",
    observed_at: observedAt,
    authority: "reviewer",
    source: SOURCE,
    scope: { repository: "cortex", work_order: "WO-TEST", phase: "review" },
    supersedes: [],
    ...extra,
  });
}

function options(cwd, observations, extra = {}) {
  return {
    cwd,
    taskId: "wo057-test",
    repository: "cortex",
    input: { schema_version: 1, rule_ids: REGISTERED_RULE_IDS, observations },
    authorityManifest: createAuthorityManifest(observations),
    sourceAuthorities: SOURCE_AUTHORITIES,
    ...extra,
  };
}

function paths(root) {
  const directory = path.join(root, ".agents", "wo057-test", "analysis");
  return {
    directory,
    observations: path.join(directory, "observations.jsonl"),
    snapshot: path.join(directory, "snapshot.json"),
    changes: path.join(directory, "changes.jsonl"),
    manifest: path.join(directory, "manifest.json"),
    lock: path.join(root, ".agents", "wo057-test", ".analysis.lock"),
  };
}

test("store publishes an append-only hash chain and rejects stale or rewritten writers", () => {
  const root = makeRoot();
  const approval = observation("human_approval", true, "2026-08-30T10:00:00Z");
  const blocker = observation("blocker_active", "review_blocker", "2026-08-30T10:01:00Z");
  try {
    const first = publishAnalysisState(options(root, [approval], { expectedGeneration: 0 }));
    assert.equal(first.manifest.generation, 1);
    assert.equal(first.manifest.observation_count, 1);
    assert.equal(first.state.query("WO-TEST", "human_approval").length, 1);

    const second = publishAnalysisState(options(root, [approval, blocker], { expectedGeneration: 1 }));
    assert.equal(second.manifest.generation, 2);
    assert.equal(second.manifest.observation_count, 2);
    assert.equal(second.state.query("WO-TEST", "blocked").length, 1);
    assert.equal(second.changes.length, 2);
    assert.ok(second.changes[1].added_fact_ids.length > 0);

    const records = fs.readFileSync(paths(root).observations, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(records[0].previous_record_sha256, "0".repeat(64));
    assert.equal(records[1].previous_record_sha256, records[0].record_sha256);
    assert.equal(fs.statSync(paths(root).observations).mode & 0o777, 0o600);
    assert.equal(fs.statSync(paths(root).directory).mode & 0o777, 0o700);

    const third = observation("generator_compatible", false, "2026-08-30T10:02:00Z");
    assert.throws(
      () => publishAnalysisState(options(root, [approval, blocker, third], { expectedGeneration: 1 })),
      /stale writer/u,
    );
    const replacement = observation("human_approval", false, "2026-08-30T10:00:00Z");
    assert.throws(
      () => publishAnalysisState(options(root, [replacement, blocker, third], { expectedGeneration: 2 })),
      /append-only observation prefix changed/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("crash recovery closes every manifest-last publication boundary", () => {
  const approval = observation("human_approval", true, "2026-08-30T10:00:00Z");
  for (const failAfter of ["observations", "snapshot", "changes"]) {
    const root = makeRoot();
    try {
      assert.throws(
        () => publishAnalysisState(options(root, [approval], { failAfter })),
        failAfter === "observations"
          ? /injected failure after observation append/u
          : new RegExp(`injected failure after ${failAfter}`, "u"),
      );
      assert.equal(fs.existsSync(paths(root).lock), false);
      const recovered = recoverAnalysisState(options(root, [approval]));
      assert.equal(recovered.manifest.generation, 1, failAfter);
      assert.equal(recovered.state.snapshotBytes, readAnalysisState(options(root, [approval])).state.snapshotBytes);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("snapshot tamper is rejected and recovered only from the verified observation log", () => {
  const root = makeRoot();
  const approval = observation("human_approval", true, "2026-08-30T10:00:00Z");
  try {
    const original = publishAnalysisState(options(root, [approval]));
    fs.writeFileSync(paths(root).snapshot, `${JSON.stringify({ forged: true })}\n`, { mode: 0o600 });
    assert.throws(() => readAnalysisState(options(root, [approval])), /published file hash/u);
    const recovered = recoverAnalysisState(options(root, [approval]));
    assert.equal(recovered.state.snapshotBytes, original.state.snapshotBytes);

    const lines = fs.readFileSync(paths(root).observations, "utf8").trim().split("\n");
    const record = JSON.parse(lines[0]);
    record.observation.object = false;
    fs.writeFileSync(paths(root).observations, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    assert.throws(() => recoverAnalysisState(options(root, [approval])), /observation record 1 hash changed/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("containment rejects traversal, symlinks, hard links, special files, wrong modes, and extras", () => {
  const approval = observation("human_approval", true, "2026-08-30T10:00:00Z");
  const traversalRoot = makeRoot();
  try {
    assert.throws(
      () => publishAnalysisState({ ...options(traversalRoot, [approval]), taskId: "../escape" }),
      /canonical path component/u,
    );
  } finally {
    fs.rmSync(traversalRoot, { recursive: true, force: true });
  }

  const symlinkRoot = makeRoot();
  const outside = makeRoot();
  try {
    fs.mkdirSync(path.join(symlinkRoot, ".agents", "wo057-test"), { recursive: true, mode: 0o700 });
    fs.symlinkSync(outside, paths(symlinkRoot).directory);
    assert.throws(
      () => publishAnalysisState(options(symlinkRoot, [approval])),
      /symlink or non-directory/u,
    );
  } finally {
    fs.rmSync(symlinkRoot, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }

  for (const mutation of ["hardlink", "mode", "extra", "fifo"]) {
    const root = makeRoot();
    try {
      publishAnalysisState(options(root, [approval]));
      if (mutation === "hardlink") {
        fs.linkSync(paths(root).snapshot, path.join(root, "snapshot-link"));
      } else if (mutation === "mode") {
        fs.chmodSync(paths(root).snapshot, 0o644);
      } else if (mutation === "extra") {
        fs.writeFileSync(path.join(paths(root).directory, "extra.json"), "{}\n");
      } else {
        fs.rmSync(paths(root).snapshot);
        const result = spawnSync("mkfifo", [paths(root).snapshot]);
        assert.equal(result.status, 0, result.stderr.toString());
      }
      assert.throws(
        () => readAnalysisState(options(root, [approval])),
        /private regular file|wrong mode|unexpected entries/u,
        mutation,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("identity, authority drift, and concurrent writers fail closed", () => {
  const root = makeRoot();
  const approval = observation("human_approval", true, "2026-08-30T10:00:00Z");
  try {
    publishAnalysisState(options(root, [approval]));
    assert.throws(
      () => readAnalysisState({ ...options(root, [approval]), repository: "other" }),
      /manifest identity/u,
    );
    const wrongAuthorities = createSourceAuthorityRegistry({
      [SOURCE.path]: { sha256: SOURCE.sha256, authorities: ["reviewer", "tool"] },
    });
    assert.throws(
      () => readAnalysisState({ ...options(root, [approval]), sourceAuthorities: wrongAuthorities }),
      /committed manifest/u,
    );
    assert.throws(
      () => recoverAnalysisState({ ...options(root, [approval]), sourceAuthorities: wrongAuthorities }),
      /authority, or ruleset drifted/u,
    );
    fs.mkdirSync(paths(root).lock, { mode: 0o700 });
    assert.throws(
      () => publishAnalysisState(options(root, [approval, observation("blocker_active", "x", "2026-08-30T10:01:00Z")])),
      /another writer/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("persisted inputs are bounded before parsing and corrupt committed manifests fail closed", () => {
  const approval = observation("human_approval", true, "2026-08-30T10:00:00Z");
  for (const target of ["observations", "snapshot", "changes", "manifest"]) {
    const root = makeRoot();
    try {
      publishAnalysisState(options(root, [approval]));
      fs.truncateSync(paths(root)[target], target === "manifest" ? 65 * 1024 : 9 * 1024 * 1024);
      assert.throws(
        () => readAnalysisState(options(root, [approval])),
        /exceeds the [0-9]+-byte bound/u,
        target,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  const root = makeRoot();
  try {
    publishAnalysisState(options(root, [approval]));
    fs.writeFileSync(paths(root).manifest, "{}\n", { mode: 0o600 });
    assert.throws(
      () => recoverAnalysisState(options(root, [approval])),
      /manifest has unknown or missing keys/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("second-generation crash recovery preserves the committed change lineage", () => {
  const root = makeRoot();
  const approval = observation("human_approval", true, "2026-08-30T10:00:00Z");
  const blocker = observation("blocker_active", "review_blocker", "2026-08-30T10:01:00Z");
  try {
    const first = publishAnalysisState(options(root, [approval]));
    assert.throws(
      () => publishAnalysisState(options(root, [approval, blocker], {
        expectedGeneration: 1,
        failAfter: "changes",
      })),
      /injected failure after changes/u,
    );
    const recovered = recoverAnalysisState(options(root, [approval, blocker]));
    assert.equal(recovered.manifest.generation, 2);
    assert.equal(recovered.changes.length, 2);
    assert.equal(recovered.changes[0].snapshot_sha256, first.manifest.snapshot_sha256);
    assert.equal(recovered.changes[1].previous_snapshot_sha256, first.manifest.snapshot_sha256);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recovery alone reclaims a secure lock left by an exited writer", () => {
  const root = makeRoot();
  const approval = observation("human_approval", true, "2026-08-30T10:00:00Z");
  try {
    publishAnalysisState(options(root, [approval]));
    const script = [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const lock = process.argv[1];',
      'const analysis = process.argv[2];',
      'fs.mkdirSync(lock, { mode: 0o700 });',
      'fs.writeFileSync(path.join(lock, "owner.json"), `${JSON.stringify({ schema_version: 1, pid: process.pid, token: "a".repeat(32) })}\\n`, { mode: 0o600 });',
      'fs.writeFileSync(path.join(analysis, `snapshot.json.tmp-${process.pid}-aaaaaaaaaaaa`), "partial", { mode: 0o600 });',
    ].join("\n");
    const exited = spawnSync(
      process.execPath,
      ["-e", script, paths(root).lock, paths(root).directory],
      { encoding: "utf8" },
    );
    assert.equal(exited.status, 0, exited.stderr);
    assert.throws(
      () => publishAnalysisState(options(root, [approval])),
      /another writer holds/u,
    );
    const recovered = recoverAnalysisState(options(root, [approval]));
    assert.equal(recovered.manifest.generation, 1);
    assert.equal(fs.existsSync(paths(root).lock), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
