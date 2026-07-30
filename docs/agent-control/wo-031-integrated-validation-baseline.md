# WO-031 Integrated Validation and Release Baseline

## Acceptance State

WO-031 is accepted locally on `refactor/cli-ingest-modularization`. All
technical gates and the six independent reviewer roles passed before release
metadata moved from `2.4.1` to `2.4.2`.

This record prepares a release candidate only. No package publish, tag, push,
merge, deployment, or Release Bump workflow dispatch occurred.

## Integrated Test Matrix

- Syntax passed for 42 executable entrypoints and extracted CLI/ingest modules;
  executable shell files also passed `bash -n`.
- The focused CLI, query, init, agent, migration, ownership, Enterprise,
  ingest, worker, failure, trace, and memory matrix passed 139/139.
- Context regressions passed 81/81.
- The final root Node suite passed 321/321 after the `2.4.2` metadata sync.
- The MCP suite passed 413/413.
- All five committed npm dependency trees report zero vulnerabilities: root,
  frontend, MCP, scaffold parser, and development parser.
- Release metadata is synchronized at `2.4.2`; plugin/marketplace tests pass
  6/6; the release-bump workflow parses as valid YAML; `git diff --check`
  passes.
- Cortex refresh completed with zero embedding failures. Pattern evidence
  passed for all 10 changed indexed files; the 10 package, workflow, plugin,
  registry, and test paths outside configured source paths returned the
  expected not-indexed result and are covered by direct tests/review. Doctor
  passed 8/8, and the optional watcher is stopped.

## Frozen Contract Comparison

The normalized WO-026 digests remain unchanged:

| Mode | Normalized SHA-256 |
|---|---|
| Full JSONL tree | `937102d472623c4d852762ab700ae510bdc30927ee8aec9aa890976e3b4d44fe` |
| Full TSV tree | `253278db329ecd74ebce9379a2e406e71841388f37ae2ee4ebf166459df7dd43` |
| Changed/deleted JSONL tree | `4fe3cf7e15908215863476a53c785c045ea71af75fb3db76ee88b41020276f3f` |
| Changed/deleted TSV tree | `7e70109126569d4534c340ce6791bb4dc8c295c7db70eb9faf14196beda6c2f4` |

Sequential/parallel output and the 56-file worker-failure pipeline remain
byte-identical. All 17 memory trace labels and required fields remain present,
and completion still reports zero retained and pending worker results.

## Extracted Package and Upgrade Smoke

The pre-release `2.4.1` tarball was installed into an empty temporary prefix
and exercised as the extracted artifact:

1. A clean `init --bootstrap` completed initialization, then bootstrap stopped
   when the sandbox could not resolve the npm registry. The failure log was a
   DNS/environment restriction rather than a package or runtime failure.
2. The same initialized repository resumed under approved network access with
   `init --force --bootstrap --no-watch --no-connect`. It installed both
   dependency trees with zero audit findings, indexed seven files into 19
   chunks and 32 embeddings, and loaded the graph.
3. Community-mode `doctor` passed 8/8. Packed `update` succeeded, and packed
   `search --json` returned `chunk:src/math.mjs:add:1-3`.
4. A packed forced upgrade removed the exact legacy root ingest worker while
   preserving custom config, ontology, agent instructions, an unknown
   `.context` file, and Enterprise content. It persisted 380 managed
   fingerprints and repaired Enterprise config mode to `0600`.
5. A later doctor run intentionally observed the artificial Enterprise config
   and reported the missing Enterprise plugin. That expected enrollment
   diagnostic is separate from the clean community doctor gate above.

The final real `2.4.2` tarball was rebuilt and re-inspected after the metadata
sync:

- filename: `danielblomma-cortex-mcp-2.4.2.tgz`;
- 417 entries; 633,115 packed and 2,670,791 unpacked bytes;
- npm SHA-1:
  `c1f968a7600645681f7117ef9bb03251a3b4cc00`;
- 19 `bin/cli` modules, 15 canonical ingest modules, and all three ownership
  JSON files;
- `bin/cortex.mjs`, packaged ingest, and bootstrap modes are `0755`;
- package and MCP registry Node requirements both equal `>=20.9.0`;
- a second empty-prefix install contained exactly
  `@danielblomma/cortex-mcp`, and `cortex version` reported `2.4.2`.

The `2.4.2` rerun covers the metadata-affected package, registry, install,
version, workflow, and full-root gates. Runtime bootstrap/search/upgrade bytes
are unchanged from the accepted extracted `2.4.1` smoke.

## Repeated Memory Evidence

Three sequential Docker runs used the exact WO-026 configuration, pinned
repositories, model, parallelism, and no CPU quota. All six repository samples
completed with `status=ok`.

| Repository | Run | Total ms | Ingest ms | Embed ms | Peak RSS MB | Peak phase |
|---|---:|---:|---:|---:|---:|---|
| `DanielBlomma/cortex` | 1 | 9,395 | 361 | 5,829 | 630.80 | embed |
| `DanielBlomma/cortex` | 2 | 8,691 | 414 | 5,645 | 633.16 | embed |
| `DanielBlomma/cortex` | 3 | 9,098 | 395 | 5,775 | 631.46 | embed |
| `angular/angular` | 1 | 669,210 | 5,713 | 659,549 | 1,016.16 | ingest |
| `angular/angular` | 2 | 665,919 | 5,590 | 655,940 | 1,030.10 | ingest |
| `angular/angular` | 3 | 672,381 | 5,673 | 662,371 | 1,013.32 | ingest |

| Repository | WO-026 median MB | WO-029 median MB | WO-031 median MB | Delta vs WO-026 | Delta vs WO-029 |
|---|---:|---:|---:|---:|---:|
| `DanielBlomma/cortex` | 614.34 | 626.87 | 631.46 | +2.79% | +0.73% |
| `angular/angular` | 1,034.24 | 1,030.64 | 1,016.16 | -1.75% | -1.40% |

Both medians remain inside the five-percent acceptance band. The ignored raw
summaries are:

- `benchmark/bootstrapbench/results/wo031-memory-1-20260730/summary.json`
- `benchmark/bootstrapbench/results/wo031-memory-2-20260730/summary.json`
- `benchmark/bootstrapbench/results/wo031-memory-3-20260730/summary.json`

## Review Closure and Release Fixes

Independent Code Quality, Contract, Security and Privacy, Integration,
Validation, and Ops/Release reviewers inspected the complete program diff and
validation evidence.

Ops/Release found one major release-contract mismatch: the shipped MCP registry
submission advertised Node 18 while the package required Node 20.9. The
registry now derives both npm package name and Node requirement from
`package.json`, version synchronization validates it, and a focused manifest
test locks the contract. Ops/Release then found one minor staging omission:
the Release Bump workflow did not stage the registry submission. The workflow
now stages that synchronized file.

After those fixes, every reviewer returned PASS with no blocker, major, or
minor findings. Security and Privacy confirmed no new source upload, secret
egress, runtime network path, compatibility removal, or dependency change.

## Prepared Release Metadata

- `package.json`, lockfile, server metadata, both plugin manifests, and the
  marketplace entry are synchronized at `2.4.2`.
- `CHANGELOG.md` and `README.md` describe the behavior-preserving
  modularization and managed-upgrade change.
- `mcp-registry-submission.json` is part of the synchronized release contract.
- The Release Bump workflow would commit, tag, push, and trigger publication;
  it was validated statically and was not dispatched.

## Residual Boundary

- R14 and R15 are mitigated by the integrated extracted-package evidence.
- R16 remains the accepted pre-existing ingest filesystem-containment risk and
  requires a separate behavior-changing security work order.
- The narrow same-user ancestor-swap interval documented by WO-030 remains an
  accepted repo-local concurrency assumption.
- Remaining release actions require explicit instruction: push/open or update
  the PR, merge, tag, publish, and deploy.
