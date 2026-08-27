# WO-057 DeepSeek Harness Session-Scoped Provider Result

**Date:** 2026-08-27

**Status:** implementation complete; independent final acceptance review pending

**Harness:** `0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

**Bundle:** `@danielblomma/dsh-cortex@2.5.2`

## Gate Decision

Contract and Security/Privacy reviewed packet 056 before any runtime file was
added. Both returned GO. The complete evidence and frozen implementation
conditions are in
`docs/agent-control/wo-057-deepseek-harness-contract-security-review.md`.

## Implemented Boundary

- `plugins/dsh-cortex/` is an installable Harness bundle with exact Cortex and
  pinned Harness dependencies plus one three-layer Cordis patch.
- `ctx.cortexContext` resolves only the direct package-owned Cortex CLI entry,
  runs it through `ctx.subprocess`, and selects the repository only from the
  exact calling agent's canonical `session.header.cwd`.
- Four agent-scoped read tools expose search, related, impact, and rules. No
  model-facing or bundle setting can select a root, executable, shell, PATH
  command, bootstrap, update, watcher, or remote transport.
- Five canonical Cortex behavior skills are packaged byte-for-byte and mounted
  per agent. Agent and plugin disposal unwind tools, skills, and readiness.
- Runtime execution is capped at 15 seconds, 1 second termination grace,
  2 MiB stdout, 64 KiB stderr, and 8 KiB inputs. Success and failure envelopes
  are bounded and validated; child output and diagnostics are never echoed by
  normalized failures.
- `required: false` remains the default. `required: true` performs only an
  agent-local read-only readiness check before that agent's first step.

## Validation Evidence

- Frozen Harness drift: 18/18 files; compatibility: 5/5.
- Provider contract: 9/9; real Harness integration: 4/4, including actual
  four-command package CLI retrieval, process-tree timeout, caller cancellation, and
  same-name agent-scope isolation/teardown.
- One concurrent provider run against the indexed Cortex and data-platform
  repositories returned only their distinct expected paths
  (`docs/agent-control/...deepseek-harness...` versus
  `src/data-sources/data_sources/github/collect.py`).
- Retrieval also passed inside a macOS network-denying sandbox with
  `PATH=/nonexistent`, proving package-owned execution without PATH or registry
  access.
- Final root gate: context regressions 81/81, Node tests 402/402, then Harness
  plugin integration 4/4. MCP gate: 426/426.
- Version synchronization and `git diff --check` pass. The five normal
  dependency trees plus the new plugin lockfile each audit at zero findings.
- The final tarball contains exactly 12 declared files, 10.1 kB packed and
  35.6 kB unpacked. SHA-1 is
  `7f65792f6d5019c840904a043d47f77b0e3be3ba`; SHA-256 is
  `3309eb1ec3088f8a7a70518c2d9580c61596238c115ef2588d0a6e7d3f0bc0f7`.
- Fresh pinned headless and Web profiles installed and upgraded the final
  tarball with no peer issues and exactly three Cortex config rows. Headless
  help loaded, Web returned HTTP 200, and removal cleared all Cortex rows from
  both profiles.

## Review Outcome

- Contract: GO.
- Security/Privacy: GO.
- Local Integration/Code Quality pass: GO, no findings.
- Local Validation/Ops pass: GO, no findings. One test-only startup race found
  during the first full run was fixed by awaiting a child start marker and
  giving the process-tree timeout fixture a deterministic two-second window;
  the complete gate then passed.

The implementation candidate is ready for the repository's independent final
acceptance reviews. This record does not claim that independence, authorize
publication, change README status from `planned`, or authorize V2 proactive
retrieval.
