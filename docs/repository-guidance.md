# Pre-Coding Guidance

`cortex guidance <path-or-entity> --task <text> --json` returns deterministic,
local-only context before a coding task. It is cited additive context, not
policy authority. Agents must still honor explicit active rules and conflicts
and may use normal `search`, `related`, and `impact` for broader investigation.

## Version 1 contract

The schema version is `1` and the generator version is `repo-guidance-v1`.
Exactly one code-backed target and one nonempty `--task` value are required.
Unknown or repeated flags, missing flag values, positional surplus, malformed
targets, and unsafe visible text are rejected before context loading. Public
JSON is byte-exact pretty JSON with one trailing newline. JSON and text never
contain the raw task; successful output contains the SHA-256 `task_hash`.
Errors are versioned, bounded, sanitized envelopes and do not expose source
content, absolute paths, loader details, task text, secrets, or link targets.

Version-1 limits are:

- task: 4,096 Unicode scalar values and 16,384 UTF-8 bytes;
- public JSON or text response: 65,536 UTF-8 bytes including its trailing newline;
- active governing rules: 8;
- reusable symbols: 12;
- concrete examples: 6;
- conflicts: 10;
- retained evidence per rule, symbol, example, or conflict claim: 10, the accepted convention evidence cap;
- normalized task terms used for scoring: 32.

The target is positional only; `--target`, mixed target forms, and aliases are
rejected. Paths and File, Chunk, Module, Project, Rule, and ADR IDs use one
exact type-specific canonical grammar. Absolute and drive forms, backslashes,
parent or dot segments, repeated or trailing separators, empty suffixes, and
malformed chunk ranges are rejected before the runtime or context is read.

Every capped section reports exact `observed_count` and `omitted_count` values
after canonical ranking. Every item reports `evidence_observed_count`,
`evidence_omitted`, and a canonically ordered `evidence` array retaining line
and graph-relation provenance. Each conflict also reports exact claim counts.
A representative caller or test includes its `reusable_symbol_id` and an
accepted `CALLS` or `IMPORTS` relation whose endpoints bind that example to the
symbol. Those relation records are derived by guidance directly from canonical
`ContextData.relations`; the accepted convention profile keeps its citation-only
representative evidence and byte-identical profile hash. The matched-term union
cannot exceed either the observed normalized term count or the 32 retained
scoring terms.
A response that would cross the byte limit fails before output; guidance never
persists state.

## Evidence and selection

Guidance recomputes the accepted canonical convention profiles from current
`ContextData` and validates live repository backing. Persisted profile JSON is
not trusted by itself. The selected profiles are the closest language and
subsystem profiles already resolved by `cortex conventions`. A root path scope
is explicitly labeled `repository_fallback`; closer profiles otherwise win.

The response contains only:

1. applicable active source-of-truth rules and ADRs, plus all retained active conflicts;
2. task-relevant exported reusable symbols from the selected profiles;
3. concrete cited profile facts, symbols, representative callers, and tests.

Each rule, symbol, example, conflict claim, and retained evidence record binds
its declared entity type, canonical ID, path, lines, and relation to one unique
eligible indexed record with safe live backing. Cross-type collisions,
substitutions, stale identities, unsafe links, and special files fail closed.
Guidance does not convert a
frequent structural fact into a requirement. A symbol is not described as
mandatory unless an applicable active source-of-truth rule or ADR says so.
Contradictory active claims remain explicit.

## Deterministic task relevance

The task grammar version is `unicode-letters-numbers-underscore-v1`. Cortex
normalizes with Unicode NFKC and locale-independent lowercase conversion,
extracts only Unicode letters, numbers, and underscore, removes this fixed
`repo-guidance-stop-words-v1` set, deduplicates, sorts, and then caps terms:

`a an and as at be before by do for from in into is it of on or the this to with`

Only these public item fields are used for guidance relevance: rule `title` and
`entity_id`; symbol `name`, `kind`, `role`, `signature`, and `path`; example
`label`, `entity_id`, `kind`, and nullable `reusable_symbol_id`. Exact term
matches score 100, prefix matches score 25, and each matched field scores 10.
Applicable governing evidence receives an explicit 1,000-point governing
component. Every item serializes its matched terms, integer components, total,
and reason.

The closed-schema `validateGuidanceData` check proves structural bounds,
ordering, counts, identities, evidence shape, and self-hash coherence without
having the raw task. The standalone public serializer additionally recomputes
the task hash, NFKC token set, observed/retained/omitted counts, every item’s
matched terms, exact/prefix counts, matched-field count, governing component,
score, reason, matched-term union, and fallback from the supplied raw task and
the allowlist above. Context-aware validation applies that same public check,
then independently rebuilds the entire result from current `ContextData` and
requires byte equality; this adds canonical relation, authority, identity, and
live-backing guarantees that standalone serialization cannot infer.

When no reusable symbol or example matches a retained task term, governing
evidence remains and canonical closest-profile items are labeled
`closest_profile_fallback`. No relevance is fabricated. Ties end in exact
profile and entity IDs; reversing equivalent index input order is byte-identical.

## Local-only state boundary

Guidance reads the current local graph and canonical convention evidence. It
does not call search, generate embeddings, or invoke a model, planner,
provider, fetch, telemetry, or network path. Normal `search`, `related`, and
`impact` remain separate commands that agents run as needed; their public
options, ranking, and bytes are unchanged. Guidance does not write profiles, manifests, indexes,
configuration, caches, logs, task text, or output. It is not invoked by
bootstrap, update, watch, or background indexing. Existing search/two-pass
ranking, defaults, budgets, response contracts, lifecycle ordering, and
persisted index data are unchanged.
