# Chunk Retrieval And Memory Plan

## Purpose

This document captures the implementation plan for two related Cortex improvements:

1. chunk-aware retrieval
2. compiled project memory

The intent is to make Cortex more precise on code-level questions without losing surrounding context, and to make past fixes, decisions, and gotchas retrievable as durable project knowledge.

## Guiding Rules

- Source-of-truth entities must outrank derived memory.
- Deprecated content stays excluded unless explicitly requested.
- Conflicts should be surfaced, not guessed away.
- Runtime context must stay within a strict context budget.

## Problem Statement

Cortex already extracts chunks and call graph data during ingest and loads them into the graph, but the main retrieval path still focuses on Files, Rules, and ADRs.

This creates two gaps:

1. specific function-level questions often return an entire file instead of the relevant symbol
2. the system has no durable memory layer for project learnings that live in chats, PRs, commits, and debugging sessions

## Workstream A: Chunk-Aware Retrieval

### Goal

Use chunks as a finer retrieval unit without clipping away critical context.

### Key Principle

Chunks should usually be the retrieval anchor, not always the full answer.

The retrieval flow should be:

1. retrieve narrow
2. assemble broad enough

### Retrieval Contract

When a chunk is the best hit, Cortex should build a context envelope around it.

Suggested envelope:

- the winning chunk
- parent file metadata
- 1-2 nearby sibling chunks when useful
- callers and callees when relevant
- matching rules
- related ADRs when relevant

### Heuristics

Chunk should usually rank highest for:

- symbol lookup
- function-specific debugging
- targeted "where is X implemented?" questions

File, Rule, or ADR should usually rank highest for:

- broad architecture questions
- policy or constraints questions
- "how does this subsystem work?" questions

Graph expansion should be applied early for:

- impact analysis
- call flow questions
- "what breaks if we change X?" questions

### Phase A1: Retrieval Behavior Spec

Define and document:

- when Chunk may outrank File
- when File should suppress Chunk-only answers
- how chunk context envelopes are assembled
- how context budget is enforced after expansion

Deliverable:

- short design note describing ranking and assembly rules

### Phase A2: Chunk Search Integration

Update the main search pipeline so Chunk becomes a first-class search entity.

Implementation goals:

- include Chunk entities in search candidate construction
- rank on signature plus body content
- inherit trust and recency from parent file when needed
- use graph degree from chunk relations
- return chunk-specific metadata such as file id, signature, and line range

Deliverable:

- `context.search` can return Chunk results with usable surrounding metadata

### Phase A3: Chunk-Aware Related Traversal

Update related traversal so Chunk can expand to:

- parent file
- sibling chunks
- callers
- callees
- imported files
- constraining rules

Deliverable:

- `context.get_related` works for chunk ids

### Phase A4: Public Call Graph Tools

Expose call graph features already supported by the data model.

Planned tools:

- `context.find_callers`
- `context.trace_calls`
- `context.impact_analysis`

Deliverable:

- public MCP tools for caller, callee, and impact questions

### Acceptance Criteria

- function-level questions return the relevant chunk more often than the whole file
- broad questions do not collapse into isolated chunk fragments
- impact questions expand through the graph instead of returning flat lexical hits
- token usage decreases on precise questions without lowering answer quality

## Workstream B: Compiled Project Memory

### Goal

Turn raw project learnings into durable, structured, retrievable knowledge.

### What Belongs In Memory

- debugging findings
- recurring gotchas
- implementation decisions not yet formalized as ADRs
- known workarounds
- benchmark findings
- migration notes
- why a previous fix was chosen

### What Memory Is Not

- not a replacement for Rules or ADRs
- not raw chat logs as first-class retrieval output
- not a higher-trust source than source-of-truth code or policy

### Storage Model

Suggested repo layout:

- `.context/memory/raw/`
- `.context/memory/compiled/`

Raw memory holds source material such as:

- session notes
- PR summaries
- incident notes
- benchmark notes
- fix summaries

Compiled memory holds stable, structured memory articles.

### Memory Article Shape

Suggested sections:

- title
- type
- summary
- evidence
- applies_to
- decision or gotcha
- sources
- freshness

Example memory types:

- `decision`
- `gotcha`
- `fix`
- `benchmark`
- `migration-note`

### Graph Model

Add a `Memory` entity type and relations such as:

- `MEMORY_ABOUT -> File|Chunk|Rule|ADR`
- `MEMORY_SUPPORTS -> Rule|ADR`
- `MEMORY_SUPERSEDES -> Memory`
- `MEMORY_CONFLICTS_WITH -> Memory`

### Ranking Model

Expected trust order:

1. Rule / ADR
2. Memory with strong evidence and recent provenance
3. general docs
4. raw notes or uncompiled material

Memory should rank well for questions like:

- why was this done this way
- have we seen this issue before
- what usually goes wrong here

Memory should not override source-of-truth on:

- architecture constraints
- formal policy
- active technical decisions already captured in ADRs

### Phase B1: Memory Schema Spec

Define:

- markdown frontmatter or section contract
- required provenance fields
- freshness fields
- allowed memory types

Deliverable:

- memory article schema doc

### Phase B2: Compiler

Build a compiler that turns raw notes into structured memory articles.

Requirements:

- preserve provenance
- require explicit links to code or docs where possible
- prefer stable summaries over chat-like transcripts
- support superseding old memory articles

Deliverable:

- `memory compile`

### Phase B3: Linting

Add validation for:

- contradictions
- orphaned memory
- stale memory
- missing provenance
- duplicate memory articles

Deliverable:

- `memory lint`

### Phase B4: Ingest And Retrieval

Ingest compiled memory into Cortex as indexed entities.

Requirements:

- searchable through main retrieval
- linked into graph relations
- ranked below formal source-of-truth
- filtered or flagged when stale or conflicting

Deliverable:

- compiled memory participates in retrieval and graph traversal

### Acceptance Criteria

- historical fixes and decisions can be found by retrieval
- memory articles never silently override stronger sources
- stale or contradictory memory is detectable
- project learnings survive beyond a single chat or PR

## Recommended Delivery Order

1. define retrieval contract
2. implement chunk-aware search
3. implement chunk-aware related traversal
4. expose public call graph tools
5. define memory schema
6. build memory compiler
7. build memory linting
8. ingest memory into retrieval

## Benchmarking

Track three benchmark categories:

1. symbol-level precision
2. impact-analysis quality
3. historical decision and gotcha retrieval

Suggested metrics:

- chunk returned instead of whole file when question is symbol-specific
- no increase in lost-context errors
- higher quality on "what calls this" and "what breaks if this changes"
- memory articles retrieved for history and decision questions
- no memory result outranks a stronger Rule or ADR in conflicting cases

## Open Questions

- Should chunk envelopes be assembled fully in `context.search`, or should clients perform a second expansion call?
- Should Memory entities be stored in the same graph tables as other entities, or loaded from a parallel memory index first?
- How strict should freshness rules be before a memory article is hidden versus merely flagged?
- Should memory compilation be manual-only at first, or triggered from explicit workflow commands?

## Next Recommended Step

Start with Workstream A Phase A1 and A2.

Reason:

- the repo already contains chunk extraction and graph loading
- chunk-aware retrieval likely has the highest immediate ROI
- compiled memory should be built on top of a retrieval layer that already handles granularity correctly
