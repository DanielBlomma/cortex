# WO-A Repository-Local Conventions — Cortex 2.5.2 Port Results

## Status and scope

WO-A is owner-complete on branch
`feature/wo-a-repo-conventions-2.5.2` from baseline
`1cbb4f0522db9114be25ce6b779ae30b0c8b2b06`. The package and every release
surface remain version `2.5.2`; dependency manifests and locks are unchanged.
This record is the stable in-repository locator for the exact final owner
evidence. It does not record manager acceptance. WO-B, commits, merges,
rebases, releases, tags, publishing, and deployment remain out of scope.

The stale `/Users/danielnilsson/GIT/cortex-wo-a` checkout was read-only port
input and was not changed or used for lifecycle commands. Packets 045 and 046
are governing work-order inputs, not implementation outputs.

## Finding closure

1. The root query shim now catches only `conventions` runtime resolution and
   import failures. JSON receives the bounded `INVALID_ARGS` conventions
   envelope with sanitized input; text receives only `Convention inspection
   failed safely`. Missing and import-failing runtimes are covered in JSON and
   text from a control-bearing temporary root. Absolute paths, loader text,
   source content, controls, and rejected input are absent, no convention state
   is created, and non-conventions runtime-load behavior is unchanged.
2. This completed record, the manager log, and the handoff ledger contain the
   exact final accounting, hashes, outcomes, and reproduction commands. The
   immutable expanded-pattern/config-restoration/final-normal-index sequence
   was run after their last edit; no covered file changed afterward.
3. The packed acceptance report derives `mode_counts` from the same verified
   inventory constants that assert the package. Its final JSON reports 424
   entries: 403 at `0644` and 21 at `0755`.

All packet-045 behavior remains intact: the version-1 convention engine,
strict migration and persistence boundary, exact output-dependency hashes,
Unicode/control rejection, one canonical validation traversal, query command,
foreground/progressive/update lifecycle ordering, source/runtime parity,
managed ownership, public contract, and current 2.5.2 progressive,
containment, and two-pass retrieval behavior.

## Exact final accounting

The baseline comparison contains exactly **28 changed paths**: **20 modified**
and **8 added**, with no deletion or rename. Exactly **26 output paths** were
covered by the final expanded-index pattern gate; the two excluded changed
paths are the governing input packets 045 and 046.

Covered output paths (`26`):

```text
README.md
bin/cli/help.mjs
bin/cli/query-command.mjs
docs/agent-control/handoff-ledger.md
docs/agent-control/manager-log.md
docs/agent-control/wo-a-repo-local-conventions-2.5.2-results.md
docs/repository-conventions.md
scaffold/mcp/build.mjs
scaffold/mcp/src/cli/query.ts
scaffold/mcp/src/conventions.ts
scaffold/mcp/src/types.ts
scaffold/mcp/tests/conventions.test.mjs
scaffold/mcp/tests/enterprise-pattern-context.test.mjs
scaffold/mcp/tests/query-cli.test.mjs
scaffold/mcp/tests/server.test.mjs
scaffold/ownership/v1.json
scaffold/scripts/bootstrap.sh
scaffold/scripts/conventions.mjs
scaffold/scripts/update-context.sh
scripts/bootstrap.sh
scripts/conventions.mjs
scripts/update-context.sh
tests/cli-contract.test.mjs
tests/packed-filesystem-containment.test.mjs
tests/query-cli-shim.test.mjs
tests/scaffold-migration.test.mjs
```

Governing changed inputs excluded from output coverage (`2`):

```text
docs/agent-control/context-packets/045-wo-a-port-to-2.5.2.md
docs/agent-control/context-packets/046-wo-a-2.5.2-final-review-remediation.md
```

## Validation

- MCP TypeScript build passed. Pure conventions passed `108/108` (`51`
  top-level); focused conventions/query passed `122/122` (`65` top-level).
- The root loader shim passed `4/4`. The affected root CLI/scaffold group
  passed `30/30`. The loader matrix covers missing/broken JSON and text plus
  unchanged non-conventions behavior.
- The previous unaffected complete gates remain current: MCP `538/538`,
  context regressions `81/81`, root `387/387`, frontend production build with
  `2,267` modules, and five dependency audits with zero vulnerabilities.
- Version synchronization passed at `2.5.2`; changed shell/JavaScript syntax
  and all three diff whitespace checks passed.
- Packed acceptance passed 41 boundary cases, 3 characterization cases, and
  both 4-case dashboard surfaces. Clean/prebuilt inventories matched at 424
  entries, 403/21 modes, inventory SHA-256
  `071bb802bed0e798ae65dae87d27738cbc094c85c753112ae6d63c9b57f5c980`,
  managed ownership `389/95`, and forced-upgrade `50` changed/`9` new with 50
  state hashes. The supporting ephemeral tarball was SHA-1
  `9234dd71292c30983796cb93beb5fa6f63130142` and SHA-256
  `8d61f0b996462980c1873cabc7eaeaecb4a990ffde062712bad36c8ea951e821`.
- Managed foreground bootstrap indexed 150 files/1,376 entities, embedded 56,
  reused 1,320, failed 0, and built 12 profiles. Progressive bootstrap
  published graph and conventions before background embeddings; completion
  was 1,376/1,376 with 6 embedded, 1,370 reused, and 0 failed. Watch
  start/status/stop passed and remains stopped.
- Scaffold/runtime source, compiled output, build, package, lock, marker, and
  wrapper pairs are byte-identical. Both build markers have SHA-256
  `ce6a9ac2f1ae1a29ab8b4f96fba1d65a64af0682bd385ab74d1a08ada8625d1f`.
- Repeated final live JSON was byte-identical under `cmp`; live text was 72
  bytes at SHA-256
  `3e7ee7c9aec4cd763b09dd17596d631c0d380fb796ecdc38bbe7ddf8a38a341e`.
  The JSON digest is recomputed rather than embedded circularly because its
  public persistence summary binds the index containing this results file.

## Final immutable evidence

The normal config was restored byte-for-byte at SHA-256
`cda6f934ef670a609d56ef11a1f4387e450468e39e66cb446f8d1749f5a9e86a`;
the temporary expanded config was
`13c9f04ed061bf21dbc79b8ef6f3601144ad05131139f0d664c9ecbfd76e528c`.
The expanded update indexed `167` files/`1,438` semantic entities with `0`
embedding failures and produced `19` convention profiles. Pattern evidence
returned **26/26 PASS, 0 FAIL** for the exact covered list above. Its per-file JSON is ephemeral
supporting output only; the exact list and commands here are the durable gate.

After restoration, the final normal update indexed `151` files/`1,388`
semantic entities and produced `12` profiles. Exactly `151/151` configured
files matched the
SHA-256 checksum in `.context/cache/documents.jsonl`, with zero missing,
extra, or mismatched records. The final manifest is schema 1 /
`repo-conventions-v1`, repository `cortex`, with `12` entries and `12` profile
files; every profile schema/hash, manifest cross-field, canonical path,
canonical collection, indexed meaning, and live backing check passed. The
manifest/index digests are recomputed by the reproduction commands instead of
being embedded circularly in this indexed results file.

`cortex doctor` passed `8/8`, including its 92% dirty-worktree freshness
calculation. `cortex watch status` reported `stopped`. `cortex status` reported
151 files, 1,388/1,388 semantic coverage, full readiness, and the same 12
configured dirty paths behind the 92% freshness display. `git diff
--check`, `git diff --cached --check`, and the baseline diff check all exited
zero. Final `git status --short` contained exactly the 28 paths classified
above. No covered path was edited after this sequence.

## Exact reproduction commands

Run from `/Users/danielnilsson/GIT/cortex-wo-a-2.5.2` using only the
checkout-local CLI:

```bash
set -euo pipefail

npm --prefix scaffold/mcp run build --silent
node --test scaffold/mcp/tests/conventions.test.mjs
node --test scaffold/mcp/tests/conventions.test.mjs scaffold/mcp/tests/query-cli.test.mjs
node --test tests/query-cli-shim.test.mjs tests/cli-contract.test.mjs tests/scaffold-migration.test.mjs
node tests/packed-filesystem-containment.test.mjs
npm run release:check-version-sync --silent

# Save the normal config bytes/hash, then use apply_patch to add exactly:
#   - frontend
#   - scaffold
#   - tests
# after the existing docs source path.
shasum -a 256 .context/config.yaml
node bin/cortex.mjs update
evidence_dir="$(mktemp -d /tmp/wo-a-252-final-pattern.XXXXXX)"
while IFS= read -r file; do
  safe_name="$(printf '%s' "$file" | tr '/ ' '__')"
  node bin/cortex.mjs pattern-evidence "$file" --json > "$evidence_dir/$safe_name.json"
done <<'EOF'
README.md
bin/cli/help.mjs
bin/cli/query-command.mjs
docs/agent-control/handoff-ledger.md
docs/agent-control/manager-log.md
docs/agent-control/wo-a-repo-local-conventions-2.5.2-results.md
docs/repository-conventions.md
scaffold/mcp/build.mjs
scaffold/mcp/src/cli/query.ts
scaffold/mcp/src/conventions.ts
scaffold/mcp/src/types.ts
scaffold/mcp/tests/conventions.test.mjs
scaffold/mcp/tests/enterprise-pattern-context.test.mjs
scaffold/mcp/tests/query-cli.test.mjs
scaffold/mcp/tests/server.test.mjs
scaffold/ownership/v1.json
scaffold/scripts/bootstrap.sh
scaffold/scripts/conventions.mjs
scaffold/scripts/update-context.sh
scripts/bootstrap.sh
scripts/conventions.mjs
scripts/update-context.sh
tests/cli-contract.test.mjs
tests/packed-filesystem-containment.test.mjs
tests/query-cli-shim.test.mjs
tests/scaffold-migration.test.mjs
EOF

expected_artifacts=26
actual_artifacts="$(find "$evidence_dir" -type f -name '*.json' | wc -l | tr -d ' ')"
test "$actual_artifacts" -eq "$expected_artifacts"
node - "$evidence_dir" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const evidenceDir = process.argv[2];
const artifacts = fs.readdirSync(evidenceDir)
  .filter((name) => name.endsWith(".json"))
  .sort();
if (artifacts.length !== 26) {
  throw new Error(`Expected 26 pattern artifacts, found ${artifacts.length}`);
}
for (const artifact of artifacts) {
  const value = JSON.parse(fs.readFileSync(path.join(evidenceDir, artifact), "utf8"));
  if (value.ok !== true) {
    throw new Error(`Pattern evidence failed: ${artifact}`);
  }
}
NODE

# Use apply_patch to remove only the three temporary source paths, prove the
# normal config hash is restored, then run the final normal refresh/checks.
shasum -a 256 .context/config.yaml
node bin/cortex.mjs update
node bin/cortex.mjs conventions bin/cli/query-command.mjs --json
node bin/cortex.mjs doctor
node bin/cortex.mjs watch status
node bin/cortex.mjs status
git diff --check
git diff --cached --check
git diff 1cbb4f0522db9114be25ce6b779ae30b0c8b2b06 --check
git status --short
```

The engine retains the previously reviewed narrow trusted-same-user
filesystem race between portable identity checks and path operations. No new
waiver or WO-B design is introduced.

## Manager acceptance

WO-A is manager-accepted locally on 2026-08-25 against Cortex 2.5.2 baseline
`1cbb4f0522db9114be25ce6b779ae30b0c8b2b06`. Code Quality, Contract,
Security/Privacy, Integration, and Validation returned final PASS with no
remaining finding. After the sole final Validation finding, the reproduction
loop was made fail-closed with `set -euo pipefail`, exact artifact-count
checking, JSON parsing, and `ok === true` enforcement; one fresh Validation
review independently reproduced the intermediate-failure nonzero exit and
returned PASS.

This acceptance does not commit, merge, publish, release, or start WO-B. WO-B
requires its own fresh work order from the accepted 2.5.2 state.
