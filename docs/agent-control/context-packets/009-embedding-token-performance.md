# Embedding Token Performance Context Packet

## Objective

Evaluate whether Cortex can make semantic embedding faster by using repo-aware
token budgeting, compression, or truncation without sacrificing semantic
retrieval quality.

## Background

- Cortex currently defaults to `jinaai/jina-embeddings-v2-base-code`.
- The current embedding policy is quality-first: `auto` keeps the model maximum
  unless memory headroom requires a lower cap.
- Recent model work found Jina stronger than tested alternatives, so this work
  must not switch the default model.
- User concern: semantic embedding is slow on larger repositories, and a fixed
  full-context policy may do more work than needed for some repos.

## Work Profile

Exploration first. Do not implement truncation/compression until quality risk
and benchmark shape are explicit.

## Owned Scope

- `scaffold/mcp/src/embed.ts`
- `scaffold/mcp/src/embedScheduler.ts`
- `scaffold/mcp/tests/embed-entities.test.mjs`
- `scaffold/mcp/tests/embed-scheduler.test.mjs`
- `benchmark/bootstrapbench/`
- related root tests under `tests/bootstrapbench-*.test.mjs`
- docs only if a real behavior change is proposed

## Constraints

- Do not reduce semantic quality blindly.
- Do not change the default embedding model without benchmark evidence.
- Any truncation must be explicit in manifests/logs and covered by tests.
- Prefer preserving full semantic text for small and medium chunks.
- Prefer targeted compression for very large file-level records before
  truncating symbol-level chunk bodies.
- Preserve existing cache signatures or deliberately invalidate them with a
  clear signature-profile change.

## Questions For Agents

1. Where does the current embedding pipeline spend unnecessary work on large
   repos, and which inputs are safest to compress or cap?
2. What benchmark would prove we did not harm semantic quality while improving
   time/memory?
3. How should the before/after benchmark be run so the result is comparable:
   same repos, model, bootstrapbench config, cache policy, and metrics for
   embed wall time, peak RSS, entity/chunk counts, and semantic retrieval
   quality?
4. Is the current auto token policy too conservative, and if so what repo-aware
   policy can be tested safely?

## Required Before/After Benchmark

Any implementation proposal must include a before/after benchmark plan before
code changes start.

- **Before:** current quality-first Jina/default behavior on the same branch
  state used as the recorded baseline.
- **After:** one explicit experimental profile, env flag, or config change.
  Do not compare against an implicit or undocumented local change.
- **Repos:** quick set is `DanielBlomma/cortex` and `sharkdp/bat`; full
  validation adds `angular/angular` and `alibaba/fastjson2`.
- **Runtime metrics:** total bootstrap time, embedding phase time, peak RSS,
  embedded/reused/failed counts, entity counts, and chunk counts.
- **Quality metrics:** fixed query set per repo, top-k overlap, rank movement,
  expected files/entities found, and manual review of every lost expected hit.
- **Pass/fail gate:** accept only if the after run gives a material runtime or
  memory win without losing expected top-5 semantic results. Blind truncation
  that speeds up embedding but weakens retrieval is a failure.

## Semantic Query Packs

Semantic quality queries are stored in
`benchmark/bootstrapbench/query-packs/semantic-quality-v1/`.

- `manifest.json` records the pack version, repo keys, pinned SHAs, and query
  counts.
- One JSONL file per repo contains 8 English, task-like queries with expected
  hits and rationale.
- Query files currently have `review_status=agent_drafted`; they are suitable
  for exploratory before/after comparison, and expected hits should be reviewed
  against baseline results before failures become a hard release gate.
- The same query pack must be used for before and after. Do not tune after
  queries to the new embedding behavior.

## Current Baseline Evidence

Run id: `semantic-quality-quick-baseline-20260623`.

- Cortex pinned workspace was bootstrapped with the query-pack source paths
  added to `.context/config.yaml` because the default detected source paths
  excluded `scaffold/mcp/src`, which made the Cortex query pack measure
  source-path coverage instead of retrieval quality.
- Original Cortex query-pack baseline: 8/8 queries executed, 7/39 expected
  hits found in top 10. Later calibration showed this was not an honest
  absolute quality score: 21/39 expected hits pointed at files that were not in
  the pinned workspace index, mostly `scripts/...` paths that should have been
  `scaffold/scripts/...`.
- Calibrated Cortex baseline run:
  `semantic-quality-cortex-calibrated-baseline-20260624`. The pinned workspace
  source paths now include `scaffold/scripts`, Cortex expected hits were
  updated to paths that exist in the pinned repo, and symbol-level hits were
  kept only where the pinned cache has matching chunks. Validation found
  35 expected hits total, 0 missing expected files, and 0 missing expected
  symbols. The calibrated baseline indexed 229 files, 1,163 chunks, and 1,423
  embedding entities. Query-pack result: 15/35 expected hits found in top 10.
  The remaining 20 misses are now retrieval/ranking misses, not broken
  expected paths.
- `sharkdp/bat` default quality-first Jina embed was killed by the OS during
  embedding, leaving lexical-only search. This is a memory/preflight finding,
  not a semantic-quality pass.
- `sharkdp/bat` capped-control baseline with
  `CORTEX_EMBED_MAX_TOKENS=2048 CORTEX_EMBED_THREADS=4` succeeded with
  2250 embeddings and 0 failed. Query-pack baseline: 8/8 queries executed,
  25/40 expected hits found in top 10.
- Raw ignored artifacts are under
  `benchmark/bootstrapbench/results/semantic-quality-quick-baseline-20260623/`.

## Compact Files After Evidence

Run id: `semantic-quality-quick-compact-files-reviewfix-20260624`.

- Implemented `CORTEX_EMBED_TEXT_PROFILE=compact-files` as an explicit,
  opt-in file-level text profile. Default embedding text remains `full`.
- The compact profile only changes large `File` embedding records. Chunk
  embedding text stays full. Cache signatures are per-entity: non-file records
  keep the default token-cap signature, while file records include
  `text_profile=compact-files`, `compact_files_v1`, threshold, target, and
  token cap when present.
- Cortex after run used the same pinned workspace and source paths as the
  baseline, then re-ran full bootstrap to avoid stale or scaffold-copied cache
  artifacts. It indexed 175 files, 789 chunks, and 988 embedding entities.
  Compact profile compressed 5/175 file entities, saved 144,422 text chars,
  embedded 819, reused 169, failed 0.
- Cortex query-pack after result on the original uncalibrated pack: 8/8
  queries executed, 7/39 expected hits found in top 10. Per-hit diff against
  the original baseline: lost 0, gained 0. Because the Cortex pack is now
  calibrated, rerun compact-files against
  `semantic-quality-cortex-calibrated-baseline-20260624` before using Cortex as
  a hard no-regression gate.
- `sharkdp/bat` after run used the same capped-control policy as baseline:
  `CORTEX_EMBED_MAX_TOKENS=2048 CORTEX_EMBED_THREADS=4` plus
  `CORTEX_EMBED_TEXT_PROFILE=compact-files`. It indexed 421 files, 1,785
  chunks, and 2,250 embedding entities. Compact profile compressed 12/421 file
  entities, saved 423,748 text chars, embedded 1,830, reused 420, failed 0.
- `sharkdp/bat` query-pack after result: 8/8 queries executed, 25/40 expected
  hits found in top 10. Per-hit diff against baseline: lost 0, gained 0.
- Raw ignored artifacts are under
  `benchmark/bootstrapbench/results/semantic-quality-quick-compact-files-reviewfix-20260624/`.
- Remaining validation gap after this quick gate: fastjson2 should still be
  run before promoting compact-files beyond an explicit experimental profile.

## Angular Follow-Up Evidence

Pinned repo: `angular/angular@71bb19d772aa77a30922fb896f775b58a0862c36`.

Source paths were intentionally narrowed to the semantic query-pack surface,
not the broad Angular bootstrapbench default:

- `packages/compiler-cli`
- `packages/core`
- `packages/compiler`
- `packages/router`
- `packages/platform-browser`
- `README.md`

Uncapped quality-first run ids:

- Baseline: `semantic-quality-angular-baseline-20260624`
- After: `semantic-quality-angular-compact-files-20260624`

Uncapped baseline indexed 4,261 files, 11,657 chunks, and 16,314 embedding
entities, then `node dist/embed.js` was killed by the OS while embedding
15,841 unique texts at `max_tokens<=8192`. Cortex completed with lexical-only
fallback. Query-pack result: 17/42 expected hits in top 10.

Uncapped compact-files after run succeeded with Jina at `max_tokens<=8192`:
16,314/16,314 embeddings, failed 0, compacted 142/4,261 file entities, and
saved 4,665,248 chars. Bootstrap wall time was 2,742.52s and peak RSS reported
by `/usr/bin/time -l` was 45,682,098,176 bytes. Query-pack result was 19/42
expected hits, but this is not a clean semantic before/after because the
baseline was lexical-only.

Capped-control run ids:

- Baseline: `semantic-quality-angular-2048-baseline-20260624`
- After: `semantic-quality-angular-2048-compact-files-20260624`

Both capped-control runs used `CORTEX_EMBED_MAX_TOKENS=2048`. Baseline
embedded 16,314 records, reused 0, failed 0, with 1,386.93s bootstrap wall time
and 14,128,316,416 bytes peak RSS. Compact-files after embedded 4,266 records,
reused 12,048, failed 0, compacted the same 142 file entities, and saved the
same 4,665,248 chars; wall time was 920.22s and peak RSS was
13,161,365,504 bytes.

Capped-control query-pack result: baseline 20/42 expected hits, after 20/42
expected hits, lost 0, gained 0. Only two expected-hit ranks moved, both by one
position inside top 10:

- `angular-semantic-002`
  `packages/compiler-cli/src/ngtsc/annotations/component/src/handler.ts`
  rank 8 -> 9.
- `angular-semantic-005`
  `packages/router/src/navigation_canceling_error.ts` rank 2 -> 3.

Interpretation: `compact-files` did not reduce Angular semantic quality in the
2048-token capped-control gate and can make the 8192-token run survive where
the full baseline was killed. It is still too slow as a standalone default
performance fix for Angular; auto-degrade/preflight and throughput work remain
the likely next improvements.

## Acceptance For Planning

- Recommendation separates safe quick wins from risky quality-sensitive
  changes.
- Proposed implementation includes focused tests plus a before/after quality
  and performance benchmark plan; no implementation starts until the baseline
  command, after-change command, repo set, metrics, and pass/fail thresholds
  are written down.
- Manager can decide whether to implement immediately, benchmark first, or
  leave behavior unchanged.
