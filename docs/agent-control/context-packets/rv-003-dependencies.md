# WO-RV-003: Compatible Dependency Remediation

Status: Planned; implementation requires accepted WO-RV-001 and a fresh session.
Requirement: REQ-RV-1. Owner: Security and Privacy + Release.
Profile: Infra/deploy/security-sensitive — dependency and native runtime supply chain.
Packet review: `/root/wo050_review` (Code Quality + Security), `/root` (Validation).
Implementation panel: independent Security/Privacy, Ops/Release, and Validation;
manager names actual fresh-session assignees before work starts.

## Baseline and read first

- [Program](../2026-09-08-reliability-and-agent-value-plan.md),
  [baseline packet](rv-001-baseline-reconciliation.md),
  [workflow](../workflow-playbook.md), [review](../review-iteration-protocol.md),
  [handoff](../handoff-ledger.md), and [risks](../risk-register.md).
- Pinned main: `b7d466fa474dfa97fb77a931a674080801e6fa77`, package `2.7.0`.
  Work in an isolated checkout of accepted main; record refreshed HEAD/toolchain.
  Do not reset, merge into, install into, or update the user's old dirty checkout.
- Read all six manifests/locks: root, `frontend`, `scaffold/mcp`,
  `scaffold/scripts/parsers`, `scripts/parsers`, and `plugins/dsh-cortex`.
  Also read `scripts/release-artifacts.mjs`, `scripts/sync-release-version.mjs`,
  and root/runtime/bundle package scripts before choosing installation commands.
- Audit observation 2026-09-08: frontend 1 high (`browserslist`); runtime 2 high
  and 1 moderate (`ajv` via `fast-uri`, `fast-uri`, `qs`); root, both parser trees,
  and DSH bundle zero. Refresh JSON evidence; these are not exploit findings.
- Main already contains patched overrides, including frontend `nanoid` and
  runtime `fast-uri`, `hono`, `tar`, `sharp`, and others. Preserve protections;
  old-checkout manifest replacements would regress already released remediation.

## Owned surfaces and integration

Own dependency entries, overrides, and corresponding lockfile changes in the six
trees only where fresh audit evidence or compatible resolution requires a change.
Own focused dependency smoke fixtures and remediation evidence in control docs.
Do not bulk-upgrade majors, change product defaults, or suppress advisory levels.
No runtime behavior edits without an explicit bounded follow-up scope decision.

WO-RV-004 owns package **scripts**, audit-tree inventory enforcement, workflows,
and test-lane helpers. Commit/integrate dependency manifest+lock changes first;
WO-RV-004 reapplies script edits on that accepted revision and reruns checks.
If root metadata affects the DSH root-artifact integrity lock, use existing
release-artifact/version-sync contracts and record resulting lock provenance.
Never substitute a local disposable path for a registry identity in committed locks.
WO-RV-002 can proceed only with disjoint source/fixture ownership recorded.

## Tasks and validation

1. Run Cortex search/rules and read-only Git inventory. Save audit exit codes,
   advisory identifiers, resolved versions, dependency paths, and observation time.
2. Select the smallest compatible patched resolution; justify override changes
   from authoritative advisory/package evidence and the actual lock graph.
   Avoid `npm audit fix --force`; inspect the complete generated lock diff.
3. Install every tree cleanly in disposable candidate checkouts with `npm ci`
   (`--prefix <tree>` for non-root trees). Record Node/npm/OS/architecture.
   Respect supported bundle/native engines and existing lifecycle requirements.
4. Run all six low-or-higher lockfile audit gates, including the bundle separately
   because the current root audit script includes only five trees:

```bash
npm run audit:dependencies
npm audit --package-lock-only --audit-level=low --prefix plugins/dsh-cortex
npm --prefix scaffold/mcp run build
npm --prefix frontend run build
npm run release:check-version-sync
node --test tests/plugin-manifests.test.mjs tests/javascript-parser.test.mjs tests/tree-sitter-robustness.test.mjs
npm --prefix plugins/dsh-cortex test
git diff --check
```

Use `release:prepare-root-test-context` before full root tests and
`release:prepare-mcp-test-context` before runtime `test:ci`, in disposable fixtures.
Run required full matrix once at acceptance; retain release-workflow baseline
failures as unresolved WO-RV-004 work, never relabel them passes.
Prove native graph open/query/close and parser loading on a tiny fixture; verify
transformer/native dependency imports without model downloads or full embeddings.
Use existing local packed install/containment gates when shipped locks change;
read helper options first and record exact tarball identity and command evidence.

## Acceptance and handoff

All six audit trees pass at low-or-higher threshold; clean installs/builds and
affected package/native smokes pass. No blanket exceptions or ignored advisories.
Report before/after dependency paths and existing overrides retained, build/test
results, inherited blockers, platform limits, and residual risks to reviewers.
Run `cortex pattern-evidence <file> --json` on changed files and close findings.
Update handoff/matrix/risk records; coordinate shared package integration before
WO-RV-004 final validation. No live model benchmarks, global runtime mutation,
version bump, publication, or release workflow dispatch.
