# Cortex v1 Architecture

## Goal
Provide high-signal, repo-local context to coding agents without bloating instruction files.

## Product Intent
Cortex should help an agent build or change features with the minimum context needed to act correctly.

The target outcome is:
- bring in existing functionality before proposing new code
- reduce the risk of rebuilding something that already exists
- keep implementation context narrow enough that prompts do not fill with unrelated files
- surface repo rules, established patterns, and nearby dependencies before generic best-practice advice

In practice, Cortex should prefer relevant evidence over more evidence. A smaller, sharper context package is better than a broad dump of files.

Engineering principle: prefer retrieval quality over analysis completeness.

## Non-Goals
- Do not maximize recall by stuffing entire subsystems into the prompt.
- Do not treat every import, file, or symbol as equally valuable context.
- Do not optimize for answering trivia about the codebase at the expense of feature-building relevance.

## Pipeline
1. Ingestion: source files -> entities + relations
2. Storage: graph (RyuGraph) + optional vector index
3. Retrieval: semantic + graph
4. Policy: rules filter conflicts/deprecated/source-of-truth
5. Assembly: runtime context package for MCP tool responses

## Runtime Context Order
1. Task
2. Hard rules
3. Evidence blocks (top_k)
4. Uncertainties

## Guardrails
- Source-of-truth must be preferred
- Deprecated content excluded by default
- Conflicts are flagged, not guessed
