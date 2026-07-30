# WO-026 Characterization and Baseline

## Scope

WO-026 freezes the observable Cortex 2.4.1 CLI, Enterprise, ingest, package,
and memory behavior before modularization. It does not refactor runtime code.

- Release baseline:
  `5ae3b00948bad26af2e5eaea60ce0b52567db352` (`v2.4.1`)
- Branch: `refactor/cli-ingest-modularization`
- CLI entry: `bin/cortex.mjs` (1,862 lines)
- Development ingest: `scripts/ingest.mjs` (3,717 lines)
- Packaged ingest: `scaffold/scripts/ingest.mjs` (3,910 lines)
- Root ingest SHA-256:
  `5b168c9608ef56a1b6fd7237339319c1a76158aa0d79af529f66156d9e58e161`
- Packaged ingest SHA-256:
  `359f213f868e280212c44972a9fc8af58edb6cba28bc3c767d0ec288b52ee6e6`

The unequal ingest hashes record the pre-existing source drift that WO-028 must
remove.

## CLI Command Inventory

### Global behavior

| Surface | Contract |
|---|---|
| No command | Same output as `help`; exit 0 |
| Help aliases | `help`, `--help`, `-h`; stdout only; exit 0 |
| Version aliases | `version`, `--version`, `-V`; exact package version plus newline on stdout; exit 0 |
| Unknown top-level command | Concise diagnostic on stderr; exit 1 |
| Top-level caught error | Styled single-line diagnostic on stderr; exit 1 |
| Context child process | Child stdout/stderr inherited without redirection; nonzero child becomes a top-level stderr error |
| JSON query validation error | JSON error envelope on stdout, empty stderr, exit 1 |

The subprocess matrix also executes successful `connect`, `mcp`, `hook`,
`hooks`, `telemetry`, `run`, and `stage` dispatch against isolated stub
runtimes. It freezes raw argument forwarding, selected project root, inherited
streams, exact handler-owned exit codes, and the current MCP behavior where a
nonzero server exit becomes a top-level exit 1 diagnostic.

### CLI-owned commands

| Command | Subcommands/options | Defaults and passthrough |
|---|---|---|
| `init [path]` | `--force`, `--bootstrap`, `--connect`, `--no-connect`, `--watch`, `--no-watch` | path=`cwd`; force=false; bootstrap=false; connect=false; watch=true; later positional paths replace earlier ones; unknown flags fail |
| `connect [path]` | `--skip-build` | path=`cwd`; skipBuild=false; unknown flags fail |
| `mcp` | no CLI-owned flags | project=`CORTEX_PROJECT_ROOT` or `cwd`; keeps `.context/mcp`; stdio inherited |
| `daemon` | `start`, `stop`, `restart`, `status` | default=`status`; PID plus socket handshake required before signaling |
| `hook <name>` | hidden compatibility bridge | name maps to project runtime hook; stdio inherited |
| `hooks` | `install`, `uninstall`, `status`, `--project` | default subcommand=`status`; default scope=user; `--project` selects project settings |
| `telemetry` | `test`, `help`, `--help`, `-h` | default=`help`; `test` returns runtime exit code |
| `run` | `claude`, `codex`, `copilot`, followed by raw args; help aliases | named AI CLI is required; child exit code is returned |
| `stage` | `start`, `status`, `envelope`, `advance`, `run`, help aliases | entire tail is forwarded to project stage runtime |
| `enterprise` | see Enterprise inventory below | no subcommand defaults to help |

### Query commands

Every query command resolves
`.context/mcp/dist/cli/query.js` from `CORTEX_PROJECT_ROOT` or `cwd`, forwards
the complete argument list, supports human output, and uses the semantic
envelope `{ ok, command, input, context_source?, warning?, data? }` for JSON
success. JSON validation failures use
`{ ok:false, command, error:{ code:"INVALID_ARGS", message } }`.

| Command | Options and aliases | Defaults |
|---|---|---|
| `search <query>` | `--query`, `--top-k`, `--preset`/`--response-preset`, `--include-deprecated`, `--scores`/`--include-scores`, `--matched-rules`/`--include-matched-rules`, `--include-content`, `--json` | top-k=5; max=20 |
| `related <entity-id>` | `--entity-id`, `--depth`, `--edges`/`--include-edges`, `--metadata`/`--include-entity-metadata`, preset aliases, `--json` | depth=1; max=3 |
| `impact <seed>` | `--entity-id`, `--query`, `--depth`, `--top-k`, `--no-edges`, preset aliases, score/reason aliases, `--verbose-paths`, `--max-path-hops-shown`, `--profile`, `--sort-by`, relation/path/domain/entity filters, `--json` | depth=2; top-k=8; edges=true; max shown hops=3; profile=all; sort=impact_score |
| `rules` | `--scope`, `--include-inactive`, `--json` | include-inactive=false |
| `explain <seed>` | `--id`, `--query`, `--top-k`, `--include-deprecated`, preset aliases, `--include-content`, `--json` | top-k=3; preset=full; scores and matched rules always true |
| `pattern-evidence <target>` | `--target`, `--query`, `--top-k`, `--include-deprecated`, `--json` | top-k=3; max=10 |

### Context-script passthrough

The CLI forwards the command name and every remaining argument to
`.context/scripts/context.sh` for:

- `bootstrap`
- `update`
- `status`
- `ingest`
- `embed`
- `graph-load`
- `dashboard`
- `watch`
- `refresh` (compatibility alias for ingest; not listed in top-level help)
- `memory-compile`
- `memory-lint`
- `doctor`

The packaged context-script contract advertises:

- ingest/refresh: `--changed`, `--verbose`
- embed: `--changed`
- graph-load: `--no-reset`
- dashboard: `--interval <sec>`
- watch: `start|stop|status|run|once`, `--interval`, `--debounce`,
  `--mode <auto|event|poll>`
- memory-compile: `--dry-run`, `--verbose`
- memory-lint: `--verbose`, `--json`

The top-level CLI does not reinterpret or reject flags owned by these scripts.
`bootstrap`, `update`, `refresh`, `ingest`, `embed`, and `graph-load` invalidate
the session-status cache after execution. `bootstrap` also hardens Enterprise
config permissions and restarts only a verified running daemon.

### Stage runtime inventory

The top-level shim forwards:

- `start --task-id <id> --description <text> [--workflow <id>]`
- `status --task-id <id>`
- `envelope --task-id <id> [--stage <name>]`
- `advance --task-id <id> --stage <name> --body-file <path>
  [--frontmatter-file <path>] [--status <complete|blocked|failed>]
  [--outcome-file <path>] [--validators-passed <csv>]
  [--override-reason <text>] [--override-skipped-validators <csv>]`
- `run --task-id <id> -- <command> [args...]`

## Enterprise Contract

| Surface | Frozen behavior |
|---|---|
| Help | `enterprise`, `help`, `--help`, and `-h` print stdout and exit 0 |
| Install secret | Required `--api-key-stdin`; TTY, empty, multiline, and >4096-byte input fail; secret is never echoed |
| Install options | `--endpoint`, `--frameworks <csv>`, `--no-hooks`, `--no-daemon`; default endpoint `https://cortex-web-rho.vercel.app`; default frameworks `iso27001,iso42001,soc2` |
| Positional value | Rejected as a possible secret before any runtime import; stderr; exit 1 |
| Status | `--verbose`/`-v`, `--json`; unknown flags fail before runtime import |
| Sync | sudo-required trusted runtime operation |
| Uninstall | `--break-glass`, `--reason <text>`; sudo-required |
| Repair | `--reason <text>`; sudo-required |
| Trust boundary | Enterprise setup/govern resolves only from package-owned `scaffold/mcp/dist/cli`, never project-controlled `.context`; a hostile project runtime remains unexecuted while package status succeeds, and a missing package runtime fails closed |
| Identity ordering | Verified identity binding completes before host-global govern writes |
| Privilege ordering | Host-global govern writes complete before permanent privilege drop |
| Config preservation | `config.yaml`, `rules.yaml`, `enterprise.yml`, `enterprise.yaml`, `CLAUDE.md`, and user AGENTS.md text survive `init --force`; the managed AGENTS block may be appended/refreshed |
| Config permissions | Both Enterprise YAML spellings are regular-file-only and repaired from an asserted `0644` precondition to `0600`; symlinks and non-regular paths are rejected without touching external targets |
| Daemon control | A live PID is never signaled without a verified Cortex socket handshake and matching PID |

## Ingest Characterization

### Fixture

`tests/fixtures/ingest-characterization/` covers:

- JavaScript, TypeScript, and Python code
- Swedish and English Markdown plus an ADR
- `.sln` and `.vbproj` project metadata
- Visual Basic file-level indexing
- base and transform configuration
- `.resx` resources and `.settings`
- stored-procedure SQL
- active/draft rules
- changed content and a deleted Markdown path
- a deliberately unavailable .NET parser runtime

All fixture mtimes are fixed. Intentionally variable ISO timestamps are
replaced with `<timestamp>` before hashing. Each digest hashes the sorted
relative filename, a NUL separator, normalized bytes, and a trailing NUL.

| Mode | Files | Normalized SHA-256 |
|---|---:|---|
| Full JSONL tree | 26 | `937102d472623c4d852762ab700ae510bdc30927ee8aec9aa890976e3b4d44fe` |
| Full TSV tree | 21 | `253278db329ecd74ebce9379a2e406e71841388f37ae2ee4ebf166459df7dd43` |
| Changed/deleted JSONL tree | 26 | `4fe3cf7e15908215863476a53c785c045ea71af75fb3db76ee88b41020276f3f` |
| Changed/deleted TSV tree | 21 | `7e70109126569d4534c340ce6791bb4dc8c295c7db70eb9faf14196beda6c2f4` |

`tests/ingest-parallel.test.mjs` separately crosses the 50-task threshold and
compares every JSONL/TSV output byte-for-byte between inline and four-worker
execution. `tests/ingest-worker-crash.test.mjs` covers empty tasks, zero,
negative, undefined, and single worker counts, skipped/unavailable results,
partial worker death, and all-worker death without pool hangs. Its 56-file
pipeline case replaces the worker with a test double that both skips and exits
mid-task, then compares every persisted JSONL/TSV byte with inline ingestion.
Missing, skipped, and crashed results therefore remain absent and the actual
pipeline falls back to inline parsing without output drift.

`CORTEX_INGEST_WORKERS=0` selects the inline lane. The current resolver records
that lane as `worker_count=1`; it creates no `Worker` and retains no result map.

### Memory trace schema

Every trace record has:

- `type` = `cortex.ingest.memory`
- `label`
- `rss_bytes`
- `rss_mb`
- `heap_used_bytes`
- `external_bytes`
- `counts`

The ordered checkpoint contract is:

1. `scan:start`
2. `scan:file_records`
3. `hydration:complete`
4. `parse:eligible`
5. `parse:workers_start`
6. `parse:workers_complete`
7. `parse:merge_complete`
8. `materialize:chunks_relations`
9. `materialize:modules_projects_relations`
10. `writes:file_cache_staged`
11. `tokens:rule_matching_start`
12. `tokens:rule_matching_complete`
13. `writes:cache_start`
14. `writes:cache_complete`
15. `writes:db_start`
16. `writes:db_complete`
17. `writes:manifest_complete`

Worker/result and released-content counts remain asserted by
`tests/ingest-parallel.test.mjs` and `tests/ingest-memory-trace.test.mjs`.

## Package Baseline

`npm pack --dry-run --json --cache /private/tmp/cortex-wo026-npm-cache`
completed after the MCP prepack TypeScript build.

- package: `@danielblomma/cortex-mcp@2.4.1`
- entries: 380
- packed size: 616,350 bytes
- unpacked size: 2,598,463 bytes
- tarball SHA-1: `bacd939453e9b63609bd258141d13c1279039358`
- integrity:
  `sha512-BuTIB87qnMCL3S+NmbsT/xNMLq3jIpbDeBNbUSgMdAh8ZZYnEMRxBfBRcMmoC6y/J4cNgTDb17bamjzkDNEfZw==`

A clean temporary-prefix install of that tarball:

- installed exactly one package
- reported `cortex version` = `2.4.1`
- completed `cortex init <temp> --no-watch --no-connect`
- installed `.context/scripts/ingest.mjs`,
  `.context/scripts/ingest-parsers.mjs`, and
  `.context/scripts/ingest-worker.mjs`
- retained the `.context/mcp` compatibility runtime

The first dry-run attempt used the host npm cache and hit its pre-existing
root-owned-file `EPERM`; rerunning with the isolated cache above passed. This
is host cache hygiene, not a package failure.

## Repeated Memory Baseline

Three comparable Docker runs use:

- `benchmark/bootstrapbench/config.memory-rss.json`
- local Cortex 2.4.1 package built from the WO-026 tree
- image `cortex-bootstrapbench:memory-rss`
- `Xenova/all-MiniLM-L6-v2`
- `parallelism=1`, no Docker CPU quota
- pinned Cortex SHA `051d4e6a87d968795482f65d900eda5dc8a94aae`
- pinned Angular SHA `71bb19d772aa77a30922fb896f775b58a0862c36`

The first run builds the image; runs two and three use `--skip-build`.

All six repository samples completed with `status=ok`.

| Repository | Run | Total ms | Ingest ms | Embed ms | Graph-load ms | Status ms | Peak RSS MB | Peak phase |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `DanielBlomma/cortex` | 1 | 6,455 | 115 | 2,999 | 306 | 2,227 | 615.91 | embed |
| `DanielBlomma/cortex` | 2 | 6,764 | 109 | 3,007 | 304 | 2,726 | 613.75 | embed |
| `DanielBlomma/cortex` | 3 | 6,793 | 120 | 3,029 | 325 | 2,546 | 614.34 | embed |
| `angular/angular` | 1 | 844,159 | 5,718 | 832,416 | 1,097 | 4,193 | 1,044.00 | ingest |
| `angular/angular` | 2 | 829,884 | 5,563 | 819,936 | 1,210 | 2,639 | 1,034.24 | ingest |
| `angular/angular` | 3 | 661,872 | 5,565 | 651,772 | 1,043 | 2,884 | 935.61 | embed |

Median duration and peak RSS:

| Repository | Deps ms | Ingest ms | Embed ms | Graph-load ms | Status ms | Total ms | Peak RSS MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `DanielBlomma/cortex` | 773 | 115 | 3,007 | 306 | 2,546 | 6,764 | 614.34 |
| `angular/angular` | 608 | 5,565 | 819,936 | 1,097 | 2,884 | 829,884 | 1,034.24 |

Median peak RSS by sampled phase:

| Repository | Ingest MB | Embed MB | Graph-load MB | Status MB | Unknown MB |
| --- | ---: | ---: | ---: | ---: | ---: |
| `DanielBlomma/cortex` | not sampled | 614.34 | 165.72 | 221.88 | 10.30 |
| `angular/angular` | 1,034.24 | 935.61 | 446.21 | 180.27 | 9.10 |

The durable raw summaries are:

- `benchmark/bootstrapbench/results/wo026-memory-baseline-1-20260728/summary.json`
- `benchmark/bootstrapbench/results/wo026-memory-baseline-2-20260728/summary.json`
- `benchmark/bootstrapbench/results/wo026-memory-baseline-3-20260728/summary.json`

Benchmark results are intentionally ignored build artifacts rather than committed
source. The pinned SHAs, configuration, run IDs, and medians above are the
committed comparison contract for WO-028 and WO-029.

## Automated Contract Files

- `tests/cli-contract.test.mjs`
- `tests/query-cli-shim.test.mjs`
- `tests/enterprise-cli-security.test.mjs`
- `tests/init-config.test.mjs`
- `tests/init-agents.test.mjs`
- `tests/scaffold-migration.test.mjs`
- `tests/ingest-characterization.test.mjs`
- `tests/ingest-parallel.test.mjs`
- `tests/ingest-worker-crash.test.mjs`
- `tests/ingest-memory-trace.test.mjs`

These files are part of the root `npm test` command before WO-027 begins.
