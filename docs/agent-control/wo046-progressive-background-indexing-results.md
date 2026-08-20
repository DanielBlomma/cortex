# WO-046 Progressive Background Indexing Results

Date: 2026-08-20

## Outcome

The CLI-first prototype passed its remediated implementation and Angular
validation gates. Two independent review rounds returned NO-GO on 2026-08-20;
their findings were fixed and the pinned evidence was regenerated against the
exact current scaffold after the last source change. Final independent
Code Quality/Integration, Contract/Security, and Validation re-reviews are all
GO with no blocker, major, or minor findings. The manager accepts WO-046
locally as a validated prototype; publication, release, and default-profile
changes are not implied.

WO-047 review fixes later changed six of these 14 bound sources. This report
remains the accepted historical WO-046 evidence, but it is superseded for the
2.5.0 candidate by the fresh report and hashes in
`docs/agent-control/wo-047-release-2.5.0-integration-results.md`.

The tested public lifecycle is:

```bash
cortex bootstrap --background --profile interactive
cortex indexing status --json
cortex indexing pause
cortex indexing resume
```

Foreground `cortex bootstrap` remains the default path.

## Angular Run

- Repository: `angular/angular`
- Commit: `71bb19d772aa77a30922fb896f775b58a0862c36`
- Model: `Xenova/all-MiniLM-L6-v2`
- Scope: the five query-pack packages plus `README.md`
- Profile: 2 ingest workers, 1 embedding session, 4 embedding threads
- Indexed entities: 16,314
- Machine: Apple M5 Max, 18 logical CPUs, 64 GiB, macOS 26.6
- Raw ignored evidence:
  `benchmark/bootstrapbench/results/wo046-progressive-angular-20260820-frozen-final/evidence/`
- Harness SHA-256: `b7683057156e033bb358e81c944f534ab8d6e59483652cc14f49e90f40835087`
- Source binding: 14/14 current scaffold files byte-identical to the installed
  Angular runtime

| Metric | Result |
|---|---:|
| Time to `search_ready=lexical+graph` | 9.753 s |
| Background bootstrap CLI return | 11.307 s |
| Total semantic completion | 267.570 s |
| Bootstrap peak RSS | 754.61 MiB |
| Background embedding peak RSS | 647.73 MiB |
| Background embedding peak CPU | 405.2% |
| Foreground search while embedding was active | 2.740 s |
| Pre-interruption embedded / reused / failed | 4,129 / 0 / 0 |
| Final progressive embedded / reused / failed | 12,185 / 4,129 / 0 |

The first query pack ran while the worker was intentionally paused at exactly
0/16,314. Later pause checkpoints were 1,705 (10.5%), 4,129 (25.3%), and
8,328 (51.0%). At 25%, the harness sent SIGTERM to the real worker, observed
`interrupted`, launched a new PID/run, verified the unchanged 4,129-record
checkpoint, and resumed with those records reused. Every pause first published
an atomic verified snapshot. The run finished at 16,314/16,314 with 25
checkpoints and no failure.

The 4 GiB ceiling was not imposed by a container in this final host run. The
same conservative profile stayed below 0.76 GiB in every measured phase; the
earlier container experiment in the context packet enforced 4 GiB and peaked
at 807.30 MiB.

## Retrieval Coverage

| Published coverage | Expected hits | Recall@10 | Gained vs lexical+graph | Lost vs lexical+graph |
|---|---:|---:|---:|---:|
| 0% lexical+graph | 25/42 | 59.52% | 0 | 0 |
| 10.5% | 22/42 | 52.38% | 0 | 3 |
| 25.3% | 18/42 | 42.86% | 3 | 10 |
| 51.0% | 20/42 | 47.62% | 5 | 10 |
| 100% progressive | 21/42 | 50.00% | 6 | 10 |
| 100% independent foreground control | 21/42 | 50.00% | same as progressive | same as progressive |

The raw checkpoint JSON records the exact gained/lost expected path for each
query. Partial MiniLM coverage is not monotonic against lexical+graph and is
therefore reported explicitly rather than represented as full hybrid readiness.

The complete MiniLM result is also below the earlier 27/42 Jina result. The
context packet already identified that Jina comparison as a different model
endpoint, not an exact MiniLM control. To close the progressive-regression
question, the final embeddings were moved aside and all 16,314 records were
independently regenerated in foreground mode with zero reuse. Progressive and
foreground output were byte-identical:

```text
d34a4a3a856461c88b013461769523aca1df32dffa0b11799ec7ee16c9795512
```

Both produced the same 21/42 query result. The MiniLM quality difference is
therefore endpoint/ranking behavior, not snapshot order, resume, or background
execution behavior.

## Correctness And Compatibility

- RyuGraph is loaded before the background worker is launched.
- A previous complete manifest is marked `stale` before a new background
  generation starts, so search cannot claim stale embeddings are fully ready.
- Initial, progress, pause, resume, and final outputs use same-directory temp
  files plus atomic rename. The manifest points to a complete snapshot file.
- Search validates snapshot size, record count, dimensions, and model. Invalid
  or mismatched snapshots fail to lexical fallback with an explicit warning.
- Background failure or interruption leaves lexical+graph search available.
- One generation lock covers ingest, graph, foreground embedding, progressive
  embedding, and the complete foreground update chain. A progressive worker
  cannot publish over a newer generation; the watcher retries rejected updates.
- A dead nonterminal PID is reported as `interrupted`; resume reconstructs the
  slots from the last published snapshot instead of restarting from zero.
- PID status requires the matching run ID, lock owner, and progressive command;
  the launcher publishes the child identity immediately after spawn.
- Ingest, graph, and embedding manifests carry linked generation IDs. Search
  verifies schema, generation, canonical snapshot path, byte count, SHA-256,
  record count, dimensions, and model before enabling semantics.
- Progressive state and desired control state are separate atomic files, so a
  pause request cannot be lost to worker state publication.
- Final JSONL order is entity-ID order and matches foreground generation.
- The interactive values are an explicitly selected prototype profile, not new
  universal defaults. Status records the machine/profile information needed
  for later adaptive-profile work.
- Graph publication builds a versioned database in a child process, fsyncs it,
  renames it into place, and flips the canonical manifest atomically. Forced
  failures before and after database publication preserve the previous graph.
- The launcher hands the run identity over through a private descriptor and
  waits asynchronously for a matching child PID/run acknowledgement. Late
  worker state/failure writes require the same live lock owner and cannot
  overwrite a successor run.
- Native Windows rejects progressive background mode explicitly; macOS, Linux,
  and WSL are supported. Foreground bootstrap remains available everywhere.
- Portable Node path validation inherits the repository's documented narrow
  trusted-same-user ancestor-swap assumption (R15). This local CLI/runtime is
  not a security boundary against a concurrently hostile process running as
  the same user.

## Validation

- Root full suite: context regressions 81/81; Node suite 365/365.
- MCP full suite: 433/433.
- Focused progressive lifecycle, atomic snapshot, stale/model mismatch,
  partial-coverage, CLI passthrough, scaffold migration/ownership, and harness
  tests passed.
- `npm run release:check-version-sync` passed.
- `git diff --check`, shell syntax checks, TypeScript build, harness syntax,
  and release metadata sync passed.
- Final `cortex update` completed ingest and graph refresh; its unrelated local
  Jina changed-embedding process was killed by the OS after high memory use, so
  the command retained the prior ready embedding snapshot and lexical fallback.
  `cortex doctor` then passed 8/8 with 100% freshness; watcher status is
  `stopped`. This does not alter the isolated frozen MiniLM evidence above.

## Initial Independent Review And Remediation

The first panel returned NO-GO despite green tests. Its blocker was the absence
of a generation-wide mutation lock, which allowed a stale background worker to
overwrite a newer foreground update. Major findings also covered foreground
status misreporting, stale benchmark source hashes, no real kill/restart test,
externally injected resource values, double-read manifest races, control/state
write races, weak PID identity, insufficient graph-generation validation,
unsafe managed paths, and a foreground control that reused prior embeddings.

The first remediated implementation added the generation lock and linked manifests,
single-read fail-closed snapshot loading, independent control state, verified
child identity, canonical/private regular-file checks, public fixed 2/1/4
interactive resources, foreground-derived status, exact scaffold SHA bindings,
a cold benchmark, real SIGTERM/resume, and a 16,314/0/0 zero-reuse foreground
control.

The second panel found that the embedding loader did not compare its manifest
to the current ingest generation, launcher/worker state handoff could race,
graph publication was destructive rather than atomic, legacy manifest/path
fallbacks failed open, and the snapshot hash could cover different bytes than
the parser consumed. It also identified missing durable directory metadata,
native-Windows process identity, worker startup acknowledgement, and source
bindings. The final implementation validates the whole ingest/graph/embedding
generation chain, parses and hashes one stable no-follow file descriptor,
requires schema v2 and a contained snapshot name, publishes versioned graphs
through an atomic manifest flip, fsyncs parent directories, rejects native
Windows background mode, uses descriptor handoff plus child acknowledgement,
guards every worker write by run/lock/PID ownership, and binds all 14 runtime
sources into the Angular report.

## Final Independent Review

- Code Quality and Integration: **GO**, no blocker/major/minor findings.
- Contract and Security/Privacy: **GO**, no blocker/major/minor findings. The
  trusted-same-user ancestor-swap boundary remains a documented note under the
  existing R15 threat model.
- Validation: **GO**, no blocker/major/minor findings after independently
  reproducing the frozen source/harness bindings, real SIGTERM/resume,
  2/1/4 resources, graph retention/crash recovery, raw byte/query parity, and
  full root/MCP suites.

## Decision Gate

Implementation/Angular evidence: **GO**.

Acceptance state: **accepted locally as a validated prototype**. Foreground
remains the default; promotion, publication, release, adaptive resource
selection, and query-driven lazy embedding require separate authorization.
