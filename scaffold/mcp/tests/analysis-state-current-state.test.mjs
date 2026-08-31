import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  LIMITS,
  REGISTERED_RULE_IDS,
  bindingIdentitySha256,
  canonicalJson,
  createAuthorityManifest,
  createObservation,
  createSourceAuthorityRegistry,
  sha256Canonical,
} from "../dist/core/analysis-state/engine.js";
import {
  AnalysisQueryError,
  ANALYSIS_TRANSACTION_INTENT_FILE,
} from "../dist/core/analysis-state/query-reader.js";
import { publishAnalysisState } from "../dist/core/analysis-state/store.js";
import {
  MAINTAINED_ANALYSIS_CURRENT_STATE_DECISIONS,
  renderTrustedAnalysisCurrentState,
} from "../dist/core/analysis-state/current-state.js";

const TASK_ID = "wo061-test";
const SUBJECT = "WO-TEST";
const REPOSITORY = "cortex";
const SOURCE_PATH = "evidence/[hidden](https:evil)#<script>.json";
const SOURCE_SHA256 = "a".repeat(64);
const CURRENT_STATE_URL = pathToFileURL(
  path.resolve(new URL("../dist/core/analysis-state/current-state.js", import.meta.url).pathname),
).href;
const FROZEN_MARKDOWN_SHA256 = "c7109b52e4d8b4002aa9cfb15cc0f0e4cf21329b4e61ad6efbb7eca0ee2f15ca";

function makeRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cortex-current-state-")));
}

function observationBuilder() {
  let sequence = 0;
  return (subject, predicate, object, options = {}) => {
    sequence += 1;
    return createObservation({
      schema_version: 1,
      subject,
      predicate,
      object,
      operation: "assert",
      observed_at: new Date(Date.UTC(2026, 7, 31, 10, 0, sequence))
        .toISOString()
        .replace(".000Z", "Z"),
      authority: "reviewer",
      source: {
        path: SOURCE_PATH,
        sha256: SOURCE_SHA256,
        selector: options.selector ?? `projection-${sequence}`,
      },
      scope: { repository: REPOSITORY, work_order: SUBJECT, phase: "review" },
      supersedes: [],
    });
  };
}

function registryFor(observations) {
  const sources = new Map();
  for (const observation of observations) {
    const value = sources.get(observation.source.path) ?? {
      sha256: observation.source.sha256,
      authorities: new Set(),
    };
    assert.equal(value.sha256, observation.source.sha256);
    value.authorities.add(observation.authority);
    sources.set(observation.source.path, value);
  }
  return createSourceAuthorityRegistry(Object.fromEntries(
    [...sources.entries()].map(([sourcePath, value]) => [sourcePath, {
      sha256: value.sha256,
      authorities: [...value.authorities].sort(),
    }]),
  ));
}

function authorityPath(root) {
  return path.join(root, ".agents", TASK_ID, "analysis-authority.json");
}

function taskPath(root, name) {
  return path.join(root, ".agents", TASK_ID, name);
}

function fixture(observations) {
  const root = makeRoot();
  const authorityManifest = createAuthorityManifest(observations);
  const sourceAuthorities = registryFor(observations);
  const persisted = publishAnalysisState({
    cwd: root,
    taskId: TASK_ID,
    repository: REPOSITORY,
    input: { schema_version: 1, rule_ids: REGISTERED_RULE_IDS, observations },
    authorityManifest,
    sourceAuthorities,
  });
  const payload = {
    schema_version: 1,
    repository: REPOSITORY,
    task_id: TASK_ID,
    primary_subject: SUBJECT,
    authority_manifest: authorityManifest,
    source_authorities: sourceAuthorities,
  };
  const authority = { ...payload, bundle_sha256: sha256Canonical(payload) };
  fs.writeFileSync(authorityPath(root), `${canonicalJson(authority)}\n`, { mode: 0o600 });
  fs.chmodSync(authorityPath(root), 0o600);
  return { root, persisted, authority };
}

function options(root) {
  return { enabled: true, cwd: root, taskId: TASK_ID };
}

function identity(root) {
  const values = [];
  function visit(target) {
    const stat = fs.lstatSync(target, { bigint: true });
    values.push({
      path: path.relative(root, target),
      dev: stat.dev,
      ino: stat.ino,
      ctimeNs: stat.ctimeNs,
      mtimeNs: stat.mtimeNs,
      mode: stat.mode,
      nlink: stat.nlink,
      size: stat.size,
      entries: stat.isDirectory() ? fs.readdirSync(target).sort() : null,
      bytes: stat.isFile() ? fs.readFileSync(target).toString("base64") : null,
    });
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target).sort()) visit(path.join(target, entry));
    }
  }
  visit(path.join(root, ".agents"));
  return values;
}

function runFresh(root) {
  const source = [
    `import { renderTrustedAnalysisCurrentState } from ${JSON.stringify(CURRENT_STATE_URL)};`,
    `process.stdout.write(JSON.stringify(renderTrustedAnalysisCurrentState(${JSON.stringify(options(root))})));`,
  ].join("\n");
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: root,
    encoding: "utf8",
  });
}

function bindingPremises(make, subject = "task-binding") {
  const binding = ["b".repeat(64), "c".repeat(40), "d".repeat(40), null, "e".repeat(64), "f".repeat(64)];
  const identity = bindingIdentitySha256(binding);
  return [
    make(subject, "binding_exact", binding),
    make(subject, "binding_exact", binding, { selector: "second-binding-anchor" }),
    make(subject, "replay_deterministic", [identity, 1, 2, 3, 4, 0, binding[4], binding[5]]),
    make(subject, "distinct_semantic_owners", [
      identity,
      binding[4],
      `owner-v4:${"1".repeat(64)}`,
      `owner-v4:${"2".repeat(64)}`,
    ]),
    make(subject, "contamination_clear", [identity, binding[0], true]),
  ];
}

function acceptedPremises(make) {
  const task = "task-binding";
  const review = "review:core";
  return [
    ...bindingPremises(make, task),
    make(SUBJECT, "required_binding_set_exact", [task]),
    make(SUBJECT, "receipt_schema_closed", true),
    make(SUBJECT, "receipt_externally_anchored", true),
    make(SUBJECT, "negative_probes_observed", true),
    make(SUBJECT, "required_review_set_exact", [review]),
    make(review, "review_go", true),
    make(SUBJECT, "human_approval", true),
  ];
}

test("canonical projection is byte-exact, fresh-process deterministic, and read neutral", () => {
  const make = observationBuilder();
  const blocker = make(SUBJECT, "blocker_active", "review_blocker");
  const { root, persisted, authority } = fixture([blocker]);
  try {
    const before = identity(root);
    const first = renderTrustedAnalysisCurrentState(options(root));
    const second = renderTrustedAnalysisCurrentState(options(root));
    const child = runFresh(root);
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), first);
    assert.deepEqual(second, first);
    assert.deepEqual(identity(root), before);

    assert.equal(first.schema_version, 1);
    assert.equal(first.generator, "maintained-analysis-current-state-v1");
    assert.equal(first.generation, 1);
    assert.equal(first.snapshot_sha256, persisted.manifest.snapshot_sha256);
    assert.equal(first.authority_bundle_sha256, authority.bundle_sha256);
    assert.deepEqual(first.decisions.map((item) => item.predicate), [
      ...MAINTAINED_ANALYSIS_CURRENT_STATE_DECISIONS,
    ]);
    assert.ok(first.decisions.every((item) => item.status === "not derivable"));
    assert.equal(first.blockers.length, 1);
    assert.deepEqual(first.blockers[0].fact.observations, [{
      observation_id: blocker.id,
      source_sha256: SOURCE_SHA256,
    }]);
    assert.equal(first.contradictions.length, 0);
    assert.equal(first.markdown_sha256, FROZEN_MARKDOWN_SHA256);
    assert.equal(first.markdown.endsWith("\n"), true);
    assert.equal(first.markdown.endsWith("\n\n"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("complete decisions remain derivable and preserve multiple source-anchored proof support", () => {
  const make = observationBuilder();
  const observations = acceptedPremises(make);
  const { root } = fixture(observations);
  try {
    const result = renderTrustedAnalysisCurrentState(options(root));
    assert.ok(result.decisions.every((item) => item.status === "derivable"));
    assert.ok(result.decisions.every((item) => item.facts.length === 1));
    const accepted = result.decisions.find((item) => item.predicate === "accepted");
    assert.ok(accepted.facts[0].observations.length >= observations.length - 1);
    assert.match(result.markdown, /`accepted`: derivable/u);
    assert.doesNotMatch(result.markdown, /not derivable|contradicted/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("blockers and primary/related contradictions are complete without raw values or Markdown injection", () => {
  const make = observationBuilder();
  const observations = [
    ...acceptedPremises(make),
    make(SUBJECT, "human_approval", false, { selector: "approval-denial" }),
    make("review:core", "review_go", false, { selector: "review-denial" }),
    make(SUBJECT, "blocker_active", "contract_blocker"),
    make(SUBJECT, "blocker_active", "security_blocker"),
  ];
  const { root } = fixture(observations);
  try {
    const result = renderTrustedAnalysisCurrentState(options(root));
    assert.equal(result.blockers.length, 2);
    assert.deepEqual(result.blockers.map((item) => item.blocker).sort(), [
      "contract_blocker",
      "security_blocker",
    ]);
    assert.equal(result.contradictions.length, 2);
    assert.deepEqual(result.contradictions.map((item) => [item.subject, item.predicate]).sort(), [
      ["WO-TEST", "human_approval"],
      ["review:core", "review_go"],
    ]);
    assert.deepEqual(
      Object.fromEntries(result.decisions.map((item) => [item.predicate, item.status])),
      {
        accepted: "not derivable",
        review_ready: "not derivable",
        work_order_inputs_viable: "derivable",
        evidence_trusted: "derivable",
        required_reviews_go: "not derivable",
      },
    );
    assert.doesNotMatch(JSON.stringify(result), /\[hidden\]|https:evil|<script>|approval-denial|review-denial/u);
    assert.doesNotMatch(result.markdown, /\bfalse\b|NO-GO|^# |\]\(/mu);
    assert.match(result.markdown, /### Contradictions \(2\)/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("closed options and trusted-reader failures happen without projection mutation", (t) => {
  const missing = makeRoot();
  try {
    assert.throws(
      () => renderTrustedAnalysisCurrentState({ enabled: false, cwd: "/missing", taskId: TASK_ID }),
      (error) => error instanceof AnalysisQueryError && error.code === "AUTHORITY_INVALID" && /disabled/u.test(error.message),
    );
    assert.throws(
      () => renderTrustedAnalysisCurrentState({ ...options(missing), template: "# injected" }),
      (error) => error instanceof AnalysisQueryError && error.code === "AUTHORITY_INVALID",
    );
    assert.throws(
      () => renderTrustedAnalysisCurrentState(options(missing)),
      (error) => error instanceof AnalysisQueryError && error.code === "STATE_NOT_FOUND",
    );
  } finally {
    fs.rmSync(missing, { recursive: true, force: true });
  }

  for (const mutation of ["bundle", "transaction", "hardlink", "mode", "fifo"]) {
    const make = observationBuilder();
    const state = fixture([make(SUBJECT, "blocker_active", "review_blocker")]);
    const outside = path.join(os.tmpdir(), `cortex-current-state-${process.pid}-${mutation}`);
    try {
      if (mutation === "bundle") {
        const raw = JSON.parse(fs.readFileSync(authorityPath(state.root), "utf8"));
        fs.writeFileSync(authorityPath(state.root), `${JSON.stringify({ ...raw, repository: "other" })}\n`, { mode: 0o600 });
      } else if (mutation === "transaction") {
        fs.writeFileSync(taskPath(state.root, ANALYSIS_TRANSACTION_INTENT_FILE), "{}\n", { mode: 0o600 });
      } else if (mutation === "hardlink") {
        fs.linkSync(authorityPath(state.root), outside);
      } else if (mutation === "mode") {
        fs.chmodSync(authorityPath(state.root), 0o644);
      } else {
        fs.renameSync(authorityPath(state.root), outside);
        const made = spawnSync("mkfifo", [authorityPath(state.root)], { encoding: "utf8" });
        if (made.error?.code === "ENOENT") {
          t.diagnostic("mkfifo unavailable; FIFO branch skipped");
          continue;
        }
        assert.equal(made.status, 0, made.stderr);
      }
      const before = identity(state.root);
      assert.throws(
        () => renderTrustedAnalysisCurrentState(options(state.root)),
        (error) => error instanceof AnalysisQueryError && error.code === "STATE_UNTRUSTED",
        mutation,
      );
      assert.deepEqual(identity(state.root), before, mutation);
    } finally {
      fs.rmSync(state.root, { recursive: true, force: true });
      fs.rmSync(outside, { force: true });
    }
  }
});

test("maximum complete blocker projection fits while an incomplete over-limit view fails closed", () => {
  for (const count of [128, 129]) {
    const make = observationBuilder();
    const observations = Array.from({ length: count }, (_, index) =>
      make(SUBJECT, "blocker_active", `blocker-${String(index).padStart(3, "0")}`),
    );
    const { root } = fixture(observations);
    try {
      if (count === 128) {
        const result = renderTrustedAnalysisCurrentState(options(root));
        assert.equal(result.blockers.length, 128);
        assert.ok(Buffer.byteLength(result.markdown, "utf8") <= LIMITS.rendered_bytes);
      } else {
        assert.throws(
          () => renderTrustedAnalysisCurrentState(options(root)),
          (error) => error instanceof AnalysisQueryError && error.code === "STATE_UNTRUSTED",
        );
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
