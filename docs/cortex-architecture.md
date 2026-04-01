# Cortex v1 Architecture

## Goal
Provide high-signal, repo-local context to coding agents without bloating instruction files.

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
