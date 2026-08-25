# WO-B First Review Remediation

## Objective

Close the six consolidated major findings from the packet-047 five-role
review, resolve the normal-retrieval/no-model contract conflict, complete the
negative matrix and durable evidence, and return WO-B for fresh review. Do not
start WO-C or WO-D.

## Durable Starting State

- Worktree/branch: `/Users/danielnilsson/GIT/cortex-wo-b-2.5.2`,
  `feature/wo-b-pre-coding-guidance-2.5.2`.
- Accepted base: `d326227`; package/version `2.5.2`; dependencies unchanged.
- Packet 047 owner totals were green, but no reviewer returned PASS. Manager
  triage consolidates the findings below to six majors, all fix-now.
- Code Quality: four majors. Contract: four majors. Security/Privacy: two
  majors. Integration: two majors. Validation: four majors. Overlaps are
  consolidated below; no finding is deferred.
- Read packet 047, every direct reference, full diff, owner results, exact
  reviewer findings, and `scaffold/AGENTS.md`. Use only checkout-local
  `node bin/cortex.mjs` and Cortex search/rules/impact.
- No commit, merge, rebase, dependency/version/release change, acceptance,
  WO-C, or WO-D.

## Manager Contract Resolution — Retrieval Remains Separate

The original program says both “without ... calling a model” and “preserve
normal retrieval evidence; guidance is additive.” Current normal search uses a
local query-embedding model when the semantic index is ready. Guidance cannot
embed the exact normal result without making that prohibited model call.

Resolve the contract as follows:

- Remove `retrieval_evidence` and its counts/caps from guidance schema v1.
- Guidance is only the deterministic task-relevant projection of accepted
  convention profiles: governing rules/ADRs, reusable symbols, concrete
  examples, and conflicts.
- Normal `search`, `related`, and `impact` remain separate, unmodified commands.
  CLI-first agent instructions must run them as needed alongside guidance.
- Prove their public byte contracts/ranking/options are unchanged from accepted
  base. Guidance must never invoke search, embeddings, a model, planner,
  provider, telemetry, fetch, or network.
- Amend packet-047 results/contract documentation accordingly. This is a
  pre-acceptance schema correction, not a compatibility migration.

The version-1 limit formerly named for additive retrieval is removed rather
than retained as a misleading zero-valued field. All other exact limits remain.

## Fix-Now Findings

### 1. Major — one exact pre-context target grammar

- Reject mixed positional target plus `--target`; decide one public form. The
  documented positional form is authoritative, so remove/reject the
  undocumented `--target` alias in runtime and root parsers.
- Replace prefix-only entity acceptance with exact type-specific canonical
  grammar for file, chunk, module, project, rule, and ADR IDs. Reuse the same
  validator in conventions, guidance, and root missing/broken-runtime fallback.
- Reject absolute, drive, backslash, parent, dot/repeated/trailing separator,
  malformed chunk/range, empty suffix, and unsupported entity forms before any
  context/runtime read. Public errors use `[rejected]`; never echo raw target.
- Add runtime/root JSON+text getter/no-state tests and confirm valid accepted
  WO-A targets remain byte-compatible.

### 2. Major — complete recursive and context-aware schema validation

- Validate every public field recursively: exact keys, required types, enums,
  canonical string/path/entity grammar, scalar/byte lengths, finite numeric
  ranges, integer counts, exact score components, arrays/order/uniqueness,
  relevance reason/matched-term provenance, evidence tiers, context source,
  hash and every cross-field/count invariant.
- Add context-aware canonical recomputation/identity/backing validation before
  return. Rehashed fabricated data must fail for every nested record type.
- Every selected item/evidence record must resolve to exactly one eligible
  indexed entity of the declared type, with matching ID/path/lines/relation and
  safe live backing. Reject cross-type ID collisions and stale/substituted data.

### 3. Major — preserve capped item evidence and graph provenance

- Replace singular first-citation projection with canonical evidence arrays for
  governing items, reusable symbols, concrete examples, and conflict claims.
- Retain up to the accepted WO-A evidence cap after canonical/type-aware
  ordering. Preserve relation and line provenance.
- Expose exact per-item `evidence_observed_count` and `evidence_omitted` and
  validate equality/saturation. Do not silently discard accepted WO-A evidence.
- Add mixed relation/type, 10→11 boundary, reversal, stale backing, and
  cross-subsystem evidence tests for each item class.

### 4. Major — exact identity and backing for all guidance items

- Do not validate by ID prefix alone. Bind declared entity type, ID, path, and
  citation to one unique eligible record in its expected collection.
- Cover Rule, ADR, File, Chunk, Module, and Project cross-type collisions,
  duplicates, inactive/non-source-of-truth authority, missing/deleted records,
  symlink leaf/ancestor, special file, hard link, and identity mismatch.
- Preserve active contradictory claims and reject supersession/applicability
  substitutions exactly as accepted WO-A does.

### 5. Major — complete mandatory negative matrix

Expand focused coverage beyond the initial six tests to include every packet-
047 case, adjusted for the retrieval separation above:

- exact/near/over task scalar/byte/response boundaries and all unsafe Unicode;
- strict flags/targets and root loader failures before reads/state;
- zero/one/multiple/multilanguage profiles, closest vs repository fallback;
- authority status/source-of-truth/applicability/conflicts/cycles;
- task normalization, term cap, stop words, Unicode, ties/reversal/no-match;
- every rule/symbol/example/conflict/evidence cap independently and combined;
- complete recursive rehash tampering and live/context backing matrices;
- explicit model/embedding/search/planner/provider/fetch/telemetry/network
  sentinels; guidance state/external-sentinel bytes, identity, links, and mtimes;
- accepted search/related/impact/two-pass and convention output unchanged.

### 6. Major — immutable, fail-closed durable evidence

- Replace all placeholders/ellipses with exact commands and the complete final
  changed/covered file list.
- Pattern reproduction uses `set -euo pipefail`, exact artifact count, JSON
  parsing, `ok === true`, target-set equality, and recorded digests.
- Record live hashes only after the final normal update; include exact command,
  task hash, sizes, guidance hash, counts, and pre/post state byte/mtime proof.
- Reproduce lifecycle/parity, checksums, profile/manifest validation, config
  patch/restoration, doctor/watch/status and all diff/accounting checks.
- Finalize all source/tests/docs/control first, then expanded pattern, restore
  config, final normal update, checksum/profile/live proof. Do not edit covered
  files afterward.

## Validation And Handoff

- Targeted matrices first, then pure guidance, combined conventions/guidance/
  query, full MCP, context/root, frontend, audits, version/syntax/packed, clean
  managed lifecycle/watch/runtime parity.
- Prove guidance makes zero calls to search and every prohibited surface while
  normal retrieval remains byte-identical to accepted base.
- Create a complete finding disposition and current results/control record.
- Fresh Code Quality, Contract, Security/Privacy, Integration, and Validation
  re-review is mandatory. Only manager acceptance may unblock WO-C.
