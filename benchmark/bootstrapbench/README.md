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

`repos.json` lists 67 repositories across python/js/ts/go/rust/java/c/c++,
extracted from the AgentStackBench task datasets (SWE-bench Verified,
SWE-bench Pro, SWE-PolyBench, Multi-SWE-Bench). Unlike those benchmarks we do
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
```

### Config keys

| Key               | Default                          | Meaning                                   |
| ----------------- | -------------------------------- | ----------------------------------------- |
| `run_name`        | `"run"`                          | prefix for generated run ids              |
| `repos`           | `"all"`                          | `"all"` or array of `owner/name`          |
| `embed_models`    | `["Xenova/all-MiniLM-L6-v2"]`    | embedding models (via `CORTEX_EMBED_MODEL`) |
| `parallelism`     | `1`                              | concurrent containers                     |
| `timeout_minutes` | `90`                             | per-item timeout (container is killed)    |
| `docker.image`    | `cortex-bootstrapbench:local`    | image tag                                 |
| `docker.build`    | `true`                           | pack cortex + rebuild image before run    |
| `docker.platform` | `linux/amd64`                    | container platform (see note below)       |
| `results_dir`     | `benchmark/bootstrapbench/results` | output root                             |

Non-default embedding models are downloaded inside the container at runtime
(network required); the default model ships pre-cached in the image.

> **Why linux/amd64?** ryugraph's npm package currently ships a
> `linux-arm64` prebuilt whose ELF is actually x86_64, so graph loading
> breaks on native arm64 containers. Pinning the platform makes runs work on
> Apple Silicon (via Rosetta) and match amd64 CI runners. Treat timing
> numbers measured under emulation as indicative, not absolute.

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

writes `site-data/bootstrap/summary.json` and
`site-data/bootstrap/repos/<repo-key>.json`, which the frontend serves as
static assets. Commit the refreshed `site-data/` to publish on the next push
to `main` (GitHub Pages deploys automatically).
