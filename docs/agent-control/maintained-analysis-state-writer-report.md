# WO-060 Maintained Analysis State — Trusted Writer Report

## Result

**GO for WO-060 acceptance. Bootstrap authority, CLI/MCP writing, dogfood,
generated Current State, and WO-055 remain stopped.**

WO-060 adds two internal TypeScript operations:

- `appendTrustedAnalysisObservation(...)` appends exactly one validated
  observation to an already trusted state; and
- `recoverTrustedAnalysisObservation(...)` explicitly aborts an unchanged
  pre-store transaction or completes the exact hash-bound append after the
  observation log changed.

Neither operation is registered with the CLI or MCP server. The accepted
WO-058/WO-059 read grammar, help, default community tool inventory, and exact
opt-in read inventory are unchanged.

## Transaction Contract

Append starts with `readTrustedAnalysisState` and mandatory compare-and-swap
bindings for both generation and authority-bundle SHA-256. The writer preserves
the trusted repository, task, primary subject, source-authority registry, and
code-owned rules. It constructs the observation through the workflow adapter,
derives its ID and payload hash, rejects insertion before the committed prefix,
builds a new authority manifest, and validates the complete candidate through
the accepted evaluator before mutation.

The task-local transaction uses:

- `.analysis-transaction.lock/owner.json` as its private coordinator;
- `.analysis-append.intent.json` as a canonical, self-hashed `0600` intent;
  and
- `.analysis-authority.next` as the exact staged authority bytes.

The intent binds physical project/task identities, old authority bytes and
bundle, the complete candidate observation history, the appended observation,
the exact new authority bytes, and intended generation/snapshot/observation/
manifest/registry bindings. Intent and staged authority are durable before the
Stage 1 store changes. The authority file is replaced only after the new store
manifest is durable. Ordinary readers reject any incomplete transaction and
never repair it.

Recovery revalidates every intent, filesystem, authority, registry,
observation, evaluator, and store binding. It removes an intent only when the
old store is still exact; otherwise it reuses Stage 1 recovery and commits the
new authority. Only recovery may reclaim a strictly validated coordinator
whose recorded PID has exited.

## Measured Binding Transition

The deterministic focused fixture produced:

| Binding | Before | After |
| --- | --- | --- |
| Generation / observations | `1` / `1` | `2` / `2` |
| Snapshot SHA-256 | `4a68a0914fb5fc83971e51b98ea93c8f1e313cb3318af3d9628e2408c0c4e054` | `7660dc1d98d671c2e047d357f2031329653b2a6f82de858339701dde348bd991` |
| Observation head SHA-256 | `b757a7ca13da4ba27c4722c6bbbe46135bf8b530cd53f9d51d98eed8ea92ac6c` | `dea8c8a714b19c6dab9d605cbb0c385505d7efb1383283841d5aab701a4f0fda` |
| Authority bundle SHA-256 | `ce9814ed0cd8aa21761134c47a86b4649643181098b32cba0829499e55e35d96` | `16ffdbc871e1447343a4b158731d06e5f8801506b6244c4453f317bc34f5507a` |
| Authority manifest SHA-256 | `0042db6fd6a74ac522c9c6d6ba881deeb87b1e33ba9b3e2a9bbb8183231804e4` | `835867a292bd61900568028d9845fb5e956a0b7db1e177b8a98921b97b2c1a59` |
| Source registry SHA-256 | `cca096a23a9ba6a2f774ce613d3c8b55d1d9f12033b3c8dc8f652eb733fb9365` | unchanged |

The appended observation ID is
`obs:0d3f2e693492dba35f66cb91a603f384bee087728dc628903de714ed17e86505`.
Fresh CLI and fresh opt-in MCP reads returned the same generation, snapshot,
changes, and authority/store bindings.

## Validation Evidence

- Focused writer suite: 8/8. It covers eight mutation/failure boundaries,
  eight preflight-negative classes with full identity neutrality, ten repeated
  two-writer races, fresh CLI/MCP parity, old-state abort, partial/new-state
  completion, links, FIFO, socket, directory, mode, staged-file tamper,
  cross-root replay, ancestor replacement, live/exited locks, and authority
  replacement.
- Accepted Stage 0 suite: 19/19 against the benchmark oracle and 19/19 against
  the native engine. Stage 1 store/reader/workflow focused regressions pass.
- Full MCP suite: 627/627, zero skipped. Full root gate: 81/81 context
  regressions and 400/400 Node tests.
- Ownership: 17/17. Immutable v5 adds exactly source, dist, and test for the
  writer: 417 managed paths and 96 runtime paths.
- Package: 457 entries, 436 mode `0644`, 21 mode `0755`, inventory SHA-256
  `82416cb8c7be5968e2bb3368e19f024a4bee6cb536d09ef3f8209d57180ab26b`.
  Packed containment is 42/42, characterization 3/3, and development/packed
  dashboard 4/4 each. Forced upgrade verifies 104 changed managed files and 37
  additions.
- TypeScript, `git diff --check`, Cortex update, rules, and impact pass. All
  changed code/test/ownership paths are outside configured Cortex source paths,
  so per-file pattern evidence correctly reports them unindexed. The local
  diff reviewer observed all seven pre-report files and emitted zero findings
  and zero conflicts.

## Combined Core/Contract/Security/Validation Review

**GO with zero remaining findings.** The combined pass checked single semantic
authority, CAS behavior, append-only order, reader fail-closed behavior,
transaction durability, recovery classification, filesystem containment,
bounded/canonical bytes, concurrency, public inventory stability, ownership,
package contents, and every Packet 074 non-goal.

During the pass, directory identity was strengthened from intent-only binding
to repeated root/`.agents`/task inode verification before every mutation and
recovery commit. A transient lock-owner close race was also normalized to the
required stale-CAS loser; ten consecutive two-process races then produced one
commit and one stale loser each. No finding remains accepted or waived.

The remaining bootstrap risk is intentional: WO-060 cannot create the first
authority bundle or source registry. A trusted initial state must still be
provisioned outside this API before any append is possible. No CLI/MCP writer,
workflow auto-emission, dogfood mutation, generated manager/handoff/Current
State prose, dependency, network/model/provider/database change, release, or
WO-055 work was added.
