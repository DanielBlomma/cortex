// The evaluator is a byte-preserving TypeScript promotion of the accepted
// Stage 0 engine. Public inputs are fully runtime-validated below; the explicit
// types live in schemas.ts while this file keeps the reviewed canonical logic
// readable and mechanically comparable to the benchmark oracle.
// @ts-nocheck -- semantic drift is guarded by the shared 19-case conformance suite.
import crypto from "node:crypto";

const SHA256_RE = /^[0-9a-f]{64}$/;
const OBSERVATION_ID_RE = /^obs:[0-9a-f]{64}$/;
const ENTITY_RE = /^(?:WO|wo|review|task|fixture|test)[A-Za-z0-9:-]{1,119}$/;
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export const LIMITS = Object.freeze({
  observations: 256,
  tuple_items: 64,
  proof_paths_per_fact: 64,
  proof_nodes_per_query: 256,
  query_results: 128,
  why_not_items: 128,
  change_epochs: 64,
  change_facts: 512,
  rendered_bytes: 65536,
});

export const REGISTERED_AUTHORITIES = Object.freeze([
  "artifact",
  "manager",
  "reviewer",
  "test",
  "tool",
]);

export const REGISTERED_OPERATIONS = Object.freeze(["assert", "retract"]);

export function createSourceAuthorityRegistry(input) {
  if (!isPlainObject(input)) fail("source authority registry must be a plain object");
  const output = {};
  for (const sourcePath of Object.keys(input).sort()) {
    if (
      typeof sourcePath !== "string" || sourcePath.length < 1 || sourcePath.length > 512 ||
      sourcePath.includes("\\") || sourcePath.includes("\0") || sourcePath.startsWith("/") ||
      sourcePath.split("/").some((part) => part === "" || part === "." || part === "..")
    ) fail(`source path is unsafe: ${sourcePath}`);
    const policy = input[sourcePath];
    assertExactKeys(policy, ["sha256", "authorities"], [], `source authority ${sourcePath}`);
    assertSha(policy.sha256, `source authority hash ${sourcePath}`);
    if (
      !Array.isArray(policy.authorities) || policy.authorities.length === 0 ||
      new Set(policy.authorities).size !== policy.authorities.length ||
      canonicalJson(policy.authorities) !== canonicalJson([...policy.authorities].sort())
    ) fail(`source authorities must be non-empty, unique, and sorted for ${sourcePath}`);
    for (const authority of policy.authorities) {
      if (!REGISTERED_AUTHORITIES.includes(authority)) fail(`unknown authority ${authority}`);
    }
    output[sourcePath] = Object.freeze({
      sha256: policy.sha256,
      authorities: Object.freeze([...policy.authorities]),
    });
  }
  if (Object.keys(output).length === 0 || Object.keys(output).length > LIMITS.observations) {
    fail("source authority registry must be non-empty and bounded");
  }
  return Object.freeze(output);
}

const BASE_BOOLEAN_PREDICATES = new Set([
  "control_replay_digest_shape_valid",
  "generator_compatible",
  "human_approval",
  "negative_probes_observed",
  "receipt_externally_anchored",
  "receipt_schema_closed",
  "review_go",
]);

const BASE_TUPLE_PREDICATES = new Set([
  "binding_exact",
  "contamination_clear",
  "distinct_semantic_owners",
  "replay_deterministic",
  "required_binding_set_exact",
  "required_review_set_exact",
]);

const BASE_TOKEN_PREDICATES = new Set(["blocker_active"]);

const DERIVED_BOOLEAN_PREDICATES = new Set([
  "accepted",
  "evidence_trusted",
  "every_required_binding_viable",
  "every_required_review_go",
  "required_reviews_go",
  "review_ready",
  "task_binding_viable",
  "work_order_inputs_viable",
]);

const DERIVED_TOKEN_PREDICATES = new Set(["blocked"]);

export const BASE_OBSERVATION_PREDICATES = Object.freeze(
  [...BASE_BOOLEAN_PREDICATES, ...BASE_TUPLE_PREDICATES, ...BASE_TOKEN_PREDICATES].sort(),
);

export const DERIVED_ONLY_PREDICATES = Object.freeze(
  [...DERIVED_BOOLEAN_PREDICATES, ...DERIVED_TOKEN_PREDICATES].sort(),
);

export const REGISTERED_PREDICATES = Object.freeze([...BASE_OBSERVATION_PREDICATES, ...DERIVED_ONLY_PREDICATES].sort());

const BOOLEAN_PREDICATES = new Set([...BASE_BOOLEAN_PREDICATES, ...DERIVED_BOOLEAN_PREDICATES]);
const TOKEN_PREDICATES = new Set([...BASE_TOKEN_PREDICATES, ...DERIVED_TOKEN_PREDICATES]);

const RULES = Object.freeze([
  { id: "rule.accepted.v1", output: "accepted", dependencies: ["review_ready", "human_approval"], guards: ["no_active_blocker", "no_relevant_contradiction"] },
  { id: "rule.blocked.v1", output: "blocked", dependencies: ["blocker_active"] },
  { id: "rule.evidence_trusted.v1", output: "evidence_trusted", dependencies: ["receipt_schema_closed", "receipt_externally_anchored", "negative_probes_observed"] },
  { id: "rule.every_required_binding_viable.v1", output: "every_required_binding_viable", dependencies: ["required_binding_set_exact", "task_binding_viable"] },
  { id: "rule.every_required_review_go.v1", output: "every_required_review_go", dependencies: ["required_review_set_exact", "review_go"] },
  { id: "rule.required_reviews_go.v1", output: "required_reviews_go", dependencies: ["required_review_set_exact", "every_required_review_go"] },
  { id: "rule.review_ready.v1", output: "review_ready", dependencies: ["work_order_inputs_viable", "evidence_trusted", "required_reviews_go"], guards: ["no_active_blocker", "no_relevant_contradiction"] },
  { id: "rule.task_binding_viable.v1", output: "task_binding_viable", dependencies: ["binding_exact", "replay_deterministic", "distinct_semantic_owners", "contamination_clear"], guards: ["binding_identity_and_hashes_match"] },
  { id: "rule.work_order_inputs_viable.v1", output: "work_order_inputs_viable", dependencies: ["required_binding_set_exact", "every_required_binding_viable"] },
]);

export const REGISTERED_RULE_IDS = Object.freeze(RULES.map((rule) => rule.id).sort());

function fail(message) {
  throw new TypeError(`maintained-analysis-state: ${message}`);
}

function assertRenderedBound(value, label) {
  if (new TextEncoder().encode(canonicalJson(value)).byteLength > LIMITS.rendered_bytes) {
    fail(`${label} rendered byte bound exceeded`);
  }
  return value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, required, optional, label) {
  if (!isPlainObject(value)) fail(`${label} must be a plain object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} has unknown key ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`${label} is missing key ${key}`);
  }
}

function assertToken(value, label) {
  if (typeof value !== "string" || !TOKEN_RE.test(value)) fail(`${label} is not a canonical token`);
}

function assertEntity(value, label) {
  if (typeof value !== "string" || !ENTITY_RE.test(value)) fail(`${label} is not a canonical scoped entity ID`);
}

function assertSha(value, label) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) fail(`${label} must be a lowercase SHA-256`);
}

function assertCanonicalScalar(value, label) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0)) return;
  fail(`${label} must be a canonical JSON scalar`);
}

function assertTuple(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIMITS.tuple_items) {
    fail(`${label} must be a non-empty bounded tuple`);
  }
  for (let index = 0; index < value.length; index += 1) {
    assertCanonicalScalar(value[index], `${label}[${index}]`);
  }
}

function assertPredicateObject(predicate, object, label) {
  if (BASE_BOOLEAN_PREDICATES.has(predicate)) {
    if (typeof object !== "boolean") fail(`${label} must be boolean for ${predicate}`);
    return;
  }
  if (TOKEN_PREDICATES.has(predicate)) {
    assertToken(object, label);
    return;
  }
  if (predicate === "required_binding_set_exact" || predicate === "required_review_set_exact") {
    assertTuple(object, label);
    const sorted = [...object].sort();
    if (object.some((item) => typeof item !== "string" || !ENTITY_RE.test(item))) {
      fail(`${label} must contain canonical entity IDs`);
    }
    if (new Set(object).size !== object.length || canonicalJson(object) !== canonicalJson(sorted)) {
      fail(`${label} must be unique and sorted`);
    }
    return;
  }
  if (predicate === "binding_exact") {
    assertTuple(object, label);
    if (object.length !== 6) fail(`${label} must have six binding fields`);
    assertSha(object[0], `${label}[0] task hash`);
    if (typeof object[1] !== "string" || !/^[0-9a-f]{40}$/.test(object[1])) fail(`${label}[1] must be a Git commit`);
    if (typeof object[2] !== "string" || !/^[0-9a-f]{40}$/.test(object[2])) fail(`${label}[2] must be a Git tree`);
    for (let index = 3; index < 6; index += 1) {
      if (object[index] !== null) assertSha(object[index], `${label}[${index}]`);
    }
    return;
  }
  if (predicate === "replay_deterministic") {
    assertTuple(object, label);
    if (object.length !== 8) fail(`${label} must have eight identity-bound replay fields`);
    assertSha(object[0], `${label}[0] binding identity`);
    for (let index = 1; index < 6; index += 1) {
      if (object[index] !== null && (!Number.isSafeInteger(object[index]) || object[index] < 0)) {
        fail(`${label}[${index}] must be a non-negative safe integer or null`);
      }
    }
    assertSha(object[6], `${label}[6] index hash`);
    if (object[7] !== null) assertSha(object[7], `${label}[7] replay hash`);
    return;
  }
  if (predicate === "distinct_semantic_owners") {
    assertTuple(object, label);
    if (object.length !== 4) fail(`${label} must have binding identity, index hash, and exactly two owners`);
    assertSha(object[0], `${label}[0] binding identity`);
    assertSha(object[1], `${label}[1] index hash`);
    for (let index = 2; index < 4; index += 1) {
      if (typeof object[index] !== "string" || !/^owner-v4:[0-9a-f]{64}$/.test(object[index])) fail(`${label}[${index}] must be an owner-v4 identity`);
    }
    if (object[2] === object[3] || canonicalJson([object[2], object[3]]) !== canonicalJson([object[2], object[3]].sort())) {
      fail(`${label} owners must be distinct and sorted`);
    }
    return;
  }
  if (predicate === "contamination_clear") {
    assertTuple(object, label);
    if (object.length !== 3) fail(`${label} must have binding identity, task hash, and clear outcome`);
    assertSha(object[0], `${label}[0] binding identity`);
    assertSha(object[1], `${label}[1] task hash`);
    if (object[2] !== true) fail(`${label}[2] requires a positive clear outcome`);
    return;
  }
  fail(`predicate ${predicate} has no registered object shape`);
}

export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail("canonical JSON only admits safe integers");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (!isPlainObject(value)) fail("canonical JSON value must be plain data");
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function sha256Canonical(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function bindingIdentitySha256(bindingTuple) {
  assertPredicateObject("binding_exact", bindingTuple, "binding tuple");
  return sha256Canonical(bindingTuple);
}

function observationPayload(input) {
  const payload = {
    schema_version: input.schema_version,
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    operation: input.operation,
    observed_at: input.observed_at,
    authority: input.authority,
    source: input.source,
    scope: input.scope,
    supersedes: input.supersedes,
  };
  if (input.operation === "retract") payload.target_observation_id = input.target_observation_id;
  return payload;
}

export function createObservation(input) {
  assertExactKeys(
    input,
    ["schema_version", "subject", "predicate", "object", "operation", "observed_at", "authority", "source", "scope", "supersedes"],
    ["target_observation_id"],
    "observation input",
  );
  const payload = observationPayload(input);
  const digest = sha256Canonical(payload);
  return { ...payload, id: `obs:${digest}`, payload_sha256: digest };
}

function authorityClaim(observation) {
  return {
    observation_id: observation.id,
    claim_sha256: sha256Canonical(observationPayload(observation)),
  };
}

export function createAuthorityManifest(observations) {
  if (!Array.isArray(observations)) fail("authority manifest observations must be an array");
  const claims = observations.map(authorityClaim).sort((a, b) => a.observation_id.localeCompare(b.observation_id));
  if (new Set(claims.map((claim) => claim.observation_id)).size !== claims.length) fail("authority manifest has duplicate observation IDs");
  const payload = { schema_version: 1, claims };
  return { ...payload, manifest_sha256: sha256Canonical(payload) };
}

function validateAuthorityManifest(manifest, observations) {
  assertExactKeys(manifest, ["schema_version", "claims", "manifest_sha256"], [], "authority manifest");
  if (manifest.schema_version !== 1) fail("unknown authority manifest schema_version");
  if (!Array.isArray(manifest.claims) || manifest.claims.length > LIMITS.observations) fail("authority manifest claims must be a bounded array");
  const expected = createAuthorityManifest(observations);
  for (const claim of manifest.claims) {
    assertExactKeys(claim, ["observation_id", "claim_sha256"], [], "authority manifest claim");
    if (!OBSERVATION_ID_RE.test(claim.observation_id)) fail("authority manifest claim has invalid observation ID");
    assertSha(claim.claim_sha256, "authority manifest claim digest");
  }
  assertSha(manifest.manifest_sha256, "authority manifest hash");
  if (canonicalJson(manifest) !== canonicalJson(expected)) {
    fail("observation claim is absent from or differs from the independent authority manifest");
  }
  return manifest;
}

function validateObservation(observation, sourceAuthorities) {
  assertExactKeys(
    observation,
    ["schema_version", "id", "subject", "predicate", "object", "operation", "observed_at", "authority", "source", "scope", "supersedes", "payload_sha256"],
    ["target_observation_id"],
    "Observation",
  );
  if (observation.schema_version !== 1) fail("unknown Observation schema_version");
  if (!OBSERVATION_ID_RE.test(observation.id)) fail("Observation id has invalid shape");
  assertEntity(observation.subject, "Observation subject");
  if (!BASE_OBSERVATION_PREDICATES.includes(observation.predicate)) {
    if (DERIVED_ONLY_PREDICATES.includes(observation.predicate)) fail(`derived-only predicate cannot be observed: ${observation.predicate}`);
    fail(`unknown predicate ${observation.predicate}`);
  }
  assertPredicateObject(observation.predicate, observation.object, "Observation object");
  if (!REGISTERED_OPERATIONS.includes(observation.operation)) fail(`unknown operation ${observation.operation}`);
  const timestampWithMillis = typeof observation.observed_at === "string" && !observation.observed_at.includes(".")
    ? observation.observed_at.replace(/Z$/, ".000Z")
    : observation.observed_at;
  if (typeof observation.observed_at !== "string" || !RFC3339_RE.test(observation.observed_at) || Number.isNaN(Date.parse(observation.observed_at)) || new Date(observation.observed_at).toISOString() !== timestampWithMillis) {
    fail("Observation observed_at must be RFC 3339 UTC");
  }
  if (!REGISTERED_AUTHORITIES.includes(observation.authority)) fail(`unknown authority ${observation.authority}`);
  assertExactKeys(observation.source, ["path", "sha256"], ["selector"], "Observation source");
  const sourceAuthority = sourceAuthorities[observation.source.path];
  if (!sourceAuthority) fail(`source path is not allowed: ${observation.source.path}`);
  assertSha(observation.source.sha256, "Observation source hash");
  if (observation.source.sha256 !== sourceAuthority.sha256) fail(`source hash is not authorized for ${observation.source.path}`);
  if (!sourceAuthority.authorities.includes(observation.authority)) fail(`authority ${observation.authority} is not authorized for ${observation.source.path}`);
  if (Object.hasOwn(observation.source, "selector")) assertToken(observation.source.selector, "Observation source selector");
  assertExactKeys(observation.scope, ["repository", "work_order", "phase"], [], "Observation scope");
  assertToken(observation.scope.repository, "Observation repository scope");
  assertEntity(observation.scope.work_order, "Observation work-order scope");
  assertToken(observation.scope.phase, "Observation phase scope");
  if (!Array.isArray(observation.supersedes) || observation.supersedes.length > LIMITS.observations) fail("Observation supersedes must be a bounded array");
  if (new Set(observation.supersedes).size !== observation.supersedes.length || canonicalJson(observation.supersedes) !== canonicalJson([...observation.supersedes].sort())) {
    fail("Observation supersedes must be unique and sorted");
  }
  for (const id of observation.supersedes) if (!OBSERVATION_ID_RE.test(id)) fail("Observation supersedes has invalid ID");
  if (observation.operation === "retract") {
    if (!OBSERVATION_ID_RE.test(observation.target_observation_id ?? "")) fail("retract requires target_observation_id");
    if (observation.supersedes.length !== 0) fail("retract cannot also supersede");
  } else if (Object.hasOwn(observation, "target_observation_id")) {
    fail("assert forbids target_observation_id");
  }
  assertSha(observation.payload_sha256, "Observation payload hash");
  const expected = sha256Canonical(observationPayload(observation));
  if (observation.payload_sha256 !== expected || observation.id !== `obs:${expected}`) fail("Observation content hashes do not match canonical payload");
  return observation;
}

function factId(subject, predicate, object) {
  return `fact:${sha256Canonical({ subject, predicate, object })}`;
}

function proofRecord(payload) {
  const digest = sha256Canonical(payload);
  return { ...payload, id: `proof:${digest}`, payload_sha256: digest };
}

function validateInput(input, authorityManifest, sourceAuthorities) {
  assertExactKeys(input, ["schema_version", "rule_ids", "observations"], [], "analysis input");
  if (input.schema_version !== 1) fail("unknown analysis input schema_version");
  if (!Array.isArray(input.rule_ids) || canonicalJson(input.rule_ids) !== canonicalJson(REGISTERED_RULE_IDS)) {
    fail("rule_ids must exactly match the code-owned rule registry");
  }
  if (!Array.isArray(input.observations) || input.observations.length > LIMITS.observations) fail("observations must be a bounded array");
  const observations = input.observations.map((observation) => validateObservation(observation, sourceAuthorities));
  validateAuthorityManifest(authorityManifest, observations);
  const byId = new Map();
  for (const observation of observations) {
    if (byId.has(observation.id)) fail(`duplicate Observation id ${observation.id}`);
    byId.set(observation.id, observation);
  }
  const closureOwners = new Map();
  for (const observation of observations) {
    const targets = observation.operation === "retract" ? [observation.target_observation_id] : observation.supersedes;
    for (const targetId of targets) {
      const target = byId.get(targetId);
      if (!target || target.operation !== "assert") fail(`closure target is not an asserted Observation: ${targetId}`);
      const sameTuple = target.subject === observation.subject && target.predicate === observation.predicate;
      const sameObjectWhenRetracting = observation.operation !== "retract" || canonicalJson(target.object) === canonicalJson(observation.object);
      if (!sameTuple || !sameObjectWhenRetracting) {
        fail(`closure target tuple does not match ${observation.id}`);
      }
      if (Date.parse(observation.observed_at) <= Date.parse(target.observed_at)) fail(`closure target is not prior to ${observation.id}`);
      if (closureOwners.has(targetId)) fail(`closure target is not active exactly once: ${targetId}`);
      closureOwners.set(targetId, observation.id);
    }
  }
  // Cyclic supersession would make proof validity order-dependent.
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) fail("cyclic supersession/proof input");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of byId.get(id)?.supersedes ?? []) visit(target);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  return observations;
}

function tupleKey(subject, predicate) {
  return `${subject}\u0000${predicate}`;
}

function logicalKey(subject, predicate, object) {
  return `${subject}\u0000${predicate}\u0000${canonicalJson(object)}`;
}

function cartesian(items, limit = LIMITS.proof_paths_per_fact) {
  let rows = [[]];
  for (const choices of items) {
    const next = [];
    for (const row of rows) {
      for (const choice of choices) {
        next.push([...row, choice]);
        if (next.length > limit) fail("proof path limit exceeded; refusing incomplete provenance");
      }
    }
    rows = next;
  }
  return rows;
}

function deriveState(observations, snapshotEpoch, factEpochFor) {
  const byId = new Map(observations.map((observation) => [observation.id, observation]));
  const closed = new Set();
  for (const observation of observations) {
    if (observation.operation === "retract") closed.add(observation.target_observation_id);
    for (const target of observation.supersedes) closed.add(target);
  }
  const active = observations
    .filter((observation) => observation.operation === "assert" && !closed.has(observation.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  const baseGroups = new Map();
  const proofs = new Map();
  for (const observation of active) {
    const key = logicalKey(observation.subject, observation.predicate, observation.object);
    const group = baseGroups.get(key) ?? [];
    group.push(observation);
    baseGroups.set(key, group);
  }

  const baseFacts = new Map();
  for (const group of baseGroups.values()) {
    const first = group[0];
    const id = factId(first.subject, first.predicate, first.object);
    const supports = [];
    for (const observation of group.sort((a, b) => a.id.localeCompare(b.id))) {
      const proof = proofRecord({
        schema_version: 1,
        kind: "observation",
        fact_id: id,
        rule_id: null,
        premise_fact_ids: [],
        premise_proof_ids: [],
        observation_ids: [observation.id],
      });
      proofs.set(proof.id, proof);
      supports.push(proof.id);
    }
    baseFacts.set(id, {
      kind: "base",
      id,
      subject: first.subject,
      predicate: first.predicate,
      object: first.object,
      epoch: factEpochFor(id),
      supports: supports.sort(),
    });
  }

  function contradictionKeys(facts) {
      const values = new Map();
    for (const fact of facts.values()) {
      if (TOKEN_PREDICATES.has(fact.predicate)) continue;
      const key = tupleKey(fact.subject, fact.predicate);
      const set = values.get(key) ?? new Set();
      set.add(canonicalJson(fact.object));
      values.set(key, set);
    }
    return new Set([...values].filter(([, set]) => set.size > 1).map(([key]) => key));
  }

  let blockedKeys = contradictionKeys(baseFacts);
  let derivedFacts = new Map();
  let allFacts = new Map(baseFacts);
  for (let conflictPass = 0; conflictPass <= REGISTERED_PREDICATES.length; conflictPass += 1) {
    derivedFacts = new Map();
    allFacts = new Map(baseFacts);
    const usable = (subject, predicate, object = true) => [...allFacts.values()].filter(
      (fact) => fact.subject === subject && fact.predicate === predicate && canonicalJson(fact.object) === canonicalJson(object) && !blockedKeys.has(tupleKey(subject, predicate)),
    );
    const usableAny = (subject, predicate) => [...allFacts.values()].filter(
      (fact) => fact.subject === subject && fact.predicate === predicate && !blockedKeys.has(tupleKey(subject, predicate)),
    );
    const addDerived = (subject, predicate, object, ruleId, premiseFacts) => {
      const id = factId(subject, predicate, object);
      const proofCombinations = cartesian(premiseFacts.map((fact) => fact.supports));
      const newSupports = [];
      for (const premiseProofIds of proofCombinations) {
        const observationIds = [...new Set(premiseProofIds.flatMap((proofId) => proofs.get(proofId).observation_ids))].sort();
        const proof = proofRecord({
          schema_version: 1,
          kind: "derived",
          fact_id: id,
          rule_id: ruleId,
          premise_fact_ids: premiseFacts.map((fact) => fact.id).sort(),
          premise_proof_ids: [...premiseProofIds].sort(),
          observation_ids: observationIds,
        });
        proofs.set(proof.id, proof);
        newSupports.push(proof.id);
      }
      const previous = derivedFacts.get(id);
      const supports = [...new Set([...(previous?.supports ?? []), ...newSupports])].sort();
      if (supports.length > LIMITS.proof_paths_per_fact) fail("proof path limit exceeded; refusing incomplete provenance");
      const rule_id = previous?.rule_id ?? ruleId;
      if (previous && rule_id !== ruleId) fail("multiple rule IDs for one DerivedFact are outside the V1 contract");
      const payload = { subject, predicate, object, epoch: factEpochFor(id), rule_id, supports };
      const fact = { id, ...payload, payload_sha256: sha256Canonical(payload) };
      const changed = !previous || canonicalJson(previous.supports) !== canonicalJson(supports);
      derivedFacts.set(id, fact);
      allFacts.set(id, fact);
      return changed;
    };

    for (let round = 0; round <= RULES.length + LIMITS.tuple_items; round += 1) {
      let changed = false;
      const subjects = [...new Set([...allFacts.values()].map((fact) => fact.subject))].sort();
      for (const subject of subjects) {
        const bindingFact = usableAny(subject, "binding_exact")[0];
        const binding = bindingFact?.object;
        const bindingIdentity = binding ? bindingIdentitySha256(binding) : null;
        const replayFact = usableAny(subject, "replay_deterministic").find((fact) =>
          fact.object[0] === bindingIdentity && fact.object[6] === binding?.[4] && fact.object[7] === binding?.[5]
        );
        const ownerFact = usableAny(subject, "distinct_semantic_owners").find((fact) =>
          fact.object[0] === bindingIdentity && fact.object[1] === binding?.[4]
        );
        const contaminationFact = usableAny(subject, "contamination_clear").find((fact) =>
          fact.object[0] === bindingIdentity && fact.object[1] === binding?.[0] && fact.object[2] === true
        );
        const taskPremises = [bindingFact, replayFact, ownerFact, contaminationFact];
        if (taskPremises.every(Boolean)) changed = addDerived(subject, "task_binding_viable", true, "rule.task_binding_viable.v1", taskPremises) || changed;

        const bindingSets = [...allFacts.values()].filter((fact) => fact.subject === subject && fact.predicate === "required_binding_set_exact" && !blockedKeys.has(tupleKey(subject, fact.predicate)));
        for (const setFact of bindingSets) {
          const viable = setFact.object.map((taskId) => usable(taskId, "task_binding_viable")[0]);
          if (viable.every(Boolean)) changed = addDerived(subject, "every_required_binding_viable", true, "rule.every_required_binding_viable.v1", [setFact, ...viable]) || changed;
        }
        const exactBindingSet = bindingSets[0];
        if (exactBindingSet && usable(subject, "every_required_binding_viable")[0]) changed = addDerived(subject, "work_order_inputs_viable", true, "rule.work_order_inputs_viable.v1", [exactBindingSet, usable(subject, "every_required_binding_viable")[0]]) || changed;

        const trustPremises = ["receipt_schema_closed", "receipt_externally_anchored", "negative_probes_observed"].map((predicate) => usable(subject, predicate)[0]);
        if (trustPremises.every(Boolean)) changed = addDerived(subject, "evidence_trusted", true, "rule.evidence_trusted.v1", trustPremises) || changed;

        const reviewSets = [...allFacts.values()].filter((fact) => fact.subject === subject && fact.predicate === "required_review_set_exact" && !blockedKeys.has(tupleKey(subject, fact.predicate)));
        for (const setFact of reviewSets) {
          const reviewFacts = setFact.object.map((reviewId) => usable(reviewId, "review_go")[0]);
          if (reviewFacts.every(Boolean)) changed = addDerived(subject, "every_required_review_go", true, "rule.every_required_review_go.v1", [setFact, ...reviewFacts]) || changed;
        }
        if (reviewSets[0] && usable(subject, "every_required_review_go")[0]) changed = addDerived(subject, "required_reviews_go", true, "rule.required_reviews_go.v1", [reviewSets[0], usable(subject, "every_required_review_go")[0]]) || changed;

        const blockers = [...allFacts.values()].filter((fact) => fact.subject === subject && fact.predicate === "blocker_active");
        const relatedSubjects = new Set([
          subject,
          ...(bindingSets[0]?.object ?? []),
          ...(reviewSets[0]?.object ?? []),
        ]);
        const hasRelevantContradiction = [...blockedKeys].some((key) => relatedSubjects.has(key.split("\u0000")[0]));
        const hasReadyPremiseContradiction = [...blockedKeys].some((key) => key !== tupleKey(subject, "review_ready") && relatedSubjects.has(key.split("\u0000")[0]));
        const readyPremises = ["work_order_inputs_viable", "evidence_trusted", "required_reviews_go"].map((predicate) => usable(subject, predicate)[0]);
        if (readyPremises.every(Boolean) && blockers.length === 0 && !hasReadyPremiseContradiction) changed = addDerived(subject, "review_ready", true, "rule.review_ready.v1", readyPremises) || changed;
        const acceptedPremises = [usable(subject, "review_ready")[0], usable(subject, "human_approval")[0]];
        if (acceptedPremises.every(Boolean) && blockers.length === 0 && !hasRelevantContradiction) changed = addDerived(subject, "accepted", true, "rule.accepted.v1", acceptedPremises) || changed;

        for (const blocker of blockers) changed = addDerived(subject, "blocked", blocker.object, "rule.blocked.v1", [blocker]) || changed;
      }
      if (!changed) break;
      if (round === RULES.length + LIMITS.tuple_items) fail("cyclic or non-terminating proof derivation");
    }
    const nextBlockedKeys = contradictionKeys(allFacts);
    const addedConflict = [...nextBlockedKeys].some((key) => !blockedKeys.has(key));
    blockedKeys = new Set([...blockedKeys, ...nextBlockedKeys]);
    if (!addedConflict) break;
    if (conflictPass === REGISTERED_PREDICATES.length) fail("contradiction closure did not converge");
  }

  const contradictions = [...blockedKeys].map((key) => {
    const [subject, predicate] = key.split("\u0000");
    const conflicting = [...allFacts.values()].filter((fact) => fact.subject === subject && fact.predicate === predicate);
    const values = conflicting.map((fact) => ({
      object: fact.object,
      fact_id: fact.id,
      observation_ids: [...new Set(fact.supports.flatMap((proofId) => proofs.get(proofId).observation_ids))].sort(),
    })).map((value) => ({
      ...value,
      sources: value.observation_ids.map((observationId) => {
        const observation = byId.get(observationId);
        return {
          observation_id: observation.id,
          path: observation.source.path,
          sha256: observation.source.sha256,
          selector: observation.source.selector ?? null,
        };
      }),
    })).sort((a, b) => canonicalJson(a.object).localeCompare(canonicalJson(b.object)));
    const payload = { subject, predicate, values };
    return { id: `contradiction:${sha256Canonical(payload)}`, ...payload, payload_sha256: sha256Canonical(payload) };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const blockers = [...derivedFacts.values()].filter((fact) => fact.predicate === "blocked").sort((a, b) => a.id.localeCompare(b.id));
  const ruleset_sha256 = sha256Canonical(RULES);
  const observation_head_sha256 = sha256Canonical([...observations].sort((a, b) => a.id.localeCompare(b.id)));
  const derived_facts = [...derivedFacts.values()].sort((a, b) => a.id.localeCompare(b.id));
  const snapshotPayload = {
    schema_version: 1,
    epoch: snapshotEpoch,
    ruleset_sha256,
    observation_head_sha256,
    active_observation_count: active.length,
    derived_facts,
    contradictions,
    blockers,
  };
  const snapshot = { ...snapshotPayload, snapshot_sha256: sha256Canonical(snapshotPayload) };
  return { observations, byId, active, baseFacts, derivedFacts, allFacts, proofs, contradictions, blockers, blockedKeys, snapshot };
}

function factView(fact) {
  return fact.kind === "base" ? { ...fact } : { kind: "derived", ...fact };
}

function sourceRef(observation) {
  return { observation_id: observation.id, path: observation.source.path, sha256: observation.source.sha256, selector: observation.source.selector ?? null };
}

export class AnalysisState {
  #epoch = 0;
  #state;
  #history = [];
  #factEpochs = new Map();
  #snapshotEpochs = new Map();
  #authorityManifestSha256;
  #sourceAuthorities;

  constructor(input, authorityManifest, sourceAuthorities) {
    this.#sourceAuthorities = createSourceAuthorityRegistry(sourceAuthorities);
    this.#replace(input, authorityManifest, true);
  }

  #replace(input, authorityManifest, initial) {
    const observations = validateInput(input, authorityManifest, this.#sourceAuthorities);
    const previous = this.#state;
    const nextEpoch = this.#epoch + 1;
    const observationHead = sha256Canonical([...observations].sort((a, b) => a.id.localeCompare(b.id)));
    if (!initial && previous.snapshot.observation_head_sha256 === observationHead) {
      fail("replacement input is identical; no new epoch admitted");
    }
    if (nextEpoch > LIMITS.change_epochs) fail("change epoch bound exceeded");
    const candidateFactEpochs = new Map(this.#factEpochs);
    const factEpochFor = (id) => {
      if (!candidateFactEpochs.has(id)) candidateFactEpochs.set(id, nextEpoch);
      return candidateFactEpochs.get(id);
    };
    const snapshotEpoch = this.#snapshotEpochs.get(observationHead) ?? nextEpoch;
    const nextState = deriveState(observations, snapshotEpoch, factEpochFor);
    this.#epoch = nextEpoch;
    this.#state = nextState;
    this.#authorityManifestSha256 = authorityManifest.manifest_sha256;
    this.#factEpochs = candidateFactEpochs;
    this.#snapshotEpochs.set(observationHead, snapshotEpoch);
    const previousIds = new Set(previous ? previous.allFacts.keys() : []);
    const currentIds = new Set(this.#state.allFacts.keys());
    const added = [...currentIds].filter((id) => !previousIds.has(id)).sort();
    const retracted = [...previousIds].filter((id) => !currentIds.has(id)).sort();
    const changed = [...currentIds].filter((id) => previousIds.has(id) && canonicalJson(factView(previous.allFacts.get(id))) !== canonicalJson(factView(this.#state.allFacts.get(id)))).sort();
    const previousProofIds = new Set(previous ? previous.proofs.keys() : []);
    const currentProofIds = new Set(this.#state.proofs.keys());
    const addedProofs = [...currentProofIds].filter((id) => !previousProofIds.has(id)).sort();
    const retractedProofs = [...previousProofIds].filter((id) => !currentProofIds.has(id)).sort();
    this.#history.push({
      epoch: this.#epoch,
      added_facts: added.map((id) => factView(this.#state.allFacts.get(id))),
      retracted_facts: retracted.map((id) => factView(previous.allFacts.get(id))),
      changed_facts: changed.map((id) => {
        const before = factView(previous.allFacts.get(id));
        const after = factView(this.#state.allFacts.get(id));
        return {
          id,
          before,
          after,
          added_support_ids: after.supports.filter((supportId) => !before.supports.includes(supportId)).sort(),
          retracted_support_ids: before.supports.filter((supportId) => !after.supports.includes(supportId)).sort(),
        };
      }),
      added_proofs: addedProofs.map((id) => structuredClone(this.#state.proofs.get(id))),
      retracted_proofs: retractedProofs.map((id) => structuredClone(previous.proofs.get(id))),
    });
  }

  replace(input, authorityManifest) {
    this.#replace(input, authorityManifest, false);
    return this.snapshot;
  }

  get epoch() { return this.#epoch; }
  get snapshot() { return structuredClone(this.#state.snapshot); }
  get snapshotBytes() { return `${canonicalJson(this.#state.snapshot)}\n`; }
  get statistics() {
    return Object.freeze({
      epoch: this.#epoch,
      snapshot_epoch: this.#state.snapshot.epoch,
      authority_manifest_sha256: this.#authorityManifestSha256,
      observation_count: this.#state.observations.length,
      active_observation_count: this.#state.active.length,
      base_fact_count: this.#state.baseFacts.size,
      derived_fact_count: this.#state.derivedFacts.size,
      active_fact_count: this.#state.allFacts.size,
      proof_count: this.#state.proofs.size,
      contradiction_count: this.#state.contradictions.length,
      blocker_count: this.#state.blockers.length,
      rule_count: REGISTERED_RULE_IDS.length,
    });
  }

  query(subject, predicate) {
    assertEntity(subject, "query subject");
    if (!REGISTERED_PREDICATES.includes(predicate)) fail(`unknown query predicate ${predicate}`);
    const matches = [...this.#state.allFacts.values()].filter((fact) => fact.subject === subject && fact.predicate === predicate).sort((a, b) => a.id.localeCompare(b.id));
    if (matches.length > LIMITS.query_results) fail("query result bound exceeded");
    return matches.map(factView);
  }

  why(id) {
    const fact = this.#state.allFacts.get(id);
    if (!fact) fail(`unknown active fact ${id}`);
    if (fact.supports.length > LIMITS.proof_paths_per_fact) fail("proof path result bound exceeded");
    const paths = fact.supports.map((rootProofId) => {
      const visited = new Set();
      const visiting = new Set();
      const visit = (proofId) => {
        if (visiting.has(proofId)) fail("cyclic proof graph");
        if (visited.has(proofId)) return;
        visiting.add(proofId);
        const proof = this.#state.proofs.get(proofId);
        if (!proof) fail(`missing proof ${proofId}`);
        for (const premiseId of proof.premise_proof_ids) visit(premiseId);
        visiting.delete(proofId);
        visited.add(proofId);
        if (visited.size > LIMITS.proof_nodes_per_query) fail("proof node result bound exceeded");
      };
      visit(rootProofId);
      const graph = [...visited].sort().map((proofId) => structuredClone(this.#state.proofs.get(proofId)));
      const observationIds = [...new Set(graph.flatMap((proof) => proof.observation_ids))].sort();
      return {
        proof_id: rootProofId,
        observation_ids: observationIds,
        sources: observationIds.map((observationId) => sourceRef(this.#state.byId.get(observationId))),
        proof_graph: graph,
      };
    }).sort((a, b) => a.proof_id.localeCompare(b.proof_id));
    return assertRenderedBound(
      { fact: factView(fact), paths, bounded: true, limits: { paths: LIMITS.proof_paths_per_fact, nodes_per_path: LIMITS.proof_nodes_per_query, rendered_bytes: LIMITS.rendered_bytes } },
      "why",
    );
  }

  whyNot(subject, predicate) {
    assertEntity(subject, "why_not subject");
    if (!REGISTERED_PREDICATES.includes(predicate)) fail(`unknown why_not predicate ${predicate}`);
    const missing = new Map();
    const contradictionMap = new Map();
    const constraintFailures = new Map();
    let nodeCount = 0;
    const contradictionFor = (targetSubject, targetPredicate) => this.#state.contradictions.find(
      (item) => item.subject === targetSubject && item.predicate === targetPredicate,
    );
    const evidenceForFact = (fact) => {
      const observationIds = [...new Set(fact.supports.flatMap((proofId) => this.#state.proofs.get(proofId).observation_ids))].sort();
      return {
        fact_id: fact.id,
        object: fact.object,
        observation_ids: observationIds,
        sources: observationIds.map((observationId) => sourceRef(this.#state.byId.get(observationId))),
      };
    };
    const addMissing = (missingSubject, missingPredicate, object = true) => {
      const key = logicalKey(missingSubject, missingPredicate, object);
      if (!missing.has(key)) {
        missing.set(key, {
          subject: missingSubject,
          predicate: missingPredicate,
          object,
          contrary_facts: this.query(missingSubject, missingPredicate).map(evidenceForFact),
        });
      }
    };
    const isDerivable = (targetSubject, targetPredicate) => {
      if (contradictionFor(targetSubject, targetPredicate)) return false;
      const facts = this.query(targetSubject, targetPredicate);
      return BOOLEAN_PREDICATES.has(targetPredicate) ? facts.some((fact) => fact.object === true) : facts.length > 0;
    };
    const explain = (targetSubject, targetPredicate, seen = new Set()) => {
      nodeCount += 1;
      if (nodeCount > LIMITS.why_not_items) fail("why_not explanation node bound exceeded");
      const key = tupleKey(targetSubject, targetPredicate);
      if (seen.has(key)) fail("cyclic why_not explanation");
      const nextSeen = new Set([...seen, key]);
      const contradiction = contradictionFor(targetSubject, targetPredicate);
      if (contradiction) contradictionMap.set(contradiction.id, contradiction);
      const facts = this.query(targetSubject, targetPredicate);
      const derivable = isDerivable(targetSubject, targetPredicate);
      const node = {
        subject: targetSubject,
        predicate: targetPredicate,
        derivable,
        fact_ids: facts.map((fact) => fact.id),
        contradiction_ids: contradiction ? [contradiction.id] : [],
        premises: [],
      };
      if (derivable) return node;
      if (targetPredicate === "accepted") {
        node.premises.push(explain(targetSubject, "review_ready", nextSeen), explain(targetSubject, "human_approval", nextSeen));
      } else if (targetPredicate === "blocked") {
        node.premises.push(explain(targetSubject, "blocker_active", nextSeen));
      } else if (targetPredicate === "review_ready") {
        node.premises.push(...["work_order_inputs_viable", "evidence_trusted", "required_reviews_go"].map((premise) => explain(targetSubject, premise, nextSeen)));
      } else if (targetPredicate === "work_order_inputs_viable") {
        node.premises.push(explain(targetSubject, "required_binding_set_exact", nextSeen), explain(targetSubject, "every_required_binding_viable", nextSeen));
      } else if (targetPredicate === "every_required_binding_viable") {
        node.premises.push(explain(targetSubject, "required_binding_set_exact", nextSeen));
        const sets = this.query(targetSubject, "required_binding_set_exact");
        if (sets.length && !contradictionFor(targetSubject, "required_binding_set_exact")) {
          node.premises.push(...sets[0].object.map((taskId) => explain(taskId, "task_binding_viable", nextSeen)));
        }
      } else if (targetPredicate === "evidence_trusted") {
        node.premises.push(...["receipt_schema_closed", "receipt_externally_anchored", "negative_probes_observed"].map((premise) => explain(targetSubject, premise, nextSeen)));
      } else if (targetPredicate === "required_reviews_go") {
        node.premises.push(explain(targetSubject, "required_review_set_exact", nextSeen), explain(targetSubject, "every_required_review_go", nextSeen));
      } else if (targetPredicate === "every_required_review_go") {
        node.premises.push(explain(targetSubject, "required_review_set_exact", nextSeen));
        const sets = this.query(targetSubject, "required_review_set_exact");
        if (sets.length && !contradictionFor(targetSubject, "required_review_set_exact")) {
          node.premises.push(...sets[0].object.map((reviewId) => explain(reviewId, "review_go", nextSeen)));
        }
      } else if (targetPredicate === "task_binding_viable") {
        node.premises.push(...["binding_exact", "replay_deterministic", "distinct_semantic_owners", "contamination_clear"].map((premise) => explain(targetSubject, premise, nextSeen)));
        if (node.premises.every((premise) => premise.derivable)) {
          const binding = this.query(targetSubject, "binding_exact")[0];
          const replay = this.query(targetSubject, "replay_deterministic")[0];
          const owners = this.query(targetSubject, "distinct_semantic_owners")[0];
          const contamination = this.query(targetSubject, "contamination_clear")[0];
          const expectedIdentity = bindingIdentitySha256(binding.object);
          const failures = [];
          if (replay.object[0] !== expectedIdentity || owners.object[0] !== expectedIdentity || contamination.object[0] !== expectedIdentity) failures.push("binding_identity_mismatch");
          if (replay.object[6] !== binding.object[4] || replay.object[7] !== binding.object[5] || owners.object[1] !== binding.object[4]) failures.push("replay_or_owner_hash_mismatch");
          if (contamination.object[1] !== binding.object[0]) failures.push("contamination_task_hash_mismatch");
          for (const code of failures) constraintFailures.set(`${targetSubject}\u0000${code}`, {
            subject: targetSubject,
            code,
            evidence: [binding, replay, owners, contamination].map(evidenceForFact),
          });
        }
      } else {
        addMissing(targetSubject, targetPredicate, BOOLEAN_PREDICATES.has(targetPredicate) ? true : null);
      }
      return node;
    };
    const explanation = explain(subject, predicate);
    if (!explanation.derivable && (predicate === "review_ready" || predicate === "accepted")) {
      const bindingSet = contradictionFor(subject, "required_binding_set_exact")
        ? null
        : this.query(subject, "required_binding_set_exact")[0];
      const reviewSet = contradictionFor(subject, "required_review_set_exact")
        ? null
        : this.query(subject, "required_review_set_exact")[0];
      const relatedSubjects = new Set([subject, ...(bindingSet?.object ?? []), ...(reviewSet?.object ?? [])]);
      const relatedContradictions = this.#state.contradictions.filter((item) => {
        if (!relatedSubjects.has(item.subject)) return false;
        return predicate === "accepted" || item.subject !== subject || item.predicate !== "review_ready";
      });
      if (relatedContradictions.length > 0) {
        for (const contradiction of relatedContradictions) contradictionMap.set(contradiction.id, contradiction);
        constraintFailures.set(`${subject}\u0000relevant_contradiction_guard`, {
          subject,
          code: "relevant_contradiction_guard",
          evidence: relatedContradictions.map((contradiction) => ({
            contradiction_id: contradiction.id,
            subject: contradiction.subject,
            predicate: contradiction.predicate,
            values: contradiction.values,
          })),
        });
      }
    }
    const activeBlockers = this.query(subject, "blocked").map((fact) => ({
      fact: factView(fact),
      paths: this.why(fact.id).paths.map((path) => ({ proof_id: path.proof_id, observation_ids: path.observation_ids, sources: path.sources })),
    }));
    const contradictions = [...contradictionMap.values()].sort((a, b) => a.id.localeCompare(b.id));
    const missingPremises = [...missing.values()].sort((a, b) => logicalKey(a.subject, a.predicate, a.object).localeCompare(logicalKey(b.subject, b.predicate, b.object)));
    if (missingPremises.length + activeBlockers.length + contradictions.length + constraintFailures.size > LIMITS.why_not_items) fail("why_not result bound exceeded");
    const completeWithinRegisteredRules = explanation.derivable || missingPremises.length > 0 || activeBlockers.length > 0 || contradictions.length > 0 || constraintFailures.size > 0;
    return assertRenderedBound({
      subject,
      predicate,
      derivable: explanation.derivable,
      registered_rule_ids: RULES.filter((rule) => rule.output === predicate).map((rule) => rule.id),
      explanation,
      missing_premises: missingPremises,
      active_blockers: activeBlockers,
      contradictions: structuredClone(contradictions),
      constraint_failures: [...constraintFailures.values()].sort((a, b) => `${a.subject}\u0000${a.code}`.localeCompare(`${b.subject}\u0000${b.code}`)),
      complete_within_registered_rules: completeWithinRegisteredRules,
      bounded: true,
      limit: LIMITS.why_not_items,
      rendered_byte_limit: LIMITS.rendered_bytes,
    }, "why_not");
  }

  changesSince(epoch) {
    if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch > this.#epoch) fail("changes_since epoch is invalid");
    const changes = this.#history.filter((change) => change.epoch > epoch);
    const factCount = changes.reduce((count, change) => count + change.added_facts.length + change.retracted_facts.length + change.changed_facts.length + change.added_proofs.length + change.retracted_proofs.length, 0);
    if (changes.length > LIMITS.change_epochs || factCount > LIMITS.change_facts) fail("changes_since result bound exceeded");
    return assertRenderedBound(changes.map((change) => structuredClone(change)), "changes_since");
  }

  observationHistory() {
    return this.#state.observations.map((observation) => ({ ...structuredClone(observation), active: this.#state.active.some((active) => active.id === observation.id) })).sort((a, b) => a.id.localeCompare(b.id));
  }
}

export function evaluateAnalysisState(input, authorityManifest, sourceAuthorities) {
  return new AnalysisState(input, authorityManifest, sourceAuthorities);
}
