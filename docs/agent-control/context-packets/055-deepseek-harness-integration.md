# DeepSeek Harness Context Retrieval Integration

## Objective

Ship Cortex as an installable DeepSeek Harness context-retrieval integration in
two independently releasable stages:

1. V1 exposes the existing Cortex retrieval surface and behavior skills through
   an opt-in Harness bundle.
2. V2 adds native, bounded, provenance-preserving retrieval before the current
   model request, while keeping V1 as the fallback and manual-control path.

Detailed plan:
`docs/superpowers/plans/2026-08-25-deepseek-harness-integration.md`.

## User Decision

- Plan the integration through V2 now.
- Document it as a visible feature in the repository README shown on GitHub.
- Do not present either version as shipped before its acceptance gate passes.

## Current Evidence

- Cortex already exposes `context.search`, `context.get_related`,
  `context.impact`, `context.get_rules`, and `context.reload` through its MCP
  server in `scaffold/mcp/src/server.ts`.
- The Cortex Codex/Claude plugin already defines the behavior layer in
  `plugins/cortex/skills/` and launches the same local package through MCP.
- Context packet 013 established that tools alone are insufficient: the skill
  and session behavior are required so agents reliably retrieve before they
  answer or change code.
- DeepSeek Harness provides an official MCP-client plugin, a `ctx.skills`
  provider/consumer seam, installable `dsh.bundle` packages, and an
  `agent/pre-step` waterfall for exact-current-request context.
- Stage 0 pinned Harness `0.1.1-rc.2` at commit
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` and froze 18 upstream API file
  hashes plus all five normalized Cortex tool names.
- Stage 0 is NO-GO for the planned Web-profile V1 bridge: the official MCP
  client has a static plugin-instance `cwd` and host-global tools, but Web
  sessions have independent immutable workspace roots. See
  `docs/agent-control/wo-056-deepseek-harness-stage0-compatibility.md`.
- The user selected safe path 3 on 2026-08-27. Native agent-scoped V1 work is
  now WO-057 under packet 056; the original official-MCP topology remains
  prohibited at the pinned Harness version.

## Work Profile

New cross-harness integration and model-visible context contract.

Owner teams: CLI and Runtime + Release and Distribution.

Required reviewers: Contract, Security/Privacy, Integration/Code Quality, and
Validation. A DeepSeek Harness compatibility review is required before each
release because Harness is in developer preview.

## Revised V1 Owned Scope (WO-057)

- a new installable bundle under `plugins/dsh-cortex/`;
- package and release metadata for `@danielblomma/dsh-cortex`;
- a native `ctx.cortexContext` service over the public Cortex CLI JSON query
  contract, executed through Harness `ctx.subprocess`;
- model-facing tools and Cortex skills registered only through each exact
  `agent.ctx` scope;
- manifest, skill-sync, install/remove, two-workspace isolation, tool-discovery,
  cancellation, output-bound, and fixture-search tests;
- README and release documentation.

## V2 Owned Scope

- extensions to the accepted V1 `ctx.cortexContext` service, including a
  separately frozen public index-generation contract;
- an opt-in `agent/pre-step` consumer for exact-current-request retrieval;
- bounded query selection, result rendering, cache/invalidation, provenance,
  cancellation, and failure policy;
- DSH session replay and prompt-injection negative tests;
- paired task-level validation against V1 tool-driven behavior.

## Non-scope

- changing Cortex ranking or indexing semantics merely to fit Harness;
- replacing or renaming the separate Cortex execution-harness roadmap in
  `docs/harness-vision.md` or the Enterprise `cortex.workflow.*` tools;
- patching the DeepSeek Harness agent loop;
- enabling proactive retrieval by default in V1;
- cloud retrieval, source upload, or remote telemetry;
- replacing the existing Codex or Claude integrations;
- publishing either package or changing defaults without a separate release
  authorization after its acceptance gate passes.

## Required Contracts

- CLI-first remains the Cortex product contract. Native V1 consumes the public
  CLI JSON query envelope and does not become a second retrieval
  implementation.
- V1 and V2 resolve the active repository from the Harness workspace and must
  never retrieve from another project.
- Retrieved repository text is untrusted evidence, never instruction authority.
- Model-visible V2 context is source-labelled, bounded, and reconstructable
  from the append-only Harness session log.
- Automatic retrieval runs only for a new direct user task, never recursively
  for its own injected context or every tool continuation.
- V2 defaults to disabled until answer-level non-regression, context-budget,
  replay, containment, cancellation, and failure-mode gates pass.

## Fresh-Session Entry Point

The topology decision is complete. Do not use this umbrella packet to start
runtime work. Start WO-057 in a fresh session using only
`docs/agent-control/context-packets/056-deepseek-harness-session-provider.md`
and its direct references. Contract and Security/Privacy must record GO before
`plugins/dsh-cortex/` is created.
