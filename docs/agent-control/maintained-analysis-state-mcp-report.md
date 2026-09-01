# WO-059 Maintained Analysis State — MCP Read Exposure Report

## Result

**GO for WO-059 acceptance. Writers, dogfood, generated Current State, and
WO-055 remain stopped.** The community MCP inventory is unchanged unless
`CORTEX_MAINTAINED_ANALYSIS_MCP` is exactly `1`. That opt-in adds only these
read operations:

- `context.analysis_state`;
- `context.analysis_why`;
- `context.analysis_why_not`;
- `context.analysis_changes`.

All four return schema version `1`, generator
`maintained-analysis-cli-v1`, command `workflow`, and the accepted WO-058
envelope in both `structuredContent` and deterministic bounded JSON text.
Domain failures set `isError` and remain closed to `INVALID_ARGS`,
`STATE_NOT_FOUND`, `AUTHORITY_INVALID`, or `STATE_UNTRUSTED`.

## Implementation

`workflow-analysis.ts` now exports one programmatic query runner, one bounded
serializer, and the existing closed error-envelope constructor. The CLI and
MCP adapter both call that runner, so replay, independent authority validation,
`primary_subject` selection, operation dispatch, bounds, and domain-error
mapping have one authority.

The MCP server advertises exact strict schemas. Its schema adapter preserves
those schemas for `tools/list` while routing SDK validation failures to the
manual closed parser; rejected values and framework diagnostics therefore
never replace the accepted public envelope. Invalid inputs are also removed
before instrumentation hooks run.

## Validation Evidence

- Focused CLI/MCP authority and stdio suite: 15/15. Two fresh enabled servers
  produce identical results; all four successes are byte-identical to fresh
  CLI JSON output. Missing-state error output is also CLI-identical.
- Read neutrality covers bytes, device/inode identity, link count, mode,
  ctime, mtime, and directory entries across the authority and Stage 1 store.
- Negative coverage includes exact feature-flag behavior, strict schemas,
  missing/extra/unknown/unsafe/traversal inputs, integer bounds, future epoch,
  unknown fact/predicate, missing and malformed authority, and wrong mode. The
  inherited WO-058 matrix continues to cover links, special files, identity
  drift, tamper, chain/snapshot corruption, and concurrent replacement.
- TypeScript build: pass. Full MCP suite: 619/619, zero skipped. Full root
  gate: 81/81 context regressions and 400/400 Node tests. CLI shim plus
  ownership: 20/20. `git diff --check`: pass.
- Package gate: 453 entries, 432 mode `0644`, 21 mode `0755`, unchanged
  inventory SHA-256
  `347bbc878e3f4d46d4daed0ad0d384f580aefff7ec7a91c824b06a82cbf8b912`.
  Ownership remains 414 managed paths and 96 runtime paths; no ownership
  manifest was added or changed. Packed containment is 42/42,
  characterization 3/3, and development/packed dashboard 4/4 each. Forced
  upgrade now measures 101 changed managed files and the same 34 additions;
  the containment expectation adds only the changed server source/dist pair.
- Cortex update completed; rules and impact checks passed.
  The changed scaffold/test paths are outside the configured index, so direct
  pattern-evidence calls correctly reported them unindexed. Proportional
  evidence passed against the indexed root workflow shim, Packet 073, and the
  accepted WO-058 report.

## Combined MCP/Contract/Security/Validation Review

**GO with zero accepted findings.** The single combined pass checked default
inventory stability, namespace separation, exact schemas, CLI/MCP parity,
SDK-error suppression, input and telemetry disclosure, authority independence,
read neutrality, bounds, package ownership, and every explicit non-goal. The
repo-local diff reviewer emitted zero findings and zero conflicts; it reported
no applicable convention profile for the four code paths, so the packet and
indexed accepted precedents supplied the manual adjudication authority.

The remaining maintenance risk is narrow and explicit: preventing the current
MCP SDK from pre-empting the closed envelope requires an adapter around its Zod
`safeParseAsync` boundary. Actual stdio schema and rejection tests pin that
behavior, so a future SDK change fails the contract suite rather than leaking
silently. The inherited Stage 1 `@ts-nocheck` risk and the deliberate absence
of a production authority writer are unchanged. No writer, dogfood mutation,
manager/handoff/Current State generation, enterprise Harness change,
dependency, release, network/model/provider/database surface, or WO-055 work
was added.
