# WO-056: DeepSeek Harness Context Retrieval Integration — V1 to V2 Plan

**Status:** Stage 0 audited; WO-057 V1 implemented locally; independent acceptance pending
**Date:** 2026-08-27
**Requirement:** REQ-19
**Context packet:** `docs/agent-control/context-packets/055-deepseek-harness-integration.md`
**V1 implementation packet:** `docs/agent-control/context-packets/056-deepseek-harness-session-provider.md`

## Outcome

Cortex becomes an installable context-retrieval capability for DeepSeek
Harness without forking Harness or duplicating Cortex ranking logic.

- V1 delivers explicit, tool-driven Cortex retrieval plus the behavior skills
  that tell the agent when to use it.
- V2 adds opt-in proactive retrieval for the current request through a native
  Harness service and `agent/pre-step` consumer.
- V1 remains available after V2 as the transparent fallback, diagnostic, and
  user-controlled workflow.

Neither version is considered shipped merely because its documentation or
scaffold exists. Each version has a separate acceptance and release gate.

## Relationship To The Cortex Harness Roadmap

This plan integrates Cortex retrieval into **DeepSeek Harness**. It does not
replace, rename, or implement the separate Cortex execution-harness vision in
`docs/harness-vision.md`, and it does not change the Enterprise
`cortex.workflow.*` tools. The two efforts may share Cortex context contracts,
but they have different products, owners, and release gates.

## Architectural Decisions

### Keep Cortex as the retrieval engine

The integration consumes existing Cortex contracts. It does not copy search,
graph traversal, ranking, rules, or impact logic into the Harness package.

### Use Harness-native composition

The integration is an out-of-tree Cordis bundle named
`@danielblomma/dsh-cortex`. Users install it into a Harness profile:

```bash
dsh plugin --profile web add @danielblomma/dsh-cortex
```

The package declares `dsh.bundle` and contributes patch rows. No privileged
Harness core changes are required.

### Separate provider and consumers

The revised V1 uses the Harness capability-seam pattern:

```text
Cortex local index
        |
        v
ctx.cortexContext service
        |
        +--> model-facing Cortex tools
        |
        +--> bounded agent/pre-step retrieval
```

The provider owns agent-derived repository resolution, subprocess calls,
normalized errors, cancellation, future cache identity, and Cortex JSON
validation. Consumers do not spawn commands or interpret Cortex storage
directly. Tools and skills are registered in each `agent.ctx`, never in a
host-global layer.

### Preserve explicit behavior

Automatic retrieval does not replace Cortex skills. Skills remain responsible
for workflows that require judgment, including relationship exploration,
rules, impact analysis, and pattern/context review.

## Stage 0 — Freeze Compatibility And Contracts

Before runtime implementation:

- [x] Pin one exact DeepSeek Harness release or commit for the initial support
      matrix; record its Node, Cordis, MCP-client, skills, and tool API versions.
- [x] Add a small external compatibility fixture or lockfile so Harness API
      drift produces a deterministic test failure.
- [x] Freeze the V1 tool-name mapping after Harness normalizes Cortex MCP names.
- [x] Freeze the active-workspace rule: each call requires its exact Harness
      `Agent`, resolves `agent.session.header.cwd` canonically, and uses that
      directory as subprocess cwd. No fallback or public root override exists.
- [x] Freeze the failure modes: `required: false` preserves agent operation and
      bounds tool errors; `required: true` rejects that agent's first model step
      when its workspace/readiness check fails. It does not block unrelated
      workspaces in the same host.
- [x] Freeze local-only behavior. Installing packages may use the package
      registry, but retrieval, indexing, query text, source, and session data do
      not leave the host.
- [x] Record that Harness persists model-visible retrieved code in its local
      append-only session log.

Stage 0 gate: Contract and Security/Privacy reviewers approve the pinned API,
workspace identity, local-data, failure, and versioning contracts.

### Stage 0 audit result (2026-08-26)

The exact upstream pin and deterministic compatibility fixture are complete.
The original Web-profile V1 topology is NO-GO. At pinned
Harness `0.1.1-rc.2`, the official MCP client has one static plugin-instance
`cwd` and host-global tool registrations, while Web sessions have independent
immutable workspace roots. A global Cortex MCP process could therefore serve
the wrong repository to another session.

The user selected safe path 3 on 2026-08-27: bring the native, agent-scoped
provider boundary forward into V1. The bounded decision and implementation
contract are in `docs/agent-control/wo-057-deepseek-harness-session-provider.md`
and packet 056. Contract and Security/Privacy returned GO before implementation;
the local candidate and validation evidence are recorded in
`docs/agent-control/wo-057-deepseek-harness-session-provider-result.md`.

## V1 / WO-057 — Session-Scoped Tools And Behavior Bundle

### V1.1 Package and bundle

Create `plugins/dsh-cortex/` with:

- [ ] `package.json` for `@danielblomma/dsh-cortex`, including
      `dsh.bundle.patch`, exact `0.1.1-rc.2` Harness dependencies, and an exact
      package-owned Cortex dependency;
- [ ] `cordis.patch.yml` that mounts the native service provider plus scoped
      tool and skill consumers, not the official MCP client;
- [ ] a `ctx.cortexContext` service whose every operation requires `Agent` and
      `AbortSignal` and invokes the package-owned Cortex CLI through
      `ctx.subprocess`;
- [ ] per-agent `cortex_search`, `cortex_related`, `cortex_impact`, and
      `cortex_rules` tools whose schemas mirror public CLI limits;
- [ ] schemas for `required`, timeout, output caps, and termination grace;
- [ ] install, upgrade, remove, and `--dump-config` instructions.

The provider consumes `scaffold/mcp/src/cli/query.ts`'s public JSON envelope.
It must not import private retrieval code or introduce a second search
implementation. `context.reload` is absent because this topology has no
long-lived MCP graph to reload; index mutation is not exposed as a read tool.

### V1.2 Cortex skills in Harness

- [ ] Register Cortex skills through each `agent.ctx.skills` layer and the
      normal Harness skill consumer.
- [ ] Treat `plugins/cortex/skills/` as canonical. Add a deterministic sync or
      packaging step instead of maintaining divergent hand-edited copies.
- [ ] Preserve the current dispatch semantics: search before code answers,
      related for dependency exploration, rules for architecture, impact before
      risky changes, and pattern/context review before finalization.
- [ ] Never initialize a repository automatically. Missing Cortex state is
      handled by the frozen `required` policy and bounded remediation.

### V1.3 Diagnostics and lifecycle

- [ ] Surface missing index, stale index, unavailable runtime, and incompatible
      Cortex/Harness versions as bounded diagnostics with remediation commands.
- [ ] Propagate cancellation and tool timeouts through `ctx.subprocess`, with
      whole-process-tree termination and bounded stdout/stderr.
- [ ] Verify agent disposal and bundle hot-unload remove all scoped Cortex tool
      and skill registrations.
- [ ] Ensure no background bootstrap or watcher is started without explicit
      configuration; preserve current Cortex initialization behavior.

### V1.4 V1 tests

- [ ] Manifest tests validate `dsh.bundle`, patch paths, package contents, and
      synchronized Cortex versions.
- [ ] Skill tests validate frontmatter, source synchronization, and the five
      expected skills.
- [ ] Pinned Harness Web and headless fixtures install the packed bundle,
      discover four native Cortex tools, run one fixture search, then remove
      the bundle and confirm registrations disappear.
- [ ] Parity tests compare fixed native-tool and CLI responses for search,
      related, impact, and rules after removing host presentation envelopes.
- [ ] A two-repository, one-process fixture proves schema visibility, execution,
      result, retained state, and teardown never cross agent scopes.
- [ ] Negative tests cover non-Cortex workspaces, missing runtime/index,
      missing agent identity, relative/deleted/symlinked workspaces, timeouts,
      cancellation, oversized/malformed CLI output, duplicate scoped names,
      and workspace paths containing spaces.

### V1 acceptance gate

V1 is releasable only when:

- the packed bundle installs and removes cleanly on the pinned Harness version;
- all four native Cortex tools are discoverable in only the correct agent scope
  and fixture results preserve Cortex CLI semantics;
- the five behavior skills are discoverable and load their canonical bodies;
- no query or source data is sent to a new remote service;
- two-root isolation, package-owned offline execution, cancellation, timeout,
  output bounds, JSON validation, and missing-index cases pass;
- root, MCP, package, version-sync, audit, diff, Cortex pattern-evidence, and
  independent review gates pass.

V1 ships opt-in. The README changes from **planned** to **available** only in
the accepted release change.

## V2 — Native Proactive Context Retrieval

### V2.1 Extend the accepted `ctx.cortexContext`

- [ ] Reuse the accepted WO-057 service and its exact agent/workspace authority.
- [ ] Freeze a public Cortex status/index-generation contract before adding
      proactive caching; do not infer generation from private files.
- [ ] Add only the readiness/generation operations required by V2 and validate
      them with the same bounded subprocess protocol.
- [ ] Keep the V1 native tools available as the explicit control and diagnostic
      path.

### V2.2 Add bounded `agent/pre-step` retrieval

- [ ] Add configuration with default `mode: tools`; proactive retrieval requires
      explicit `mode: assistive`.
- [ ] Trigger only on the first step containing a new direct user task. Skip
      tool continuations, Cortex-generated messages, empty messages, and turns
      without new user intent.
- [ ] Build the retrieval query deterministically from the admitted direct user
      message. Model-based query rewriting remains a separate, default-off
      experiment.
- [ ] Retrieve a bounded result set with explicit maximum results, characters,
      and elapsed time. The repository rule `rule.context_budget` applies.
- [ ] Return the complete current-step message batch from `agent/pre-step` with
      one additional source-labelled Cortex evidence message. Do not call
      `agent.inject()` for context intended for the request already being
      finalized.
- [ ] Mark retrieved repository content as untrusted evidence and delimit data
      from Cortex-generated provenance so source text cannot become higher
      authority instructions.
- [ ] Include query, entity IDs, paths, index generation, truncation state, and
      applied rules in reconstructable session data without logging secrets.

### V2.3 Cache, freshness, and failure policy

- [ ] Cache only validated rendered evidence, keyed by project, generation,
      normalized query, policy, and budget.
- [ ] Invalidate when Cortex reports a different generation or when the
      configured freshness limit expires.
- [ ] Abort retrieval when the turn signal aborts; never inject a late result
      into another turn.
- [ ] In `required: false`, preserve the original admitted messages and emit one
      bounded local diagnostic. In `required: true`, reject the step with a
      stable actionable error.
- [ ] Prevent recursive retrieval caused by replay, resume, skill loading, or
      Cortex's own model-visible evidence message.

### V2.4 V2 validation

- [ ] Unit-test trigger classification, budgets, rendering, provenance,
      injection resistance, cache identity, invalidation, cancellation, replay,
      resume, and fail-open/fail-closed behavior.
- [ ] Run a pinned Harness integration fixture that proves the retrieved context
      appears in the same request and reconstructs byte-identically from the
      session log.
- [ ] Run containment tests with two indexed repositories in one process and
      prove that no result, cache entry, or session event crosses roots.
- [ ] Freeze a multi-language task set before comparing V1 tool-driven control
      with V2 assistive retrieval. Use identical model, prompts, workspaces, and
      one attempt per task.
- [ ] Measure required-evidence coverage, solved-task pass@1, file/symbol/span
      trajectory, Cortex calls, broad file-read calls, injected bytes, cache-hit
      rate, retrieval latency, and total turn latency.

### V2 acceptance gate

V2 remains opt-in unless all of the following hold:

- no control-solved task regresses and treatment improves at least one
  predeclared answer-level or required-evidence outcome;
- every model-visible Cortex block is provenance-labelled, budget-bounded, and
  exactly replayable;
- cross-repository, stale-cache, cancellation, recursive-trigger, malformed
  output, and prompt-injection negative tests pass;
- automatic retrieval never replaces or reorders the direct user message;
- the latency and context-byte distributions remain inside thresholds frozen
  from the Stage 0/V1 baseline before the paired run;
- all Contract, Security/Privacy, Integration/Code Quality, and Validation
  reviewers return GO.

Default-on promotion is a later product decision. V2 acceptance authorizes an
opt-in release only.

## Release And Documentation Sequence

1. Merge the Stage 0 and selected-architecture records with README status
   **planned**.
2. Review, implement, and accept V1 as WO-057 in a fresh work order/session.
3. Publish V1 only after explicit release authorization; update README with the
   exact install command and supported Harness version.
4. Implement V2 behind `mode: assistive` in a separate work order/session.
5. Publish V2 opt-in only after the paired answer-level gate.
6. Consider default-on behavior only from later production evidence; do not
   infer it from V2 implementation or release.

## Sources

- Cortex MCP tool registration: `scaffold/mcp/src/server.ts`
- Cortex plugin transport: `plugins/cortex/.codex-plugin/mcp.json`
- Cortex behavior source: `plugins/cortex/skills/`
- Existing behavior rationale:
  `docs/agent-control/context-packets/013-native-agent-integration.md`
- Separate Cortex execution-harness roadmap: `docs/harness-vision.md`
- DeepSeek Harness architecture:
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md>
- Harness MCP client:
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md>
- Harness skills subsystem:
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md>
- Harness bundle packaging:
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md>
- Frozen native V1 contract:
  `docs/agent-control/context-packets/056-deepseek-harness-session-provider.md`
