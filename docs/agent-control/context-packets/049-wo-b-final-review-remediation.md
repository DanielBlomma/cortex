# WO-B Final Review Remediation

## Objective

Close every finding from the packet-048 five-role read-only rereview, make the
negative and immutable evidence complete and reproducible, and return WO-B for
one fresh final rereview. Do not accept WO-B or start WO-C or WO-D.

## Durable Starting State

- Worktree/branch: `/Users/danielnilsson/GIT/cortex-wo-b-2.5.2`,
  `feature/wo-b-pre-coding-guidance-2.5.2`.
- Accepted base: `d326227`; package/version `2.5.2`; dependencies unchanged.
- Packets 047 and 048, their direct references, the accepted WO-A results, the
  full current diff, the WO-B results record, and current manager/handoff state
  are required inputs.
- Use only checkout-local `node bin/cortex.mjs`; use rules/search/impact before
  code conclusions and pattern evidence/update before finalization.
- No commit, merge, rebase, release, publish, acceptance, WO-C, or WO-D action.

## Consolidated Final Findings

### 1. Root/runtime target grammar mismatch

Security and Contract independently found that the root fallback in
`bin/cli/query-command.mjs` accepts the empty-name chunk target
`chunk:src/x.ts::1-2`, while the production runtime rejects it. Reject this
exact form before runtime resolution, keep JSON/text errors sanitized, and add
root import-failure, broken-runtime, missing-runtime, and no-state sentinels for
the exact target. Prove the root grammar and full runtime grammar accept and
reject the same differential matrix. All other reviewed security boundaries
were closed.

### 2. Missing recursive cross-field term invariants

Contract found that rehashed public objects can claim more `matched_terms`
than `normalized_term_observed_count`. Enforce
`matched_terms.length <= normalized_term_observed_count`, bound the observed
count by the task grammar and the 32-term cap/accounting rules, and require
coherent retained/omitted counts and every related canonical invariant.
Rehashed malformed objects must fail both public serialization validation and
context-aware recomputation validation.

### 3. Production evidence provenance is incomplete

Code Quality and Contract found that evidence arrays are schema-valid but
representative caller/test examples lose accepted `CALLS`/`IMPORTS` relation
provenance and the associated reusable-symbol identity. Audit rules, symbols,
examples, and conflict claims so every array is constructed from accepted
canonical `ContextData` citations or relations, never fabricated standalone
records. Test the real context-backed 10-to-11 evidence cap for every item
class and pass each result through context-aware validation.

### 4. Packet-048 negative matrix is incomplete

Complete and report the exact task scalar/UTF-8 boundaries, including
4095/4096/4097 scalars and 16383/16384/16385 bytes where constructible; 32-to-33
term accounting; NFKC equivalence and deterministic ties; zero, one, multiple,
multilanguage, and repository-fallback profiles; Rule/ADR/File/Chunk/Module/
Project cross-type, duplicate, and backing variants; and per-item stale,
cross-subsystem, symlink leaf and ancestor, special-file, hard-link, and
identity cases where the type supports them. Add explicit runtime sentinels for
search, model, embedding, planner, provider, telemetry, network, and fetch.
Compare accepted-base bytes for public search, related, impact, and two-pass
behavior. Do not add fake or impossible tests: record exact coverage and any
physical/type-specific non-applicability honestly.

### 5. Durable reproduction is not executable enough

Integration and Validation found placeholder `Use apply_patch` steps, an
omitted literal config mutation, incomplete digest/state commands, and a
non-executable 23-file pattern claim. Replace every placeholder with literal
executable application or one checked-in deterministic script/fixture. The
reproduction must expand and restore config byte-for-byte, assert target-set
and target/status-summary digests, reproduce exact current covered-file pattern
artifacts, snapshot and compare all 18 state/external sentinels including
bytes, identity, links, sizes, and mtimes, validate checksums/profiles/manifest,
exercise managed init/bootstrap/watch/runtime parity, compare accepted-base
outputs, and fail closed.

## Role Dispositions To Preserve

- Security: one major for the empty-name chunk root/runtime mismatch; all other
  security boundaries closed.
- Contract: the same grammar mismatch, the missing matched-term/observed-count
  invariant, lost caller/test graph provenance, and reproduction placeholders.
- Code Quality: schema-only evidence arrays without production relation
  provenance, negative-matrix gaps, and incomplete durable reproduction.
- Integration: the grammar mismatch plus omitted config patch and digest/state
  commands; routing, parity, lifecycle, checksums, and profiles otherwise pass.
- Validation: the grammar mismatch, non-executable covered-file evidence, and
  negative-matrix gaps; live hashes/state/config/checksums/profiles/doctor and
  prior accounting otherwise pass.

## Validation And Freeze

Run build and focused target/term/provenance tests first; then combined
guidance/conventions/query, full MCP, context/root, frontend, audits, packed
containment, lifecycle, and runtime parity. Preserve accepted search, related,
impact, and two-pass behavior byte-for-byte. Reconcile all claims and totals,
finalize every source/test/doc/control edit, run expanded pattern evidence,
restore normal config, run the final normal update/checksum/profile/live-state/
doctor/watch/diff sequence, and do not edit covered files afterward. Record
exact commands, outputs, hashes, coverage, non-applicable cases, and residuals
in the durable results/control records. Fresh five-role read-only rereview is
mandatory; only the manager may accept WO-B.
