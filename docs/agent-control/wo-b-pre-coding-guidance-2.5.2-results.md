# WO-B Pre-Coding Guidance — Cortex 2.5.2 Final Remediation Results

## Status and scope

WO-B is manager-accepted locally on accepted WO-A
base `d326227` in `/Users/danielnilsson/GIT/cortex-wo-b-2.5.2`. Packets 047–050 are
the governing inputs. Version remains `2.5.2`; dependency manifests and locks
are unchanged. No commit, merge, rebase, release, publish, WO-C, or WO-D
action occurred. WO-C is unblocked but requires a separate fresh work order.

Schema v1 remains a deterministic convention-profile projection. It contains
no retrieval field and invokes no search, embedding, model, planner, provider,
telemetry, network, or fetch surface. Normal `search`, `related`, `impact`, and
the accepted two-pass implementation remain separate.

## Final rereview and terminal-review dispositions

1. **Root/runtime grammar closed.** Root preflight now rejects the exact
   empty-name target `chunk:src/x.ts::1-2`, before runtime import or state
   access. JSON and text stay sanitized. A shared/full differential matrix and
   missing, broken, and import-capable runtime sentinels prove root/runtime
   parity and absence of `.context` creation.
2. **Recursive term accounting closed.** Validation bounds the observed
   normalized count by the task grammar, retains at most 32 terms, requires
   exact omitted-count coherence, and requires the matched-term union to be no
   larger than both the observed and retained bounds. Rehashed violations fail
   the validator, public serializer, and context-aware recomputation.
3. **Production provenance closed without altering conventions.** Accepted
   convention profiles remain byte-for-byte `d326227`: representative
   caller/test evidence is citation-only and profile hashes/public bytes are
   unchanged. Guidance independently joins those citations and reusable-symbol
   identity to the accepted direct `CALLS`/`IMPORTS` edge in canonical
   `ContextData.relations`. Rules, symbols, examples, and conflicts otherwise
   retain accepted canonical citations. Real context-backed 10-to-11 fixtures
   cover every guidance item class and pass context-aware validation.
4. **Negative matrix completed honestly.** Exact 4,095/4,096/4,097 scalar and
   16,383/16,384/16,385 UTF-8 byte cases, 32-to-33 term accounting, NFKC
   equivalence, reversed-input ties, one/multiple/multilanguage and repository
   fallback, every typed target/backing family, recursive tampering, every item
   cap, and prohibited runtime surfaces are covered by the new guidance/root
   tests plus the inherited WO-A convention containment matrix.
5. **Reproduction made literal.** The commands below contain the exact config
   patches, accepted-base runner, managed lifecycle, 21-artifact loop, both
   digests, normal-byte restoration, exact configured-path digest, complete
   checksum/profile/manifest validation, and 18-state snapshot/replay. There
   is no placeholder step.
6. **Standalone public recomputation closed.** Structural
   `validateGuidanceData` checks the versioned shape and recursive canonical
   invariants. `validateGuidanceDataAgainstTask` and the public serializer add
   deterministic recomputation from the raw task and exact field allowlists:
   rule `title/entity_id`, symbol `name/kind/role/signature/path`, and example
   `label/entity_id/kind/reusable_symbol_id`. Coherently rehashed upward counts,
   fabricated terms, exact/prefix swaps, altered matched fields/components,
   score, reason, union, omitted count, task hash, and guidance hash are
   rejected. Context-aware validation additionally rebuilds from current
   canonical relations, identities, profiles, and live backing bytes.

The Security finding was the empty-name mismatch; all other security
boundaries remained closed. Contract additionally identified term accounting,
caller/test provenance, and reproduction. Code Quality identified production
provenance, matrix gaps, and reproduction. Integration additionally identified
missing config/digest/state commands while its routing/parity/lifecycle checks
passed. Validation additionally identified the non-executable pattern claim
while live state/config/checksum/profile/doctor/accounting checks passed.

## Exact coverage and physical non-applicability

- A UTF-8 string of 16,385 bytes cannot remain within 4,096 Unicode scalars:
  four bytes is the maximum per scalar, so that byte-over case necessarily
  also crosses the scalar ceiling. It is tested as the exact byte boundary,
  without claiming byte-only isolation.
- An eligible canonical code target always selects at least one language
  profile, using `unknown` when language inference has no stronger result.
  Therefore a successful zero-profile response is not constructible; missing,
  stale, non-code, and unsafe targets fail before selection. One, multiple,
  multilanguage, and repository-fallback success paths are tested.
- Rule and ADR are logical records and cannot have filesystem hard links of
  their own; their cited backing files receive the leaf/ancestor/special/
  hard-link checks. File and Chunk exercise file backing directly. Module and
  Project are directories, and directories cannot be hard-linked on the
  supported filesystem; their descendant file backing receives the equivalent
  check. Cross-type, duplicate, stale, cross-subsystem, identity, symlink leaf
  and ancestor, special-file, and hard-link cases are exercised wherever the
  record type physically supports them.
- No model/planner/provider/telemetry adapter exists on the guidance path to
  instrument. Tests fail on those source references/imports and additionally
  replace the actual process `fetch`, HTTP, HTTPS, and socket surfaces with
  throwing sentinels. Search/embedding entrypoints are also prohibited by
  source and call sentinels.

The only retained residual is WO-A's narrow trusted-same-user race between
portable identity checks and path operations. No new waiver or contract
decision is required.

## Exact accounting

Relative to `d326227`, the candidate contains exactly **25 changed paths**:
**17 modified**, **8 added**, no deletion, and no rename. Exactly **21 output
paths** receive final expanded-index pattern evidence. Packets 047–050 are the
four governing inputs excluded from output coverage. The accepted convention
source and tests have no diff and therefore are not candidate outputs.

```text
README.md
bin/cli/help.mjs
bin/cli/query-command.mjs
bin/cli/scaffold.mjs
docs/agent-control/handoff-ledger.md
docs/agent-control/manager-log.md
docs/agent-control/wo-b-pre-coding-guidance-2.5.2-results.md
docs/repository-guidance.md
scaffold/AGENTS.md
scaffold/mcp/build.mjs
scaffold/mcp/src/cli/query.ts
scaffold/mcp/src/guidance.ts
scaffold/mcp/src/types.ts
scaffold/mcp/tests/guidance.test.mjs
scaffold/mcp/tests/query-cli.test.mjs
scaffold/ownership/v1.json
tests/cli-contract.test.mjs
tests/init-agents.test.mjs
tests/packed-filesystem-containment.test.mjs
tests/query-cli-shim.test.mjs
tests/scaffold-migration.test.mjs
```

Excluded governing inputs:

```text
docs/agent-control/context-packets/047-wo-b-pre-coding-guidance.md
docs/agent-control/context-packets/048-wo-b-first-review-remediation.md
docs/agent-control/context-packets/049-wo-b-final-review-remediation.md
docs/agent-control/context-packets/050-wo-b-terminal-no-go-remediation.md
```

## Validation results

- MCP TypeScript build passed. The combined guidance/conventions/root/runtime
  query target passed **148/148**.
- Full MCP passed **556/556**. Context regression passed **81/81** and full
  root passed **394/394**.
- Frontend production build transformed **2,267** modules. Five dependency
  audits returned zero vulnerabilities. Version synchronization passed at
  `2.5.2`.
- Packed containment passed at 427 entries, 406/21 modes, inventory SHA-256
  `b5e870947de4e66a05cfae04413b1652c6c19b57589d3460243bbb89f290cfd9`,
  ownership 392/95, 41 boundary cases, 3 characterization cases, both four-case
  dashboards, and forced upgrade 53 changed/12 new/53 state hashes.
- A fresh managed fixture force-initialized, bootstrapped 7 files/31 semantic
  entities with zero embedding failure, built 2 profiles, returned guidance,
  and completed watch start/status/stop. Scaffold and installed guidance,
  conventions, query source/dist, build wrapper, and package metadata matched
  byte-for-byte. The installed lock/build marker correctly reflected the
  installed dependency tree and were not falsely claimed equal to source.
- Fresh accepted-base runtimes emitted byte-identical search, related, impact,
  and conventions JSON after the final normal update. Their final SHA-256
  values are `04466ea007475895ff827f7c9bcccd03c43dd0db599b2f3a24ea05c4ab48b801`,
  `1adc249b641f2508294d9b26b5e1885c51ed68acc8050539c536766c8c2eb34f`,
  `0caed3bd690752518ac06ca61cecf86ce62f7a10df74c6fb40e19c08a916fb03`,
  and `b924d5e4dc534bddabff5812f8f8e93cf956bbc01cff3ff34018053204b17894`
  respectively.
  The complete accepted search/related/impact traversal sources and two-pass
  source have zero diff from `d326227`.

## Final immutable evidence

Normal config SHA-256 is
`cda6f934ef670a609d56ef11a1f4387e450468e39e66cb446f8d1749f5a9e86a`;
expanded config SHA-256 is
`13c9f04ed061bf21dbc79b8ef6f3601144ad05131139f0d664c9ecbfd76e528c`.
The exact 21-path target-set SHA-256 is
`6b6a3e762d413ebe340869d7be2d975b65a0af9f1d17501027886325feb5c76d`;
the target/status (`PASS`) summary SHA-256 is
`83c70d7b4e0ca708728910f50b637db1dbb98d6554be6e70021d369b70804fc6`.
Final expanded/normal update totals, guidance hashes, 18-state digest,
checksum count, manifest/profile count, doctor/watch/status, and diff
classification are emitted and fail-closed by the literal commands below.

No covered implementation path was edited after that sequence. The same single
independent final reviewer performed a narrow read-only delta verification and
returned GO with no actionable finding. The manager accepted WO-B locally;
WO-C remains not started and requires a separate fresh work order.

## Exact executable reproduction

Run from `/Users/danielnilsson/GIT/cortex-wo-b-2.5.2`. All repository commands
use the checkout-local CLI. Temporary artifacts remain only under unique
`/tmp/cortex-wo-b-*` directories.

```bash
set -euo pipefail
repo_root="$PWD"
test "$repo_root" = /Users/danielnilsson/GIT/cortex-wo-b-2.5.2
test "$(node -p 'require("./package.json").version')" = 2.5.2

npm --prefix scaffold/mcp run build --silent
node --test scaffold/mcp/tests/guidance.test.mjs scaffold/mcp/tests/conventions.test.mjs tests/query-cli-shim.test.mjs scaffold/mcp/tests/query-cli.test.mjs
npm --prefix scaffold/mcp test --silent
npm test --silent
npm --prefix frontend run build
npm run audit:dependencies --silent
npm run release:check-version-sync --silent
node tests/packed-filesystem-containment.test.mjs
git diff --check
git diff --cached --check
git diff d326227 --check
git diff --exit-code d326227 -- scaffold/mcp/src/conventions.ts scaffold/mcp/tests/conventions.test.mjs

# Fresh managed init/bootstrap/runtime/watch parity.
managed_parent="$(cd "${TMPDIR%/}" && pwd -P)"
managed_dir="$(mktemp -d "$managed_parent/cortex-wo-b-managed.XXXXXX")"
apply_patch <<PATCH
*** Begin Patch
*** Add File: $managed_dir/README.md
+# Managed lifecycle fixture
*** Add File: $managed_dir/src/sample.mjs
+export function managedFixture(value) {
+  return value;
+}
*** End Patch
PATCH
git init -q "$managed_dir"
git -C "$managed_dir" add README.md src/sample.mjs
git -C "$managed_dir" -c user.name=Cortex -c user.email=cortex@example.invalid commit -qm fixture
node bin/cortex.mjs init "$managed_dir" --force --bootstrap --no-connect --no-watch
for rel in src/guidance.ts src/conventions.ts src/cli/query.ts dist/guidance.js dist/conventions.js dist/cli/query.js build.mjs package.json; do
  cmp "scaffold/mcp/$rel" "$managed_dir/.context/mcp/$rel"
done
(cd "$managed_dir" && node "$repo_root/bin/cortex.mjs" guidance src/sample.mjs --task "reuse managed fixture" --json > /tmp/cortex-wo-b-managed-guidance.json)
node -e 'const fs=require("node:fs");if(JSON.parse(fs.readFileSync("/tmp/cortex-wo-b-managed-guidance.json")).ok!==true)throw Error("managed guidance")'
(cd "$managed_dir" && node "$repo_root/bin/cortex.mjs" watch start --mode poll --interval 2)
(cd "$managed_dir" && node "$repo_root/bin/cortex.mjs" watch status)
(cd "$managed_dir" && node "$repo_root/bin/cortex.mjs" watch stop)
(cd "$managed_dir" && test "$(node "$repo_root/bin/cortex.mjs" watch status)" = "[watch] stopped")

# Refresh the checkout-managed runtime from the final scaffold. Init creates
# exactly the two known template additions below, which are removed literally.
node bin/cortex.mjs init "$repo_root" --force --no-connect --no-watch
apply_patch <<'PATCH'
*** Begin Patch
*** Update File: .gitignore
@@
 mcp/node_modules/
 mcp/.context/
-
*** Delete File: docs/cortex-architecture.md
*** End Patch
PATCH

# Save normal config bytes, apply the literal expanded-index patch, and assert both hashes.
evidence_dir="$(mktemp -d /tmp/cortex-wo-b-pattern.XXXXXX)"
config_copy="$evidence_dir/config.normal.yaml"
cp .context/config.yaml "$config_copy"
test "$(shasum -a 256 .context/config.yaml | cut -d ' ' -f 1)" = cda6f934ef670a609d56ef11a1f4387e450468e39e66cb446f8d1749f5a9e86a
apply_patch <<'PATCH'
*** Begin Patch
*** Update File: .context/config.yaml
@@
   - docs
+  - frontend
+  - scaffold
+  - tests
   - README.md
*** End Patch
PATCH
test "$(shasum -a 256 .context/config.yaml | cut -d ' ' -f 1)" = 13c9f04ed061bf21dbc79b8ef6f3601144ad05131139f0d664c9ecbfd76e528c
node bin/cortex.mjs update

targets_file="$evidence_dir/targets.txt"
apply_patch <<PATCH
*** Begin Patch
*** Add File: $targets_file
+README.md
+bin/cli/help.mjs
+bin/cli/query-command.mjs
+bin/cli/scaffold.mjs
+docs/agent-control/handoff-ledger.md
+docs/agent-control/manager-log.md
+docs/agent-control/wo-b-pre-coding-guidance-2.5.2-results.md
+docs/repository-guidance.md
+scaffold/AGENTS.md
+scaffold/mcp/build.mjs
+scaffold/mcp/src/cli/query.ts
+scaffold/mcp/src/guidance.ts
+scaffold/mcp/src/types.ts
+scaffold/mcp/tests/guidance.test.mjs
+scaffold/mcp/tests/query-cli.test.mjs
+scaffold/ownership/v1.json
+tests/cli-contract.test.mjs
+tests/init-agents.test.mjs
+tests/packed-filesystem-containment.test.mjs
+tests/query-cli-shim.test.mjs
+tests/scaffold-migration.test.mjs
*** End Patch
PATCH
i=0
while IFS= read -r target; do
  i=$((i + 1))
  artifact="$(printf '%s/%03d.json' "$evidence_dir" "$i")"
  node bin/cortex.mjs pattern-evidence "$target" --json > "$artifact"
done < "$targets_file"
test "$i" -eq 21
node - "$evidence_dir" "$targets_file" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const [dir, targetsFile] = process.argv.slice(2);
const expected = fs.readFileSync(targetsFile, "utf8").trimEnd().split("\n").sort();
const artifacts = fs.readdirSync(dir).filter((name) => /^\d{3}\.json$/.test(name)).sort();
if (artifacts.length !== 21 || expected.length !== 21) throw Error("pattern artifact count");
const actual = [];
for (const artifact of artifacts) {
  const value = JSON.parse(fs.readFileSync(path.join(dir, artifact), "utf8"));
  if (value.ok !== true) throw Error(`pattern FAIL: ${artifact}`);
  actual.push(value.input.target);
}
actual.sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error("pattern target set");
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const targetDigest = sha(`${expected.join("\n")}\n`);
const summaryDigest = sha(`${actual.map((target) => `${target}\tPASS`).join("\n")}\n`);
if (targetDigest !== "6b6a3e762d413ebe340869d7be2d975b65a0af9f1d17501027886325feb5c76d") throw Error("target digest");
if (summaryDigest !== "83c70d7b4e0ca708728910f50b637db1dbb98d6554be6e70021d369b70804fc6") throw Error("summary digest");
console.log(JSON.stringify({ artifacts: 21, targetDigest, summaryDigest }));
NODE

# Literal restoration, byte comparison, and final normal update.
apply_patch <<'PATCH'
*** Begin Patch
*** Update File: .context/config.yaml
@@
   - docs
-  - frontend
-  - scaffold
-  - tests
   - README.md
*** End Patch
PATCH
cmp "$config_copy" .context/config.yaml
test "$(shasum -a 256 .context/config.yaml | cut -d ' ' -f 1)" = cda6f934ef670a609d56ef11a1f4387e450468e39e66cb446f8d1749f5a9e86a
node bin/cortex.mjs update

# Validate the exact configured path set, every live checksum/byte, complete
# ingest/graph/embedding manifests, and canonical convention context/backing.
node --input-type=module <<'NODE'
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONVENTION_LIMITS, canonicalConventionJson, readConventionProfile, validateConventionProfilesWithContext } from "./scaffold/mcp/dist/conventions.js";
import { loadContextData } from "./scaffold/mcp/dist/graph.js";
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readJsonl = (file) => fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const docs = readJsonl(".context/cache/documents.jsonl");
if (docs.length !== 157) throw Error(`configured count: ${docs.length}`);
const ids = docs.map((doc) => doc.id);
const paths = docs.map((doc) => doc.path);
if (new Set(ids).size !== docs.length || new Set(paths).size !== docs.length) throw Error("document identity uniqueness");
const pathDigest = sha(`${[...paths].sort().join("\n")}\n`);
if (pathDigest !== "301aec852f4989b955a224d78deec82e3c2a51abacacba55d6283b9059203270") throw Error(`configured path set: ${pathDigest}`);
for (const doc of docs) {
  if (sha(doc.content) !== doc.checksum) throw Error(`checksum: ${doc.path}`);
  if (Buffer.byteLength(doc.content) !== doc.size_bytes) throw Error(`size: ${doc.path}`);
  if (fs.readFileSync(doc.path, "utf8") !== doc.content) throw Error(`live bytes: ${doc.path}`);
}
const ingest = JSON.parse(fs.readFileSync(".context/cache/manifest.json", "utf8"));
if (ingest.schema_version !== 2 || JSON.stringify(ingest.source_paths) !== JSON.stringify(["bin", "scripts", "docs", "README.md"]) || ingest.counts.files !== docs.length) throw Error("ingest manifest root");
const entityFiles = { files: "entities.file.jsonl", rules: "entities.rule.jsonl", adrs: "entities.adr.jsonl", chunks: "entities.chunk.jsonl", modules: "entities.module.jsonl", projects: "entities.project.jsonl" };
for (const [key, file] of Object.entries(entityFiles)) if (readJsonl(path.join(".context/cache", file)).length !== ingest.counts[key]) throw Error(`ingest count: ${key}`);
const relationFiles = ["constrains", "implements", "supersedes", "defines", "calls", "imports", "calls_sql", "uses_config_key", "uses_resource_key", "uses_setting_key", "contains", "contains_module", "exports", "includes_file", "references_project", "uses_resource", "uses_setting", "uses_config", "transforms_config"];
for (const key of relationFiles) if (readJsonl(`.context/cache/relations.${key}.jsonl`).length !== ingest.counts[`relations_${key}`]) throw Error(`ingest relation count: ${key}`);
const graph = JSON.parse(fs.readFileSync(".context/cache/graph-manifest.json", "utf8"));
if (graph.schema_version !== 2 || graph.ingest_generation !== ingest.generation_id || !/^graph-[A-Za-z0-9-]+\.ryu$/.test(path.basename(graph.db_path)) || path.dirname(path.resolve(graph.db_path)) !== path.resolve(".context/db") || !fs.statSync(graph.db_path).isFile()) throw Error("graph manifest root/backing");
const graphMap = { files: "files", rules: "rules", adrs: "adrs", chunks: "chunks", modules: "modules", projects: "projects", constrains: "relations_constrains", implements: "relations_implements", supersedes: "relations_supersedes", defines: "relations_defines", calls: "relations_calls", imports: "relations_imports", calls_sql: "relations_calls_sql", uses_config_key: "relations_uses_config_key", uses_resource_key: "relations_uses_resource_key", uses_setting_key: "relations_uses_setting_key", contains: "relations_contains", contains_module: "relations_contains_module", exports: "relations_exports", includes_file: "relations_includes_file", references_project: "relations_references_project", uses_resource: "relations_uses_resource", uses_setting: "relations_uses_setting", uses_config: "relations_uses_config", transforms_config: "relations_transforms_config" };
for (const [graphKey, ingestKey] of Object.entries(graphMap)) if (graph.counts[graphKey] !== ingest.counts[ingestKey]) throw Error(`graph count: ${graphKey}`);
const embed = JSON.parse(fs.readFileSync(".context/embeddings/manifest.json", "utf8"));
const snapshot = path.join(".context/embeddings", embed.snapshot_file);
const vectors = readJsonl(snapshot);
if (embed.schema_version !== 2 || embed.ingest_generation !== ingest.generation_id || typeof embed.graph_generation !== "string" || !embed.graph_generation || embed.readiness !== "full" || embed.progressive !== false || embed.counts.failed !== 0 || embed.counts.entities !== embed.counts.output || vectors.length !== embed.counts.output || new Set(vectors.map((row) => row.id)).size !== vectors.length || fs.statSync(snapshot).size !== embed.snapshot_bytes || sha(fs.readFileSync(snapshot)) !== embed.snapshot_sha256) throw Error("embedding manifest/snapshot");
for (const row of vectors) if (row.model !== embed.model || row.dimensions !== embed.dimensions || !Array.isArray(row.vector) || row.vector.length !== embed.dimensions) throw Error(`embedding row: ${row.id}`);
const root = ".context/cache/conventions/v1";
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
if (manifest.schema_version !== 1 || manifest.generator_version !== "repo-conventions-v1" || manifest.repository_id !== "cortex" || canonicalConventionJson(manifest.limits) !== canonicalConventionJson(CONVENTION_LIMITS) || manifest.profiles.length !== 12) throw Error("convention manifest root/limits");
const sortedIds = manifest.profiles.map((entry) => entry.profile_id);
if (JSON.stringify(sortedIds) !== JSON.stringify([...sortedIds].sort()) || new Set(sortedIds).size !== 12 || new Set(manifest.profiles.map((entry) => entry.relative_path)).size !== 12) throw Error("convention manifest order/uniqueness");
const expectedIndex = sha(canonicalConventionJson(manifest.profiles.map((entry) => [entry.profile_id, entry.source_hash, entry.profile_hash])));
if (manifest.index_hash !== expectedIndex) throw Error("convention manifest index hash");
let aggregateBytes = 0;
const profiles = [];
for (const entry of manifest.profiles) {
  const file = path.join(root, entry.relative_path);
  aggregateBytes += fs.statSync(file).size;
  const profile = readConventionProfile(file);
  profiles.push(profile);
  if (profile.profile_id !== entry.profile_id || profile.profile_hash !== entry.profile_hash || profile.source_hash !== entry.source_hash || profile.repository_id !== entry.repository_id || profile.language !== entry.language || profile.subsystem.id !== entry.subsystem_id) throw Error(`profile entry: ${entry.profile_id}`);
}
if (aggregateBytes > CONVENTION_LIMITS.max_aggregate_profile_bytes) throw Error("aggregate profile bytes");
const data = await loadContextData();
validateConventionProfilesWithContext(profiles, data, { repository_id: "cortex", repo_root: process.cwd() });
console.log(JSON.stringify({ checksums: docs.length, pathDigest, profiles: profiles.length, indexHash: manifest.index_hash }));
NODE

# Accepted-base public-byte comparisons occur only after the final normal
# update and complete validation above.
base_dir="$(mktemp -d /tmp/cortex-wo-b-base.XXXXXX)"
git archive d326227 scaffold/mcp | tar -x -C "$base_dir"
ln -s "$repo_root/scaffold/mcp/node_modules" "$base_dir/scaffold/mcp/node_modules"
npm --prefix "$base_dir/scaffold/mcp" run build --silent
run_query() {
  runtime="$1"; output="$2"; shift 2
  CORTEX_PROJECT_ROOT="$repo_root" node --input-type=module - "$runtime" "$@" > "$output" <<'NODE'
const [runtime, ...args] = process.argv.slice(2);
const { runQueryCommand } = await import(runtime);
await runQueryCommand(args);
NODE
}
for kind in search related impact conventions; do
  case "$kind" in
    search) args=(search parseGuidanceArgs --top-k 1 --preset minimal --json) ;;
    related) args=(related file:bin/cli/query-command.mjs --depth 2 --edges --metadata --json) ;;
    impact) args=(impact file:bin/cli/query-command.mjs --depth 2 --top-k 8 --json) ;;
    conventions) args=(conventions bin/cli/query-command.mjs --json) ;;
  esac
  run_query "file://$repo_root/scaffold/mcp/dist/cli/query.js" "$base_dir/current-$kind.json" "${args[@]}"
  run_query "file://$base_dir/scaffold/mcp/dist/cli/query.js" "$base_dir/base-$kind.json" "${args[@]}"
  cmp "$base_dir/base-$kind.json" "$base_dir/current-$kind.json"
  actual="$(shasum -a 256 "$base_dir/current-$kind.json" | cut -d ' ' -f 1)"
  case "$kind" in
    search) expected="04466ea007475895ff827f7c9bcccd03c43dd0db599b2f3a24ea05c4ab48b801" ;;
    related) expected="1adc249b641f2508294d9b26b5e1885c51ed68acc8050539c536766c8c2eb34f" ;;
    impact) expected="0caed3bd690752518ac06ca61cecf86ce62f7a10df74c6fb40e19c08a916fb03" ;;
    conventions) expected="b924d5e4dc534bddabff5812f8f8e93cf956bbc01cff3ff34018053204b17894" ;;
  esac
  test "$actual" = "$expected"
  printf '%s %s\n' "$kind" "$actual"
done
git diff --exit-code d326227 -- scaffold/mcp/src/search.ts scaffold/mcp/src/searchCore.ts scaffold/mcp/src/searchResults.ts scaffold/mcp/src/searchAspects.ts scaffold/mcp/src/relatedTraversal.ts scaffold/mcp/src/relatedResponse.ts scaffold/mcp/src/impactTraversal.ts benchmark/bootstrapbench/lib/two-pass-retrieval.mjs scaffold/mcp/src/conventions.ts scaffold/mcp/tests/conventions.test.mjs

# Snapshot exactly 18 state/external files and compare bytes, identity, links,
# sizes, and nanosecond mtimes across repeated JSON/text guidance.
state_dir="$(mktemp -d /tmp/cortex-wo-b-state.XXXXXX)"
sentinel="$state_dir/external-sentinel.txt"
apply_patch <<PATCH
*** Begin Patch
*** Add File: $sentinel
+WO-B external immutability sentinel
*** End Patch
PATCH
snapshot_state() {
  node - "$sentinel" <<'NODE'
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const sentinel = process.argv[2];
const manifestPath = ".context/cache/conventions/v1/manifest.json";
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const files = [".context/config.yaml", ".context/cache/documents.jsonl", ".context/cache/graph-manifest.json", ".context/embeddings/manifest.json", manifestPath, ...manifest.profiles.map((entry) => path.join(".context/cache/conventions/v1", entry.relative_path)), sentinel].sort();
if (manifest.profiles.length !== 12 || files.length !== 18 || new Set(files).size !== 18) throw Error("18-state set");
const state = files.map((file) => {
  const stat = fs.lstatSync(file, { bigint: true });
  return { file, realpath: fs.realpathSync(file), link: stat.isSymbolicLink() ? fs.readlinkSync(file) : null, dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode), nlink: String(stat.nlink), size: String(stat.size), mtimeNs: String(stat.mtimeNs), sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") };
});
process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
NODE
}
snapshot_state > "$state_dir/before.json"
node bin/cortex.mjs guidance bin/cli/query-command.mjs --task "add strict guidance argument validation" --json > "$state_dir/guidance-1.json"
node bin/cortex.mjs guidance bin/cli/query-command.mjs --task "add strict guidance argument validation" --json > "$state_dir/guidance-2.json"
node bin/cortex.mjs guidance bin/cli/query-command.mjs --task "add strict guidance argument validation" > "$state_dir/guidance-1.txt"
node bin/cortex.mjs guidance bin/cli/query-command.mjs --task "add strict guidance argument validation" > "$state_dir/guidance-2.txt"
cmp "$state_dir/guidance-1.json" "$state_dir/guidance-2.json"
cmp "$state_dir/guidance-1.txt" "$state_dir/guidance-2.txt"
snapshot_state > "$state_dir/after.json"
cmp "$state_dir/before.json" "$state_dir/after.json"
shasum -a 256 "$state_dir/before.json" "$state_dir/guidance-1.json" "$state_dir/guidance-1.txt"

node bin/cortex.mjs conventions bin/cli/query-command.mjs --json > "$state_dir/conventions.json"
node bin/cortex.mjs doctor
test "$(node bin/cortex.mjs watch status)" = "[watch] stopped"
node bin/cortex.mjs status
git diff --check
git diff --cached --check
git diff d326227 --check
test "$(git status --short | awk '/^ M/{m++} /^\?\?/{a++} END{print m+0, a+0}')" = "17 8"
test "$(git status --short | wc -l | tr -d ' ')" = 25
git status --short
```
