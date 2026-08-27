# WO-051B Runtime Dialect Contract Promotion

## Objective

Promote the accepted WO-051 dialect-observation contract from its benchmark-only
location into one neutral, packaged, managed runtime module before any parser
adapter is implemented.

This is a narrow shared-boundary prerequisite. It exists so WO-052 and WO-053
can run in parallel against one accepted contract without importing benchmark
code, duplicating validators, weakening the existing parser result, or editing
the shared registry/worker/pipeline at the same time.

## Work Profile

**New contract/design.** This moves contract authority across the package and
managed-scaffold boundary and adds an opt-in in-memory transport contract.
Required reviewers: Code Quality, Contract/Integration, Security/Containment,
and Validation.

## Durable Starting State

- Accepted branch: `feature/wo051-dialect-contract`.
- Accepted HEAD: `8a1ada47670c825ab3c44d020945d082cb158f51`.
- Accepted implementation commit: `2508c20`.
- Package version remains `2.5.2`; no dependency or version change is
  authorized.
- Accepted capability-manifest SHA-256:
  `32ea6b9331a562ba06d87b5f9a01dc1a5487f0619e38040488de813505489f11`.
- Accepted limits SHA-256:
  `aabe57c65a97253e4ae617b00c653ef5f14e2259a5006b354807468e47a1a602`.
- Frozen ownership-v1 SHA-256:
  `b3b97387f541e718ac3b27f677e00cf815cb9bd600b1305391891685f03423ff`.
- The accepted benchmark contract is
  `benchmark/bootstrapbench/dialect-contract.mjs`. It is not present in the npm
  package, while canonical parser modules under `scaffold/scripts/` are
  packaged and explicitly managed.
- Existing parser results are exact `{ chunks, errors }`. The worker and ingest
  pipeline reject extra result or message fields. Preserve that behavior.

Start in a fresh feature worktree and fresh agent session using only this
packet and its Direct References.

## Why This Split Is Required

Packet 054 requires package inventory, ownership, managed scaffold, dependency,
or parser-selection changes to stop and become a separate packet. Adding the
shared runtime authority creates one new managed scaffold target and two new
packed files: the runtime module and ownership manifest v2.

WO-052 and WO-053 must not start directly from WO-051 because:

1. runtime parsers cannot safely import the benchmark-only contract;
2. independently copied validators could drift;
3. both adapter branches need the same deterministic ordering and composite
   transport before their scopes can be disjoint; and
4. registry, worker, parser composition, and pipeline integration belong to
   WO-054, not either adapter branch.

## Exact Owned Scope

The implementation may change only:

- new `scaffold/scripts/lib/dialect-observation-contract.mjs`;
- `benchmark/bootstrapbench/dialect-contract.mjs`;
- new `scaffold/ownership/v2.json`;
- `scaffold/ownership/current.json`;
- `tests/dialect-contract.test.mjs`;
- `tests/scaffold-ownership.test.mjs`;
- `tests/packed-filesystem-containment.test.mjs`; and
- at most one new focused test file named
  `tests/dialect-runtime-contract.test.mjs` if separation materially improves
  readability; and
- `bin/cli/scaffold-ownership.mjs`, solely to make a pre-existing managed target
  fail closed when no installed ownership state or pinned predecessor baseline
  proves ownership.

If another tracked file must change, stop and request a packet revision. Do not
silently refresh broad package inventories, release metadata, generated
scaffold state, or unrelated exact-count fixtures.

## Runtime Authority

Create `scaffold/scripts/lib/dialect-observation-contract.mjs` as the single
runtime authority. Move, without semantic weakening:

- contract version, ID prefix, category inventory, limits, capability manifest,
  and their accepted hashes;
- canonical JSON, bounded canonicalization, SHA-256 and stable-payload helpers;
- repository-path, capability-manifest, observation, observation-envelope, and
  existing-parser-result validation;
- exact-key and closed scalar helpers needed by those public validators; and
- stable observation identity generation.

The runtime module may import only `node:crypto`. It must not import benchmark,
filesystem, worker, subprocess, parser, ingest, persistence, network, model,
provider, planner, telemetry, or policy code.

The benchmark contract must import and re-export this runtime authority and
retain only benchmark/evaluation-specific golden-case definitions and fixture
validation. There must be no second copy of runtime constants or validators.
Existing benchmark import paths remain valid.

The capability-manifest and limits hashes above must remain exact. If moving
the authority changes either hash, stop rather than accepting drift.

## Canonical Observation Ordering

Freeze one shared comparator and canonicalizer for observation arrays. Ordering
must be total, locale-independent, and deterministic using only contract fields.
Use this precedence:

1. repository path;
2. start line and column;
3. end line and column;
4. frozen category order;
5. normalized shape;
6. language-specific shape with `null` ordered before strings;
7. ordinal with `null` ordered before integers; and
8. observation ID as the final tie-breaker.

The canonicalizer validates every observation, sorts a copy, rejects duplicate
IDs, and never mutates caller input. Envelope validation must require canonical
order for positive observations so independent parser families cannot publish
different byte orderings for equivalent input.

## Experimental In-Memory Transport

Add one strict constructor and validator for this exact shape:

```json
{
  "schema_version": 1,
  "parser_result": { "chunks": [], "errors": [] },
  "observation_envelope": {
    "schema_version": 1,
    "status": "ok",
    "observations": [],
    "diagnostics": {
      "message": null,
      "observed_count": 0,
      "omitted_count": 0
    }
  }
}
```

Requirements:

- the outer object has exactly those three keys;
- `parser_result` passes the existing exact `{chunks, errors}` validator;
- `observation_envelope` passes its independent validator and canonical-order
  gate;
- parser chunks/errors are not copied into observations or diagnostics;
- observations cannot appear inside `parser_result`;
- raw AST/tree/source objects are never accepted or retained, including common
  Tree-sitter `rootNode`/`root_node` aliases and caller-controlled Proxy views;
- validation returns a bounded canonical plain-data transport rather than
  retaining caller-owned object, array, accessor, prototype, or Proxy identity;
- construction is in-memory only and performs no I/O; and
- no registry, worker, pipeline, or parser calls this transport in WO-051B.

## Managed Scaffold V2

- Preserve `scaffold/ownership/v1.json` byte-identically at the frozen hash.
- Create `scaffold/ownership/v2.json` from v1 with `manifestVersion: 2` and only
  the new managed source/target
  `lib/dialect-observation-contract.mjs` added in canonical order.
- Point `scaffold/ownership/current.json` to manifest version 2.
- Preserve every protected, preserved, baseline, mode, root, and existing
  managed-file rule.
- A v1-to-v2 forced upgrade must add the new file when absent.
- Unknown pre-existing, modified, symlinked, hard-linked, traversing, or
  redirected targets remain fail-closed and must not be overwritten or deleted.
- Byte equality with the current package source is not ownership evidence when
  installed state is absent. Only explicit installed state or a frozen
  predecessor baseline may authorize overwrite of a pre-existing managed path.
- Do not add a new pre-state baseline. The installed v1 state is already an
  explicit versioned predecessor.

## Required Tests

### Runtime and benchmark parity

- Runtime and benchmark exports for shared authorities are referentially or
  deeply identical as applicable.
- Accepted manifest and limits hashes remain exact.
- Existing 21 WO-051 focused tests remain green.
- Benchmark golden fixture/evaluation behavior remains unchanged.
- Runtime source contains no benchmark or forbidden runtime dependency.

### Ordering and transport

- Shuffled valid observations canonicalize to byte-identical order.
- Already canonical input is unchanged by value and caller arrays are not
  mutated.
- Duplicate IDs, unsorted positive envelopes, invalid observations, mixed
  parser/observation keys, raw AST/tree/source fields, extra outer keys, and
  non-canonical envelopes fail closed.
- Non-`ok` envelopes retain zero positive observations and exact omission
  accounting.

### Ownership and package boundary

- Ownership v1 hash remains exact.
- Current manifest is v2 and expands to exactly one additional managed target.
- Clean install and v1-to-v2 force upgrade add the runtime file with installed
  fingerprints.
- Unknown collision plus symlink/hard-link/path-redirection cases fail closed.
- Clean-state byte-identical regular-file and hard-link collisions at the new
  managed target fail closed without inode, link-count, namespace, or byte
  mutation.
- `npm pack --dry-run` contains the runtime authority, v1, v2, and current
  pointer, and still excludes benchmark runtime dependency.
- Existing packed filesystem-containment and ownership suites remain green
  after their current-version expectations are updated narrowly.

## Validation

Run at minimum:

```text
node --test tests/dialect-contract.test.mjs tests/dialect-evaluation.test.mjs
node --test tests/dialect-runtime-contract.test.mjs
node --test tests/scaffold-ownership.test.mjs tests/packed-filesystem-containment.test.mjs
node --check scaffold/scripts/lib/dialect-observation-contract.mjs
node --check benchmark/bootstrapbench/dialect-contract.mjs
npm pack --dry-run
git diff --check
cortex update
cortex pattern-evidence <each changed file> --json
cortex doctor
cortex watch status
```

Omit the optional new test path if no such file is created. Run broader root
tests only if the focused package/ownership changes reveal shared failures; CI
remains the authoritative full matrix.

## Review-Round-2 Scope Revision

The second independent review reproduced two failures that cannot be waived:

1. raw syntax remained reachable through `rootNode` aliases and a Proxy because
   the validator returned caller-owned references; and
2. the generic clean-state ownership path treated equality with the current
   package source as proof of ownership and replaced an unknown byte-identical
   regular file or hard link at the new managed target.

The runtime fix remains inside the original runtime/test paths. The ownership
fix necessarily adds the one narrowly authorized CLI file above; Cortex impact
resolves the change to `installManagedScaffold` and its existing ownership,
scaffold, migration, CLI-contract, and packed-containment consumers. No parser,
registry, worker, pipeline, public dialect API, dependency, version, or release
scope is added. All affected focused ownership and packed gates must rerun.

## Acceptance Gates

WO-051B passes only if all are true:

1. one packaged runtime contract is the sole shared authority;
2. benchmark imports/re-exports it without a reverse dependency;
3. accepted manifest and limits hashes are unchanged;
4. canonical observation ordering and exact composite transport are closed and
   adversarially tested;
5. existing `{chunks, errors}` parser, registry, worker, and pipeline behavior
   is unchanged;
6. ownership v1 is byte-identical and v2 adds exactly one managed target;
7. clean/v1-upgrade/collision/containment/package gates pass;
8. no parser, registry, worker, pipeline, persistence, dependency, version,
   public CLI/MCP, or release behavior changes; and
9. all required independent reviewers return GO with no unresolved blocker or
   major finding.

After acceptance, create separate packets and worktrees for WO-052 and WO-053
from the accepted WO-051B head. They may then run in parallel with disjoint
parser and test scopes. WO-054 remains blocked until both are accepted.

## Non-Goals

- no parser implementation or observation extraction;
- no parser selection or fallback change;
- no registry, worker, parser-composition, pipeline, ingest, sidecar, or stale
  lifecycle integration;
- no filesystem observation output;
- no public CLI/MCP/schema/default behavior;
- no model, provider, planner, network, telemetry, or raw AST persistence;
- no dependency, package-version, release, or legacy-scaffold migration change;
- no ownership-v1 rewrite; and
- no WO-052, WO-053, or WO-054 implementation.

## Direct References

- `docs/agent-control/workflow-playbook.md`
- `docs/agent-control/review-iteration-protocol.md`
- `docs/agent-control/context-packets/054-all-language-parser-backed-codebase-dialect.md`
- `benchmark/bootstrapbench/dialect-contract.mjs`
- `benchmark/bootstrapbench/dialect-evaluation.mjs`
- `tests/dialect-contract.test.mjs`
- `tests/dialect-evaluation.test.mjs`
- `scaffold/ownership/current.json`
- `scaffold/ownership/v1.json`
- `bin/cli/scaffold-ownership.mjs`
- `tests/scaffold-ownership.test.mjs`
- `tests/packed-filesystem-containment.test.mjs`
- `package.json`
- `scaffold/scripts/lib/ingest/parser-registry.mjs`
- `scaffold/scripts/lib/ingest/workers.mjs`
- `scaffold/scripts/ingest-worker.mjs`
- `scaffold/scripts/lib/ingest/pipeline-stages.mjs`
