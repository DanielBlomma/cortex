# WO-054 Dialect Observation Persistence and Recurrence

## Objective

Persist the accepted all-language dialect observation envelopes as one bounded,
versioned sidecar in the canonical ingest transaction, then add an explicitly
experimental internal path that finds task-relevant comparable implementations
and reports only recurring local structural or implementation shapes.

The result supplies the candidate path needed by WO-055. It does not prove the
all-language hypothesis, generate code, change review behavior, or establish a
stable CLI/MCP contract.

## Starting State

- Start in a fresh session and separate feature worktree from accepted WO-053
  head `763b105`, which contains implementation `bf53d6a` and accepted WO-052.
- Assigned branch: `feature/wo054-dialect-persistence-recurrence`.
- Assigned worktree:
  `/Users/danielnilsson/GIT/cortex-wo054-dialect-persistence-recurrence`.
- Packet/control commit: `fb33477`; implementation starts after that commit.
- Use only this packet and its direct references. Run Cortex
  search/rules/impact before implementation; do not migrate a feature-worktree
  scaffold merely to make the canonical index understand new files.
- All 14 programming-language families and 29 registered modes already expose
  the accepted opt-in `parseCodeWithDialectObservations` composite transport.
- Package version and dependencies remain unchanged. No network, model,
  provider, planner, telemetry, or new subprocess path is authorized.

## Exact Owned Scope

Production changes are limited to these existing files:

1. `scaffold/scripts/lib/ingest/parser-registry.mjs`
2. `scaffold/scripts/lib/ingest/parser-composition.mjs`
3. `scaffold/scripts/ingest-worker.mjs`
4. `scaffold/scripts/lib/ingest/workers.mjs`
5. `scaffold/scripts/lib/ingest/filesystem-boundary.mjs`
6. `scaffold/scripts/lib/ingest/pipeline-stages.mjs`
7. `scaffold/scripts/parsers/csharp.mjs`
8. `scaffold/scripts/parsers/dotnet/CSharpParser/Program.cs`
9. `scaffold/mcp/src/paths.ts`
10. `scaffold/mcp/src/patternEvidence.ts`

Tests may add or change only:

11. `tests/dialect-ingest-sidecar.test.mjs` (new)
12. `tests/ingest-filesystem-boundary.test.mjs`
13. `tests/ingest-worker-crash.test.mjs`
14. `tests/csharp-parser.test.mjs`
15. `tests/roslyn-dialect-adapter.test.mjs`
16. `tests/packed-filesystem-containment.test.mjs`, only if an exact existing
    packed expectation must reflect the owned runtime changes
17. `scaffold/mcp/tests/pattern-evidence.test.mjs`

Do not add a managed production path, change ownership manifests, edit root
`scripts/**` mirrors, or register a public tool. A necessary file outside this
list is a stop-and-split condition.

## Frozen Sidecar Contract

The sole persisted artifact is:

```text
.context/cache/dialect-observations.v1.jsonl
```

It is an experimental cache sidecar, not a graph entity, rule, ADR, convention,
guidance fact, embedding input, or policy authority. Every JSONL line is one
plain canonical file record with exactly:

```text
schema_version: 1
record_type: "dialect_observation_file"
record_id: "dialect-observation-file-v1:" + sha256(canonical record without record_id)
repository_path: canonical repository-relative path
source_sha256: SHA-256 of the exact parsed source bytes
family: canonical manifest family
syntax_mode: canonical manifest extension
observation_envelope: accepted v1 envelope
```

One record exists for every indexed programming-language source mode, including
an explicit non-`ok` envelope for malformed, oversized, unavailable, or
truncated input. Structured non-code inputs have no dialect record. Records are
ordered by `repository_path`; the enclosed observations retain their accepted
canonical ordering and stable IDs. Duplicate paths, IDs, or observations fail
the whole stage.

Use only the accepted canonicalizer, path validator, manifest, limits, envelope
validator, observation ordering, and SHA-256 helper from
`scaffold/scripts/lib/dialect-observation-contract.mjs`. Do not change the
accepted contract/capability/limits/shape hashes and do not create a second
schema or hash authority.

The byte-exact sidecar SHA-256 and these diagnostics are recorded under one
explicitly experimental dialect field in the existing ingest manifest:

- schema version and fixed index identity;
- byte SHA-256;
- file-record and positive-observation counts;
- exact status counts; and
- aggregate observed and omitted counts.

The sidecar is bounded by the already frozen limits: at most
`max_source_catalog_files` file records, at most
`max_observations_per_file` observations per record, each observation at most
`max_observation_json_bytes`, diagnostics at most `max_diagnostic_chars`, and
the complete staged sidecar at most `max_source_catalog_bytes`. Any aggregate
cap failure aborts before manifest-last commit; no partial sidecar or mixed
generation may publish.

## Canonical Ingest Lifecycle

Add the sidecar to the same filesystem-boundary allowlists, exclusive staging,
manifest-last commit, cleanup, and prior-cache preflight as the other canonical
cache outputs. Symlink, hard-link, parent, absolute, redirected cache, replaced
path, and validation-to-read/write identity checks retain the accepted
containment behavior.

Full ingest constructs every record. A true incremental changed ingest:

1. validates and hydrates the prior sidecar through the boundary;
2. removes records for changed and deleted repository paths before parsing;
3. retains only still-indexed unchanged records;
4. replaces each changed record with its new exact envelope; and
5. stages the complete canonically sorted sidecar.

For the same resulting source tree, full and changed ingest must produce
byte-identical sidecar bytes and the same sidecar hash. Missing, malformed,
oversized, non-canonical, hash-mismatched, or stale prior sidecar content fails
closed to a full dialect rebuild without weakening legacy incremental chunk
behavior. A filesystem-policy failure such as a symlink, hard link,
redirection, or replaced path remains fatal and cannot be downgraded to
rebuild. Deleted, renamed, unsupported, source-hash-mismatched, or newly
unparseable sources cannot leave stale positive observations.

Existing documents, chunks, relations, graph imports, embeddings, stdout
contract, and non-dialect manifest fields remain byte/semantic compatible
except for the additive experimental manifest field and the extra staged cache
artifact.

## One-Pass Parser and Worker Integration

The registry exposes the accepted composite parser only for the 29 canonical
programming-language modes. Markdown and structured non-code modes retain their
legacy parse path.

For code modes, each source is parsed once. The pipeline consumes
`transport.parser_result` for the exact existing chunk/error flow and consumes
`transport.observation_envelope` only for the sidecar. It must never call
`parseCode` and `parseCodeWithDialectObservations` for the same source.

The worker request remains an exact closed record and explicitly selects the
composite code path. A successful composite worker response is the accepted
exact v1 dialect transport. Validate it with the packaged runtime authority
before retaining or posting it. Hidden, inherited, accessor, Proxy, raw-syntax,
unknown-key, oversized, or legacy-looking hybrid payloads are protocol errors,
not inline downgrade candidates. Filesystem policy errors retain their exact
fatal envelope. Worker crash or ordinary skip may fall back to one inline
composite parse.

C# canonical ingest currently uses project-wide Roslyn batch parsing to retain
semantic call resolution. Extend that same native batch invocation with an
explicit dialect option and return one validated transport per file. Do not
disable batching, parse C# twice, lose fully-qualified calls, or alter the
normal `parseProject(files)` result. Invalid or missing dialect batch data
produces an explicit non-positive envelope while preserving the legacy batch
parser result.

## Experimental Comparable-Implementation and Recurrence Path

Add the implementation to the existing `patternEvidence.ts` internal module
and export it for focused tests/evaluator use only. Do not register it in
`server.ts`, add a CLI command, change `context.search`, `context.related`,
`context.impact`, conventions, guidance, review, or tool schemas.

The internal call accepts one frozen task binding, its exact externally held
task bytes, its frozen source catalog, the current ingest manifest/sidecar, and
existing context data. It must:

1. validate task bytes and SHA-256 against the binding and `max_task_bytes`,
   exact family, sorted canonical source scope, source hashes,
   manifest-sidecar hash, and all sidecar records;
2. obtain at most 50 candidates from one accepted search call with explicit
   `top_k: 50`, minimal content, and `query_vector: null` so this experiment is
   deterministic lexical/graph-only and cannot load or call an embedding
   model;
3. keep only non-window code chunks in the task family and frozen local source
   scope, with exact chunk/path ownership and an observation citation;
4. keep an observation only when its `source_sha256` record equals the frozen
   catalog hash, then group by exact family, category, normalized shape, and
   language-specific shape;
5. call a group recurring only when the same key has at least two distinct
   comparable implementation owners and two distinct unchanged source spans;
6. cap citations at `max_citations_per_claim`, claims at
   `max_claims_per_task`, diagnostics at `max_diagnostics_per_task`, and output
   bytes at `max_rendered_output_bytes`; and
7. return the exact `createEvaluationOutput`-compatible claim/citation shape
   required by the accepted blind harness.

An implementation owner is `containing_chunk_id` when that ID resolves to the
selected non-window chunk; otherwise it is the repository path. Do not merge
two spans in one owner into fake recurrence. Claims and citations are sorted by
stable content-derived IDs. Citation source hashes come only from the frozen
source catalog, never from the sidecar or a caller assertion.

Rendered statements are deterministic, informational, and non-normative. They
state that a shape was observed recurring in comparable local implementations;
they never say `must`, `should`, `required`, `preferred`, or infer intent,
framework semantics, architecture, or unsupported capability. One-off,
ambiguous, insufficient, unsupported, missing-sidecar, hash-drift, no-comparable,
or capped cases emit bounded explicit diagnostics and no positive claim.

## Baseline/Candidate Isolation

The internal dialect function is reachable only by an explicit evaluator call.
Normal MCP startup and every existing tool remain dialect-disabled. WO-055's
baseline uses the accepted non-dialect search/context path and records a zero
observation-index hash; its candidate uses the same task, source tree, source
scope, retrieval budget, and non-dialect inputs plus this exact sidecar and
comparison function. No accepted ranking default or index input changes.

Tests must prove a disabled or absent dialect call leaves existing outputs
byte/deep equal and that candidate output changes only when the validated
observation path is explicitly supplied.

## Required Validation

At minimum run:

```text
node --test tests/dialect-contract.test.mjs tests/dialect-evaluation.test.mjs tests/dialect-runtime-contract.test.mjs
node --test tests/dialect-ingest-sidecar.test.mjs tests/ingest-characterization.test.mjs tests/ingest-parallel.test.mjs tests/ingest-worker-crash.test.mjs
node --test tests/ingest-filesystem-boundary.test.mjs tests/csharp-parser.test.mjs tests/roslyn-dialect-adapter.test.mjs
node --test tests/packed-filesystem-containment.test.mjs
(cd scaffold/mcp && npm test)
npm test
npm pack --dry-run
git diff --check
cortex update
cortex pattern-evidence <each changed file> --json
cortex doctor
cortex watch status
```

Focused tests must additionally prove:

- all 14 families and 29 modes can persist an exact record;
- byte-identical full/changed and sequential/parallel sidecars;
- changed, deleted, renamed, malformed, unavailable, and truncated stale cleanup;
- exact IDs, byte hash, manifest counts, caps, and omission accounting;
- no raw source, AST, parser object, chunk body, or absolute path persistence;
- manifest-last crash cleanup and prior-sidecar containment/rebuild behavior;
- exact composite worker protocol and malicious payload rejection;
- C# batch one-pass dialect plus unchanged semantic call resolution;
- at least two comparable owners are required for a claim;
- scope/family/window/hash drift, duplicate evidence, unsupported capability,
  one-off shape, caps, and insufficient evidence produce no positive claim;
- deterministic claims, citations, diagnostics, and rendered bytes;
- zero model/network/provider/planner/telemetry calls; and
- unchanged package inventory, ownership manifests, versions, dependencies,
  existing public MCP tools, graph, embeddings, conventions, guidance, and
  review behavior.

Run final C# coverage with the existing .NET SDK; a skip cannot satisfy the
batch acceptance gate. Any exact packed/upgrade expectation change must be
derived from the owned files and separately called out; do not change package
contents or ownership to make a test pass.

## Review and Acceptance

Independent Parser/Contract, Security/Containment, and Validation/Integration
reviewers must return GO with no blocker or major finding. Reviewers verify the
exact owned diff, one-pass paths, persisted schema, filesystem lifecycle,
recurrence truth, evaluator compatibility, packed artifact, and unchanged
public behavior. Findings are fixed and re-reviewed before manager acceptance.

## Stop Conditions

Stop and split rather than changing the accepted observation contract hashes,
parser selection/fallbacks, dependencies, versions, ownership, package file
inventory, graph/database schema, embeddings, stable CLI/MCP tools, conventions,
guidance, review, generation, or any file outside exact scope. WO-055 remains
blocked until WO-054 is independently accepted.

## Direct References

- `docs/agent-control/workflow-playbook.md`
- `docs/agent-control/context-packets/010-repo-local-pattern-review.md`
- `docs/agent-control/context-packets/054-all-language-parser-backed-codebase-dialect.md`
- `docs/agent-control/context-packets/055-runtime-dialect-contract-promotion.md`
- `docs/agent-control/context-packets/057-acorn-tree-sitter-dialect-adapters.md`
- `docs/agent-control/context-packets/058-roslyn-lightweight-dialect-adapters.md`
- all production and test files in Exact Owned Scope
- `scaffold/scripts/lib/dialect-observation-contract.mjs`
- `benchmark/bootstrapbench/dialect-contract.mjs`
- `benchmark/bootstrapbench/dialect-evaluation.mjs`
- `tests/dialect-contract.test.mjs`
- `tests/dialect-evaluation.test.mjs`
- `tests/dialect-runtime-contract.test.mjs`

## Start Condition

Start WO-054 only in the separate feature worktree and fresh session named in
the manager handoff. The first implementation action is to freeze baseline
hashes for existing ingest outputs, worker payloads, public MCP tool output,
package inventory, ownership, and the C# batch result. Do not edit before those
baselines are recorded in the work-order handoff.
