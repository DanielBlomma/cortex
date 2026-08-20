# Progressive Background Indexing

## Objective

Prototype and validate a CLI-first Cortex indexing path that becomes searchable
after ingest/graph publication, returns control to the user, and completes
semantic embeddings in a resumable resource-limited background process.

## User Decision

- Test the progressive design now against `angular/angular`.
- Search performance after a complete index is not the problem.
- The problem is first-time indexing latency and Cortex consuming effectively
  all CPU and memory while embeddings are generated.
- Coverage must be visible while the repository progresses toward a complete
  semantic index.

## Work Profile

One-repository, time-boxed prototype. CLI only. No MCP client/server path, no
coding agents, no AgentStackBench, and no multi-repository benchmark expansion.

Review profile: **new contract/design**. Require the full independent Code
Quality, Contract, Security/Privacy, Integration, and Validation panel.

## Direct Evidence

- Experiment report:
  `benchmark/bootstrapbench/results/angular-interactive-20260819/analysis.md`
- Reproducible resource config:
  `benchmark/bootstrapbench/config.angular-interactive.json`
- Current pipeline:
  `scaffold/scripts/bootstrap.sh`
- Embedding scheduler:
  `scaffold/mcp/src/embedScheduler.ts`
- Angular quality pack:
  `benchmark/bootstrapbench/query-packs/semantic-quality-v1/angular__angular.jsonl`
- Existing timing harness:
  `benchmark/bootstrapbench/docker/run-bootstrap.mjs`

## Measured Baseline

Pinned Angular commit:
`71bb19d772aa77a30922fb896f775b58a0862c36`.

- Existing MiniLM baseline: 648.758 s total, 639.476 s embedding,
  1,221.68 MB peak RSS.
- Interactive experiment (4 CPU, 4 GiB, 2 ingest workers, 1 embedding
  session): 1,842.383 s total, 1,830.108 s embedding, 807.30 MB peak RSS.
- Ingest completed in 8.371 s.
- During embedding, a cache-backed lexical-only search succeeded over 32,380
  candidates in 4.8 s.
- A separate host Cortex search completed in 1.89 s while Angular used its
  four-core quota.
- Same pinned Angular quality workspace, current runtime, Recall@10:
  lexical+graph without embeddings 25/42 (59.5%); complete hybrid 27/42
  (64.3%).

The coverage comparison establishes design feasibility but is not an exact
MiniLM endpoint comparison because bootstrapbench removed the completed
container/index after stats extraction.

## Prototype Sequence

1. Preserve dependency installation and ingest behavior.
2. Load and atomically publish RyuGraph immediately after ingest.
3. Emit an explicit `search_ready=lexical+graph` state and return control when
   background mode is selected.
4. Run embedding in a separately observable background process with an
   interactive resource profile.
5. Persist progress/checkpoints so interruption resumes rather than restarts.
6. Atomically publish completed embedding batches/snapshots; search must never
   consume a partially written JSONL file.
7. Expose status including total entities, completed entities, percentage,
   active profile, PID/state, and last checkpoint.
8. Run the fixed eight-query Angular pack at lexical+graph readiness and at
   10%, 25%, 50%, and 100% semantic coverage.

## Initial CLI Contract To Test

```bash
cortex bootstrap --background --profile interactive
cortex indexing status --json
cortex indexing pause
cortex indexing resume
```

The exact command spelling may be adjusted only if existing CLI routing makes
another name materially safer. MCP must not be introduced as a dependency.

## Resource Profile Under Test

Start with the measured conservative profile:

- ingest workers: 2
- embedding pool sessions: 1
- embedding thread budget: 4
- process memory ceiling in the benchmark: 4 GiB

Do not promote these fixed values as universal defaults. Record enough system
information to design a later adaptive profile.

## Owned Scope

- `scaffold/scripts/bootstrap.sh`
- the root/scaffold compatibility mirror only where packaging requires it
- `scaffold/mcp/src/embed.ts`
- `scaffold/mcp/src/embedScheduler.ts`
- focused embedding/bootstrap/status tests
- `bin/cli/` indexing/bootstrap command routing if required
- `benchmark/bootstrapbench/` only for Angular progress/coverage capture
- this packet and one ignored Angular result directory

Avoid unrelated dirty files and all WO-045/V10 artifacts.

## Correctness Requirements

- Existing foreground `cortex bootstrap` remains compatible unless the new
  behavior is explicitly selected.
- Search after early publication must clearly report incomplete semantic
  coverage; it must not claim full hybrid readiness.
- Background failure must leave the lexical+graph index usable.
- Resume must not duplicate or lose embeddings.
- Final 100% embedding output must be deterministic and quality-equivalent to
  the current foreground result for the same model/input.
- No partial file, stale manifest, or mismatched model may be reported ready.

## Angular Validation

Run only the pinned Angular repository. Capture:

- time to first successful lexical+graph search
- total completion time
- CPU and peak RSS by phase
- foreground search latency while background embedding runs
- progress checkpoint timestamps
- pause/resume correctness
- embedded/reused/failed counts
- Recall@10 and per-query lost/gained expected hits at each coverage checkpoint

## Decision Gate

Accept the prototype only if:

- Cortex becomes lexical+graph searchable before embeddings finish;
- the CLI returns control in background mode;
- the machine remains usable under the interactive profile;
- pause/resume continues from a verified checkpoint;
- final expected-hit coverage has no unexplained regression versus the complete
  foreground control;
- status makes partial semantic coverage unambiguous.

## Time And Scope Stop

- Hard implementation/evidence time-box: three working days.
- Stop after the first Angular before/after result.
- Do not add Vue, pytest, Flipt, more repositories, agent calls, or a benchmark
  platform in this work order.
- Any true query-driven lazy embedding experiment is a separate decision after
  this progressive background prototype.

## Fresh-Session Entry Point

Start a new session in `/Users/danielnilsson/GIT/cortex` with only this packet
and the direct evidence paths above. Begin with `cortex search`, `cortex rules`,
and `cortex impact`; inspect the dirty worktree before editing. Do not inherit
the long WO-045/V10 session history.

## Implementation Return

The accepted 2026-08-20 implementation and pinned Angular evidence are recorded in
`docs/agent-control/wo046-progressive-background-indexing-results.md`. The
implementation/validation gate is GO after two NO-GO remediation rounds. Final
Code Quality/Integration, Contract/Security, and Validation re-reviews are GO
with no blocker/major/minor findings. The manager accepts the prototype locally;
publication, release, and default changes remain unauthorized.
