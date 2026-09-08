# WO-RV-002: Source and Generation Freshness

Status: Planned; implementation requires accepted WO-RV-001 and a fresh session.
Requirement: REQ-RV-1. Owner: CLI and Runtime.
Profile: New contract/design — shared health semantics and manifest compatibility.
Packet review: `/root/wo050_review` (Code Quality + Security), `/root` (Validation).
Implementation panel: independent Code Quality, Contract, Security/Privacy, and
Validation reviewers; manager names actual fresh-session assignees before work.

## Baseline and read first

- [Program](../2026-09-08-reliability-and-agent-value-plan.md),
  [baseline packet](rv-001-baseline-reconciliation.md),
  [workflow](../workflow-playbook.md), [review](../review-iteration-protocol.md),
  [handoff](../handoff-ledger.md), and [risks](../risk-register.md).
- Pinned implementation baseline: main `b7d466fa474dfa97fb77a931a674080801e6fa77`,
  package `2.7.0`, observed 2026-09-08; refresh identity after dependency merges.
- The user's original checkout is 123 commits behind that baseline and contains
  unrelated work. Never reset, merge into, or regenerate context in that checkout.
  Start from accepted main in an isolated checkout; record HEAD and dirty paths.
- Read `scaffold/scripts/doctor.sh`, `status.sh`, `dashboard.mjs`,
  `scaffold/scripts/lib/ingest/pipeline-stages.mjs`, and the runtime files below.
  Doctor still mismatches scope `.`; status normalizes it but measures Git
  dirtiness. Neither establishes whether current content is already indexed.
- Existing ingest UUIDs, graph `ingest_generation`, and embedding generation
  links are authoritative building blocks; do not replace them with timestamps.

## Owned surfaces and contract

Own only freshness logic in those three user surfaces, a shared helper under
`scaffold/scripts/lib/`, ingest manifest/source identity production, and necessary
runtime integration in `scaffold/mcp/src/{loadGraph,embed,progressiveIndexing,
searchResults,types}.ts` and `scaffold/mcp/src/cli/query.ts`.
Read actual consumers before extending ownership; record exact changed entities.
Own focused fixtures in `tests/` and `scaffold/mcp/tests/`, and concise contract docs.
If the shared helper adds a managed file, also own the minimal
`scaffold/ownership/` update using main's `current.json` manifestVersion 7
convention. Prove the helper ships and works in clean-install and force-upgrade
smokes; preserve existing user-owned files and fingerprints.
Root/runtime package scripts and every workflow belong to WO-RV-004; dependency
manifests/lockfiles belong to WO-RV-003. Request manager coordination for overlap.

1. Specify one additive fresh/stale/partial/unavailable contract: current source
   content versus indexed source inventory, and ingest/graph/embedding coherence.
   Keep source freshness and semantic coverage separate so lexical readiness
   cannot claim complete embeddings. Explain state precedence and reason codes.
2. Normalize root and scoped paths using ingest's inclusion/exclusion rules.
   Detect additions, deletions, renames, and content edits, including clean-tree
   commits/branch switches and dirty content already indexed. Git cleanliness,
   generation age, and a successful Git command are never proof of freshness.
3. Preserve CLI/JSON compatibility where possible; document any percentage
   denominator. Missing/corrupt/legacy identity, Git failure, and concurrent or
   mixed publications must disclose uncertainty, not silently report 100%.
4. Reuse secure managed-file and atomic publication boundaries. Source inventory
   must not traverse excluded/outside-root paths or expose source text/secrets.
   No default-model change, resource-policy redesign, or call-resolution work.

## Validation and bounded acceptance

Run Cortex search/rules before implementation and impact before structural changes;
verify context source identity against direct files. Review each changed file with
`cortex pattern-evidence <file> --json`. Use disposable small fixtures, synthetic
embedding manifests or fake embedding providers; no native heavy embedding run.

Focused existing commands, from the isolated candidate root after its documented
dependency/build preparation (add the new regression file explicitly):

```bash
node --test tests/doctor-auth.test.mjs tests/dashboard.test.mjs tests/progressive-indexing-cli.test.mjs tests/query-cli-shim.test.mjs
node --test tests/ingest-filesystem-boundary.test.mjs tests/ingest-units.test.mjs
node --test tests/scaffold-ownership.test.mjs tests/scaffold-migration.test.mjs
npm --prefix scaffold/mcp run build
node --test scaffold/mcp/tests/progressive-indexing.test.mjs scaffold/mcp/tests/query-cli.test.mjs
git diff --check
```

Acceptance requires matching states/reasons across doctor, status, dashboard, and
query output for: pristine indexed source; edited source; indexed dirty source;
clean commit changes; branch switches; deletions/renames; scoped untracked files;
root `.`; ignored/out-of-scope files; unavailable Git; absent/corrupt legacy
manifests; partial embeddings; mismatched graph/embed generations; publication race.
Tests must prove content/generation semantics, not snapshot prose alone.

At acceptance, Validation runs the required full matrix with current release
context preparation and records inherited failures separately from regressions.
Refresh only the isolated small-fixture context with embedding disabled; record
any resource-policy limitation instead of launching broad `cortex update`.
Close review findings and update handoff/matrix/risk records. No live agent
benchmarks, global runtime upgrade, package publication, or release dispatch.
