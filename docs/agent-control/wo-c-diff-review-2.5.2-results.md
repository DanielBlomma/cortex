# WO-C Deterministic Diff Review 2.5.2 Results

Date: 2026-08-25

Status: manager-accepted locally after the same single reviewer's final
GO/PASS. WO-D is unblocked but not started and requires a separate fresh work
order. No commit, push, merge, release, publish, deploy, version, or dependency
change is authorized by this record.

## Binding

- Governing packets: `docs/agent-control/context-packets/051-wo-c-diff-review.md`
  plus the final-review remediation packet
  `docs/agent-control/context-packets/052-wo-c-final-review-remediation.md`
  and final chunk-backing packet
  `docs/agent-control/context-packets/053-wo-c-final-chunk-backing-remediation.md`.
- Worktree: `/Users/danielnilsson/GIT/cortex-wo-c-2.5.2`.
- Branch: `feature/wo-c-diff-review-2.5.2`.
- Accepted base: `482f196`.
- Package version remains `2.5.2`; all root, frontend, runtime, and parser
  package manifests and lockfiles are byte-identical to the accepted base.
- Packet reference
  `docs/agent-control/context-packets/034-role-grounded-evidence-coverage.md`
  is absent from the accepted checkout. All other direct references were read;
  the missing historical packet did not change packet 051's closed contract.

## Frozen scope

The candidate has 22 output paths plus the three governing packets. The output
set is:

```text
README.md
bin/cli/help.mjs
bin/cli/query-command.mjs
bin/cli/scaffold.mjs
docs/agent-control/handoff-ledger.md
docs/agent-control/manager-log.md
docs/agent-control/wo-c-diff-review-2.5.2-results.md
docs/repository-diff-review.md
scaffold/AGENTS.md
scaffold/mcp/build.mjs
scaffold/mcp/src/cli/query.ts
scaffold/mcp/src/review.ts
scaffold/mcp/src/types.ts
scaffold/mcp/tests/query-cli.test.mjs
scaffold/mcp/tests/review.test.mjs
scaffold/ownership/v1.json
tests/cli-contract.test.mjs
tests/init-agents.test.mjs
tests/packed-filesystem-containment.test.mjs
tests/query-cli-shim.test.mjs
tests/review-cli-shim.test.mjs
tests/scaffold-migration.test.mjs
```

The governing packets are deliberately excluded from output-pattern coverage:

```text
docs/agent-control/context-packets/051-wo-c-diff-review.md
docs/agent-control/context-packets/052-wo-c-final-review-remediation.md
docs/agent-control/context-packets/053-wo-c-final-chunk-backing-remediation.md
```

## Delivered contract

- `cortex review --diff --json` and `cortex review --diff` are the only v1
  forms. Root preflight rejects missing, positional, duplicate, mixed, and
  unknown arguments before runtime import or repository access.
- The collector uses argv-based Git processes and compares the candidate to
  `HEAD`: staged and unstaged tracked state plus non-ignored untracked regular
  files. Paths are normalized, deduplicated, and sorted; deletions and binary
  patches remain represented.
- The resolved real Git directory, index, HEAD backing, HEAD OID, complete
  discovery, every initial candidate identity/byte set, and every canonical
  diff byte are one transaction hash that is independently recollected before
  output. Symlinks, hard
  links, special files, submodules, external aliases, `.git`, `.context`, and
  ignored content cannot become review inputs.
- Output is closed schema 1 with generator `repo-diff-review-v1`, recursive
  unknown-key rejection, canonical lexical order, exact count accounting,
  canonical IDs/diff/profile/review hashes, and bounded sanitized JSON/text.
- Eligible code files resolve exact file/subsystem and graph locality before
  any authority tier. Active authority applies only through exact repository
  or candidate-scoped source-of-truth evidence; `related_subsystems` is never
  global relevance. Files otherwise map through same-file,
  directory/module, feature/graph, and repository-fallback tiers. Findings
  separate deterministic exact authority from heuristic local signals.
  Conflicting active claims are explicit and suppress deterministic guesses.
- Evidence and conflict claims are capped, unique, canonical, and excluded
  when they name a changed path. Every selected profile, source, chunk,
  module, project, path, relation, and authority backing is validated before
  use and revalidated before output even for zero-result reviews.
- Every non-window chunk owned by a selected profile is freshly reconstructed
  from exact live or changed-path HEAD bytes through the shared canonical
  ingest parser and persistence helpers. Name, kind, signature, body,
  description, lines, language, and export semantics must all match before use
  and again immediately before the final transaction replay.
- The command reuses local lexical pattern evidence. It has no model,
  embedding generation, planner, provider, telemetry, network, fetch,
  Enterprise, persistence, lifecycle, hook, watcher, or Git mutation path.
- Bootstrap, ingest, update, and watch do not invoke diff review. Installed
  agent instructions place review after coding as additive evidence, never as
  policy authority.

The frozen v1 limits are exactly 200 changed paths, 1,000,000 total canonical
diff bytes, 250,000 per-file diff bytes, 100 findings, 50 conflicts, ten
evidence records per finding/conflict, 1,000,000 public JSON bytes, and 250,000
public text bytes.

## Validation

- Build and focused root/runtime/pure review slices passed. The final review
  suite has 29/29 tests, including real temporary Git repositories and
  ContextData, exact/near/over input and item caps, staged/unstaged/mixed,
  deletion/rename/binary/untracked/ignored/deduplication, authority status and
  conflict classification, fallback/no-profile/reversal determinism,
  omitted/other-path/index/untracked/linked-worktree races, independent-module
  and repository fallback selection, zero-result backing rechecks, coherently
  rehashed recursive tampering, public sanitization, and state neutrality.
- Full MCP passed 587/587 including the final boundary cases. Context
  regressions passed 81/81 and the root
  Node suite passed 394/394.
- Frontend typecheck/build passed with 2,267 transformed modules. Five
  dependency audits reported zero vulnerabilities. Version synchronization
  reports 2.5.2.
- Packed containment passed with 430 entries at modes 409/21, inventory digest
  `0dd5599b782a30509a82d2e83c0e10bd8f21055228821c15c3e58dc343141795`,
  ownership 395/95, and forced-upgrade 56 changed/15 new. The final tarball
  SHA-256 is
  `a2c7d0754eb84972fbb95356f9b142af9bb76b652a1de9d0f86e90f1d436a4df`.
- A clean managed repository passed init, bootstrap, clean and one-file diff
  review, changed update, and watch start/status/stop. It indexed 6 files, 17
  chunks, 29/29 embeddings with zero failures, and two convention profiles;
  clean review observed zero paths and diff review observed one path. The
  target checkout bootstrap indexed 159 files, 1,299 chunks, 1,478/1,478
  embeddings with zero failures, and 12 profiles.

Production builders exercise exact/near/over path, per-file byte, total byte,
finding, and conflict boundaries. Public JSON/text overflow is physically
unreachable from a valid production result under the stricter path, item,
evidence, and per-field caps; the serializers still measure final UTF-8 bytes
and fail closed. No fabricated schema-only payload is claimed as a production
response-cap reproduction.

## Fail-closed reproductions

These literal commands are covered by the root/runtime tests and emit bounded
sanitized failures without importing a repository runtime for malformed input:

```bash
node bin/cortex.mjs review --json
node bin/cortex.mjs review target --diff --json
node bin/cortex.mjs review --diff --diff --json
node bin/cortex.mjs review --diff --unknown --json
```

The production-boundary matrix is reproducible with:

```bash
npm --prefix scaffold/mcp run build --silent
node --test scaffold/mcp/tests/review.test.mjs
node --test scaffold/mcp/tests/query-cli.test.mjs tests/review-cli-shim.test.mjs
```

## Exact executable reproduction

Run the following literal, placeholder-free sequence from
`/Users/danielnilsson/GIT/cortex-wo-c-2.5.2`. It uses only the checkout-local
CLI; every temporary artifact is confined to a unique `/tmp/cortex-wo-c-*`
directory.

```bash
set -euo pipefail
repo_root="$PWD"
test "$repo_root" = /Users/danielnilsson/GIT/cortex-wo-c-2.5.2
test "$(node -p 'require("./package.json").version')" = 2.5.2

npm --prefix scaffold/mcp run build --silent
node --test scaffold/mcp/tests/review.test.mjs
node --test scaffold/mcp/tests/query-cli.test.mjs tests/review-cli-shim.test.mjs
npm --prefix scaffold/mcp test --silent
npm test --silent
npm --prefix frontend run build
npm run audit:dependencies --silent
npm run release:check-version-sync --silent
node tests/packed-filesystem-containment.test.mjs
git diff --check
git diff --cached --check
git diff 482f196 --check

# Fresh managed init/bootstrap, clean and one-file review, update, and watch.
managed_parent="$(cd "${TMPDIR%/}" && pwd -P)"
managed_dir="$(mktemp -d "$managed_parent/cortex-wo-c-managed.XXXXXX")"
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
for rel in src/review.ts src/cli/query.ts dist/review.js dist/cli/query.js build.mjs package.json; do
  cmp "scaffold/mcp/$rel" "$managed_dir/.context/mcp/$rel"
done
git -C "$managed_dir" add -A
git -C "$managed_dir" -c core.hooksPath=/dev/null -c user.name=Cortex -c user.email=cortex@example.invalid commit -qm managed-baseline
(cd "$managed_dir" && node "$repo_root/bin/cortex.mjs" review --diff --json > /tmp/cortex-wo-c-managed-clean.json)
node -e 'const fs=require("node:fs");const v=JSON.parse(fs.readFileSync("/tmp/cortex-wo-c-managed-clean.json"));if(v.ok!==true||v.data.changed_files.observed_count!==0)throw Error("managed clean review")'
apply_patch <<PATCH
*** Begin Patch
*** Update File: $managed_dir/src/sample.mjs
@@
-  return value;
+  return String(value);
*** End Patch
PATCH
(cd "$managed_dir" && node "$repo_root/bin/cortex.mjs" review --diff --json > /tmp/cortex-wo-c-managed-diff.json)
node -e 'const fs=require("node:fs");const v=JSON.parse(fs.readFileSync("/tmp/cortex-wo-c-managed-diff.json"));if(v.ok!==true||v.data.changed_files.observed_count!==1)throw Error("managed diff review")'
(cd "$managed_dir" && node "$repo_root/bin/cortex.mjs" update)
(cd "$managed_dir" && node "$repo_root/bin/cortex.mjs" watch start --mode poll --interval 2)
(cd "$managed_dir" && node "$repo_root/bin/cortex.mjs" watch status)
(cd "$managed_dir" && node "$repo_root/bin/cortex.mjs" watch stop)
(cd "$managed_dir" && test "$(node "$repo_root/bin/cortex.mjs" watch status)" = "[watch] stopped")

# Refresh the checkout-managed runtime from the final scaffold. Init creates
# exactly these two tracked template deltas; restore them literally.
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

# Save normal config bytes, apply the exact expanded-index patch, and bind both.
evidence_dir="$(mktemp -d /tmp/cortex-wo-c-pattern.XXXXXX)"
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
+docs/agent-control/wo-c-diff-review-2.5.2-results.md
+docs/repository-diff-review.md
+scaffold/AGENTS.md
+scaffold/mcp/build.mjs
+scaffold/mcp/src/cli/query.ts
+scaffold/mcp/src/review.ts
+scaffold/mcp/src/types.ts
+scaffold/mcp/tests/query-cli.test.mjs
+scaffold/mcp/tests/review.test.mjs
+scaffold/ownership/v1.json
+tests/cli-contract.test.mjs
+tests/init-agents.test.mjs
+tests/packed-filesystem-containment.test.mjs
+tests/query-cli-shim.test.mjs
+tests/review-cli-shim.test.mjs
+tests/scaffold-migration.test.mjs
*** End Patch
PATCH
i=0
while IFS= read -r target; do
  i=$((i + 1))
  artifact="$(printf '%s/%03d.json' "$evidence_dir" "$i")"
  node bin/cortex.mjs pattern-evidence "$target" --json > "$artifact"
done < "$targets_file"
test "$i" -eq 22
node - "$evidence_dir" "$targets_file" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const [dir, targetsFile] = process.argv.slice(2);
const expected = fs.readFileSync(targetsFile, "utf8").trimEnd().split("\n").sort();
const artifacts = fs.readdirSync(dir).filter((name) => /^\d{3}\.json$/.test(name)).sort();
if (artifacts.length !== 22 || expected.length !== 22) throw Error("pattern artifact count");
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
if (targetDigest !== "6a93a19d762cf3e238c52ebe7f82ae0616b78cf62d85056b2956a20d56c286e1") throw Error("target digest");
if (summaryDigest !== "7a0483e55e26d3095083f48163e5d964833bad73d118c18ccbf37cdbb0606f22") throw Error("summary digest");
console.log(JSON.stringify({ artifacts: 22, targetDigest, summaryDigest }));
NODE

# Restore normal config literally and byte-for-byte, then do the final update.
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

# Validate the exact configured path/checksum set; every ingest, relation,
# graph, embedding, convention manifest; and every canonical profile backing.
node --input-type=module <<'NODE'
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONVENTION_LIMITS, canonicalConventionJson, readConventionProfile, validateConventionProfilesWithContext } from "./scaffold/mcp/dist/conventions.js";
import { loadContextData } from "./scaffold/mcp/dist/graph.js";
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const readJsonl = (file) => fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const docs = readJsonl(".context/cache/documents.jsonl");
if (docs.length !== 162) throw Error(`configured count: ${docs.length}`);
const ids = docs.map((doc) => doc.id);
const paths = docs.map((doc) => doc.path);
if (new Set(ids).size !== docs.length || new Set(paths).size !== docs.length) throw Error("document identity uniqueness");
const pathDigest = sha(`${[...paths].sort().join("\n")}\n`);
if (pathDigest !== "e942f4176ad67b01b58822d6675ee4ec61b28fa67f336694eafc06fa25d3a089") throw Error(`configured path set: ${pathDigest}`);
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
const profileRoot = ".context/cache/conventions/v1";
const manifest = JSON.parse(fs.readFileSync(path.join(profileRoot, "manifest.json"), "utf8"));
if (manifest.schema_version !== 1 || manifest.generator_version !== "repo-conventions-v1" || manifest.repository_id !== "cortex" || canonicalConventionJson(manifest.limits) !== canonicalConventionJson(CONVENTION_LIMITS) || manifest.profiles.length !== 12) throw Error("convention manifest root/limits");
const sortedIds = manifest.profiles.map((entry) => entry.profile_id);
if (JSON.stringify(sortedIds) !== JSON.stringify([...sortedIds].sort()) || new Set(sortedIds).size !== 12 || new Set(manifest.profiles.map((entry) => entry.relative_path)).size !== 12) throw Error("convention manifest order/uniqueness");
const expectedIndex = sha(canonicalConventionJson(manifest.profiles.map((entry) => [entry.profile_id, entry.source_hash, entry.profile_hash])));
if (manifest.index_hash !== expectedIndex) throw Error("convention manifest index hash");
let aggregateBytes = 0;
const profiles = [];
for (const entry of manifest.profiles) {
  const file = path.join(profileRoot, entry.relative_path);
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

# Build the accepted base and compare all accepted public commands byte-for-byte
# against the candidate over the same final normal context; print every hash.
base_dir="$(mktemp -d /tmp/cortex-wo-c-base.XXXXXX)"
git archive 482f196 scaffold/mcp | tar -x -C "$base_dir"
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
for kind in search related impact conventions guidance pattern; do
  case "$kind" in
    search) args=(search parseReviewArgs --top-k 1 --preset minimal --json) ;;
    related) args=(related file:bin/cli/query-command.mjs --depth 2 --edges --metadata --json) ;;
    impact) args=(impact file:bin/cli/query-command.mjs --depth 2 --top-k 8 --json) ;;
    conventions) args=(conventions bin/cli/query-command.mjs --json) ;;
    guidance) args=(guidance bin/cli/query-command.mjs --task "preserve accepted command behavior" --json) ;;
    pattern) args=(pattern-evidence bin/cli/query-command.mjs --json) ;;
  esac
  run_query "file://$repo_root/scaffold/mcp/dist/cli/query.js" "$base_dir/current-$kind.json" "${args[@]}"
  run_query "file://$base_dir/scaffold/mcp/dist/cli/query.js" "$base_dir/base-$kind.json" "${args[@]}"
  cmp "$base_dir/base-$kind.json" "$base_dir/current-$kind.json"
  shasum -a 256 "$base_dir/current-$kind.json"
done
git diff --exit-code 482f196 -- package.json package-lock.json frontend/package.json frontend/package-lock.json scaffold/mcp/package.json scaffold/mcp/package-lock.json scaffold/scripts/parsers/package.json scaffold/scripts/parsers/package-lock.json scripts/parsers/package.json scripts/parsers/package-lock.json scaffold/mcp/src/search.ts scaffold/mcp/src/searchCore.ts scaffold/mcp/src/searchResults.ts scaffold/mcp/src/searchAspects.ts scaffold/mcp/src/relatedTraversal.ts scaffold/mcp/src/relatedResponse.ts scaffold/mcp/src/impactTraversal.ts benchmark/bootstrapbench/lib/two-pass-retrieval.mjs scaffold/mcp/src/conventions.ts scaffold/mcp/tests/conventions.test.mjs scaffold/mcp/src/guidance.ts scaffold/mcp/tests/guidance.test.mjs

# Snapshot exactly 18 context/profile/external files and compare byte, identity,
# link, size, and nanosecond-mtime state across repeated JSON/text review.
state_dir="$(mktemp -d /tmp/cortex-wo-c-state.XXXXXX)"
sentinel="$state_dir/external-sentinel.txt"
apply_patch <<PATCH
*** Begin Patch
*** Add File: $sentinel
+WO-C external immutability sentinel
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
  return { file, realpath: fs.realpathSync(file), link: stat.isSymbolicLink() ? fs.readlinkSync(file) : null, dev: stat.dev.toString(), ino: stat.ino.toString(), mode: stat.mode.toString(), nlink: stat.nlink.toString(), size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString(), sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") };
});
process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
NODE
}
snapshot_state > "$state_dir/before.json"
node bin/cortex.mjs review --diff --json > "$state_dir/review-1.json"
node bin/cortex.mjs review --json --diff > "$state_dir/review-2.json"
node bin/cortex.mjs review --diff > "$state_dir/review-1.txt"
node bin/cortex.mjs review --diff > "$state_dir/review-2.txt"
cmp "$state_dir/review-1.json" "$state_dir/review-2.json"
cmp "$state_dir/review-1.txt" "$state_dir/review-2.txt"
snapshot_state > "$state_dir/after.json"
cmp "$state_dir/before.json" "$state_dir/after.json"
shasum -a 256 "$state_dir/before.json" "$state_dir/review-1.json" "$state_dir/review-1.txt"

node bin/cortex.mjs doctor
test "$(node bin/cortex.mjs watch status)" = "[watch] stopped"
node bin/cortex.mjs status
git diff --check
git diff --cached --check
git diff 482f196 --check
test "$(git status --short | awk '/^ M/{m++} /^\?\?/{a++} END{print m+0, a+0}')" = "17 8"
test "$(git status --short | wc -l | tr -d ' ')" = 25
git status --short
```

## Compatibility and residuals

- Accepted WO-A/WO-B convention, guidance, search, related, impact,
  pattern-evidence, and two-pass source files retain accepted-base bytes.
  Current and archived-base runtimes are compared against the same final
  normal context for exact public-byte parity.
- No dependency, lockfile, package-version, search ranking, Enterprise review,
  policy/trust, two-pass, convention, or guidance behavior changed.
- The existing narrow trusted-same-user filesystem syscall interval remains:
  portable Node filesystem APIs cannot make the complete Git/filesystem read
  transaction atomic. The implementation narrows and detects identity/byte
  changes before emitting; no waiver or new external-data exposure is added.
- A preexisting ignored generated runtime contained an unowned build marker.
  Force-init failed closed; that runtime was preserved in a temporary
  quarantine and the candidate managed runtime was installed and bootstrapped
  cleanly. This is generated-state hygiene, not a tracked candidate change.

## Frozen context and compatibility evidence

- The final packet-053 expanded indexing covered 176 files, 1,367 chunks, 1,566/1,566 embeddings
  with zero failures, and 17 profiles. Exactly 22 pattern artifacts passed;
  output-target digest
  `6a93a19d762cf3e238c52ebe7f82ae0616b78cf62d85056b2956a20d56c286e1`
  and `target<TAB>PASS` digest
  `7a0483e55e26d3095083f48163e5d964833bad73d118c18ccbf37cdbb0606f22`.
- Normal config was restored byte-for-byte at SHA-256
  `cda6f934ef670a609d56ef11a1f4387e450468e39e66cb446f8d1749f5a9e86a`.
  The remediated normal index has 162/162 unique live/checksum-backed documents, path-set
  digest
  `e942f4176ad67b01b58822d6675ee4ec61b28fa67f336694eafc06fa25d3a089`,
  1,323 chunks, 1,505/1,505 embeddings with zero failures, and 12
  context-validated profiles. The literal validator below recomputes the
  convention index hash after the final results bytes instead of embedding a
  self-referential value here.
- Archived accepted-base `482f196` and candidate runtimes emitted identical
  search, related, impact, conventions, guidance, and pattern-evidence bytes
  against the same final normal context. The literal runner prints each final
  SHA-256 rather than retaining hashes from an earlier context generation.
- `cortex doctor` passed 8/8, watcher status was exactly `[watch] stopped`,
  and syntax/base/cached diff checks passed. Repeated installed JSON and text
  review plus the complete 18-file context/profile/external state snapshot are
  byte, identity, link, size, and nanosecond-mtime neutral; response hashes are
  deliberately not embedded here because this file is itself review input.

## Reviewer disposition

Owner disposition: ready for the same single reviewer to perform only narrow
read-only delta verification of the complete 25-path remediated candidate.
The manager accepted WO-C locally after the same single reviewer verified the
packet-053 closure with no actionable finding. WO-D remains not started and
requires a separate fresh work order.
