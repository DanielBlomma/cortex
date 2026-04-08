# Compiled Memory Schema

Compiled memory articles live under `.context/memory/compiled/` as Markdown files with simple frontmatter.

## Goals

- Make project learnings retrievable without treating raw chat logs as source-of-truth.
- Keep the format manual-friendly before a full `memory compile` pipeline exists.
- Preserve enough provenance to rank memory below Rules and ADRs when they conflict.

## File Location

- `.context/memory/compiled/*.md`

Suggested filename style:

- `search-ranking-gotcha.md`
- `migration-note-auth-split.md`
- `benchmark-sql-timeouts.md`

## Required Frontmatter

```yaml
---
id: memory:search-ranking-gotcha
title: Search ranking gotcha
type: gotcha
summary: Query-seeded impact should prefer chunk hits over file hits for precise code questions.
updated_at: 2026-04-08T08:00:00Z
status: active
---
```

## Optional Frontmatter

```yaml
evidence: Query-based impact initially resolved to file:src/search.ts instead of the runContextSearch chunk.
applies_to: chunk:src/search.ts:runContextSearch:1-25, file:src/search.ts
decision_or_gotcha: Prefer chunk seeds when a chunk exists among the top lexical/semantic matches.
sources: mcp/src/search.ts, mcp/tests/server.test.mjs
freshness: current
trust_level: 72
source_of_truth: false
```

## Field Semantics

- `id`: stable identifier, prefixed with `memory:`
- `title`: human-readable memory title
- `type`: one of `decision`, `gotcha`, `fix`, `benchmark`, `migration-note`, or another explicit subtype
- `summary`: short retrieval-oriented synopsis
- `evidence`: concise factual support
- `applies_to`: comma-separated entity ids or paths
- `decision_or_gotcha`: the actionable lesson
- `sources`: comma-separated evidence sources
- `freshness`: free-form marker such as `current`, `stale`, or a date label
- `trust_level`: numeric trust hint; memory should usually stay below ADR/Rule trust
- `source_of_truth`: should normally remain `false`
- `status`: typically `active`, or `deprecated` when superseded

## Body

The Markdown body holds the fuller article text. It should explain the situation, what was learned, and when to apply the lesson.

## Compilation

Raw notes in `.context/memory/raw/*.md` can be compiled into structured articles:

```bash
cortex memory-compile              # compile all raw notes
cortex memory-compile --dry-run    # preview without writing
cortex memory-compile --verbose    # show unchanged files
```

Raw notes must include at minimum: `title`, `type`, and `summary` in frontmatter.
Invalid notes are skipped with validation errors.
Compilation is idempotent — unchanged articles are not rewritten.

## Linting

Compiled memory articles can be validated for common issues:

```bash
cortex memory-lint              # lint all compiled articles
cortex memory-lint --verbose    # show per-file detail
cortex memory-lint --json       # machine-readable output
```

Checks performed:

- **Missing provenance**: required frontmatter fields (title, type, summary, id)
- **Unknown type**: type field not in the allowed set
- **Empty body**: article has no explanatory text
- **Orphaned references**: applies_to targets or sources not found in the index
- **Unlinked memory**: no applies_to or sources — memory has no codebase link
- **Stale memory**: freshness marked stale, or updated_at older than 90 days
- **Duplicate ids**: multiple articles share the same id
- **Contradictions**: conflicting active memories on the same target (e.g. two decisions)
- **Broken supersedes**: supersedes field references a nonexistent article

Errors (missing fields, unknown type, duplicates) cause a non-zero exit code.
Warnings (orphans, staleness, contradictions) are reported but do not fail the command.

## Current Runtime Behavior

- Compiled memory articles are loaded directly from `.context/memory/compiled/`.
- They appear in `context.search` as `Memory` entities.
- `applies_to` fields generate `ABOUT` relations (memory → entity).
- `sources` fields generate `REFERENCES` relations (memory → file).
- These relations are traversable via `context.get_related` in both directions.

## Ranking Expectations

- Rules and ADRs should outrank memory on formal constraints and architectural decisions.
- Memory should rank well for history, debugging, workaround, and “have we seen this before?” questions.
