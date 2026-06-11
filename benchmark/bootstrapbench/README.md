# Bootstrapbench — cortex bootstrap evaluation harness

Measures how the cortex **bootstrap/embedding phase** behaves on large,
representative real-world repositories: chunking output, embedding model
behavior, and how chunks are interconnected in the graph model. Results power
the bootstrap metrics pages on the cortex website (see `frontend/`).

## How it works

For every selected *(repo × embedding model)* pair the runner launches an
**isolated Docker container** that:

1. clones the repo at its **pinned commit** (shallow fetch by sha),
2. installs nothing from the npm registry — the image carries cortex packed
   from the **local source tree** (`npm pack` → global install),
3. runs `cortex init` (source-path auto-detection) and `cortex bootstrap`
   (deps → ingest → embeddings → graph load) with per-phase timing capture,
4. extracts statistics from the `.context/` artifacts into one
   `stats.json` per item.

The image pre-warms per-project caches (MCP `node_modules`, parser deps, the
default embedding model) by bootstrapping a tiny sample project at build time,
so eval runs are fast and do not depend on registry availability.

## Test-data repos

`repos.json` lists 69 repositories across python/js/ts/go/rust/java/c/c++:
67 extracted from the AgentStackBench task datasets (SWE-bench Verified,
SWE-bench Pro, SWE-PolyBench, Multi-SWE-Bench) plus cortex and
AgentStackBench themselves. Unlike those benchmarks we do
**not** use per-task base commits: each repo is pinned to the latest
default-branch HEAD at pin time, so evals are repeatable on the exact same
tree until pins are deliberately refreshed:

```bash
node benchmark/bootstrapbench/sync-repos.mjs            # fill missing pins only
node benchmark/bootstrapbench/sync-repos.mjs --update   # re-pin everything to latest HEAD
node benchmark/bootstrapbench/sync-repos.mjs --update --repo iamkun/dayjs
```

## Running an eval

```bash
# Smoke run (two small repos, default embedding model)
node benchmark/bootstrapbench/run.mjs --config benchmark/bootstrapbench/config.smoke.json

# Full run over every repo in the manifest
node benchmark/bootstrapbench/run.mjs --config benchmark/bootstrapbench/config.example.json

# Useful flags
#   --run-id <id>    stable run directory name
#   --skip-build     reuse the existing docker image
#   --dry-run        print the planned items without running
#   --resume         with a reused --run-id, skip already-completed items
#                    (a Docker daemon outage aborts the queue cleanly; resume
#                    once the daemon is back)
```

### Config keys

| Key               | Default                          | Meaning                                   |
| ----------------- | -------------------------------- | ----------------------------------------- |
| `run_name`        | `"run"`                          | prefix for generated run ids              |
| `repos`           | `"all"`                          | `"all"` or array of `owner/name`          |
| `embed_models`    | `["Xenova/all-MiniLM-L6-v2"]`    | embedding models (via `CORTEX_EMBED_MODEL`) |
| `cortex.source`   | `"local"`                        | `"local"` packs the working tree; `"npm"` fetches a published release |
| `cortex.version`  | —                                | npm version or dist-tag when `cortex.source` is `"npm"`; validated against the registry |
| `parallelism`     | `1`                              | concurrent containers                     |
| `timeout_minutes` | `90`                             | per-item timeout (container is killed)    |
| `docker.image`    | `cortex-bootstrapbench:local`    | image tag                                 |
| `docker.build`    | `true`                           | pack cortex + rebuild image before run    |
| `docker.platform` | host platform                    | set e.g. `linux/amd64` to force emulation |
| `docker.cpus`     | `"auto"`                         | CPU quota per container (`auto` = daemon CPUs / parallelism; `null` = unlimited) |
| `results_dir`     | `benchmark/bootstrapbench/results` | output root                             |

Non-default embedding models are downloaded inside the container at runtime
(network required); the model the image warmup used ships pre-cached.

> **Model cost note.** cortex 2.1.0's default embedding model
> (`jinaai/jina-embeddings-v2-base-code`, 768-dim, 8k context) measured
> ~20x slower per entity than `Xenova/all-MiniLM-L6-v2` in this harness —
> a full 69-repo run is multi-day on a laptop. `config.example.json`
> therefore pins MiniLM for cross-version comparability;
> `config.full-jina.json` runs the 2.1.0 default model as shipped (use a
> big machine or a repo subset).

> **Platform note.** ryugraph's npm package ships a `linux-arm64` prebuilt
> whose ELF is actually x86_64 (and its x86_64 binary needs glibc ≥ 2.38).
> On arm64 the image therefore compiles ryugraph from its bundled source at
> build time — a one-time cost that makes eval containers run natively on
> Apple Silicon (~10x faster embedding than under Rosetta). On amd64 hosts
> and CI runners the prebuilt is used as-is.

## What gets measured (per repo × model)

- **Workspace** — tracked files/bytes at the pinned commit, detected source paths.
- **Timings** — per bootstrap phase: deps, ingest, embed, graph load, status.
- **Chunks** — totals, by language, by kind (function/class/…); size
  distributions in lines and characters (percentiles + fixed-bucket
  histograms so runs can be merged).
- **Embeddings** — model, dimensions, embedded/reused/failed counts, per
  entity type, throughput.
- **Graph** — node counts, edges by relation type (CALLS, DEFINES, IMPORTS,
  …), and chunk-to-chunk connectivity from CALLS edges: average/max degree,
  isolated-chunk share, degree distribution, most-connected chunks.

## Outputs

```
results/<run-id>/
├── config.json              # run config snapshot
├── summary.json             # aggregate across all items (totals, by model, by language)
└── items/<repo>__<model>/
    ├── stats.json           # the per-item stats document
    ├── bootstrap.log        # timestamped bootstrap output
    └── init.log
```

## Publishing to the website

```bash
node benchmark/bootstrapbench/export-site-data.mjs \
  --run-dir benchmark/bootstrapbench/results/<run-id>
```

writes the results keyed by the cortex version the run measured:
`site-data/bootstrap/<version>/summary.json`,
`site-data/bootstrap/<version>/repos/<repo-key>.json`, and updates
`site-data/bootstrap/index.json` (the version list the frontend's dropdown
shows). Re-exporting a run for the same version replaces only that version;
results for other cortex versions are never touched. Commit the refreshed
`site-data/` to publish on the next push to `main` (GitHub Pages deploys
automatically).
