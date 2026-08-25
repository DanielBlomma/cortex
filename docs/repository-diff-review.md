# Deterministic diff review

`cortex review --diff --json` reviews the current Git candidate against
`HEAD`: staged and unstaged tracked changes plus non-ignored untracked regular
files. The text form is `cortex review --diff`. No revision or arbitrary path
form exists in schema version 1.

The generator is `repo-diff-review-v1`. Output contains only bounded,
repository-relative paths, repository identity, canonical diff and review
hashes, changed-file summaries, findings, conflicts, diagnostics, and exact
limit/count accounting. It never includes raw repository roots, Git loader
details, raw warnings, ignored content, or absolute paths.

## Evidence and enforcement

Every eligible changed code file is mapped to the closest canonical convention
profile. Selection prefers applicable subsystem authority, the same indexed
file, its directory/module, its feature or graph-connected subsystem, and then
repository fallback. Cited records come from the existing local pattern-
evidence engine and canonical convention-profile evidence.

Findings are explicitly classified:

- `deterministic` requires an exact active source-of-truth Rule or ADR. Version
  1 recognizes exact `convention:review.forbid.<category> = literal:<text>`
  claims; an exact active conflict suppresses the recommendation.
- `heuristic` covers duplicate-helper similarity, reusable-abstraction
  proximity, and local error, logging, configuration, or testing pattern
  mismatch. Heuristic findings never turn the command into policy failure.

The command is local and inspection-only. It does not call search embeddings,
models, planners, providers, telemetry, network, fetch, or Enterprise review,
and it does not persist profiles, index data, configuration, caches, logs, or
Git state.

## Version 1 limits

- changed paths: 200
- total canonical diff input: 1,000,000 UTF-8 bytes
- per-file diff input: 250,000 UTF-8 bytes
- findings: 100
- conflicts: 50
- evidence per finding or conflict: 10
- public JSON response: 1,000,000 UTF-8 bytes
- public text response: 250,000 UTF-8 bytes

Pre-readable path and byte boundaries fail before context/profile work. Valid
bounded findings and conflicts use observed, retained, and omitted counts.
