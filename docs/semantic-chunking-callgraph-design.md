# Semantic Chunking + Call Graph Design

**Feature Branch:** `feature/semantic-chunking-callgraph`  
**Goal:** Improve Cortex code understanding by chunking files at function/method level and tracking call relationships.

## Problem

Current Cortex indexes entire files as atomic units. This has limitations:

1. **Coarse granularity** — search returns whole files instead of specific functions
2. **No call tracking** — can't answer "what calls this?" or "what does this call?"
3. **Context bloat** — entire 2000-line file loaded when only 1 function is relevant
4. **Weak impact analysis** — can't trace cascading effects of a change

## Solution

### 1. Semantic Chunking

Break code files into **function/method-level chunks**:
- Each chunk = one function/method/class with its signature, docstring, and body
- Chunks are searchable entities (like Files/Rules/ADRs)
- Chunks link back to parent File for provenance

### 2. Call Graph

Track **function call relationships**:
- Parse AST to extract which functions call which other functions
- Store as `CALLS` relationships in the graph
- Enable queries like "find all callers of X" and "trace execution path from A to B"

## Graph Schema Changes

### New Node Types

```cypher
CREATE NODE TABLE IF NOT EXISTS Chunk(
  id STRING,              -- "chunk:path/to/file.ts:functionName"
  file_id STRING,         -- parent file id
  name STRING,            -- function/method/class name
  kind STRING,            -- "function" | "method" | "class" | "const"
  signature STRING,       -- function signature (params, return type)
  body STRING,            -- function body (code)
  start_line INT64,       -- line number where chunk starts
  end_line INT64,         -- line number where chunk ends
  language STRING,        -- "typescript" | "python" | "javascript" etc
  checksum STRING,        -- hash of chunk content
  updated_at STRING,      -- ISO timestamp
  trust_level INT64,      -- inherited from parent File
  PRIMARY KEY(id)
);
```

### New Relationship Types

```cypher
CREATE REL TABLE IF NOT EXISTS DEFINES(FROM File TO Chunk);
CREATE REL TABLE IF NOT EXISTS CALLS(FROM Chunk TO Chunk, call_type STRING);
CREATE REL TABLE IF NOT EXISTS IMPORTS(FROM Chunk TO File, import_name STRING);
```

**Rationale:**
- `DEFINES` = file contains chunk (1:N relationship)
- `CALLS` = function A calls function B (call_type: "direct" | "async" | "callback")
- `IMPORTS` = chunk imports from another file (for cross-file call resolution)

## Implementation Plan

### Phase 1: AST Parsing + Chunking

**Files to modify:**
- `scaffold/scripts/ingest.mjs` — add chunk extraction after file ingestion
- `scaffold/scripts/parsers/` — new directory for language-specific AST parsers

**Parsers to implement:**
1. **TypeScript/JavaScript** — use `@typescript-eslint/parser` or `acorn` 
2. **Python** — use built-in `ast` module via child process
3. **Go** — use `go/ast` via child process (if Go is installed)

**Parser interface:**
```javascript
{
  chunks: [
    {
      name: "functionName",
      kind: "function",
      signature: "functionName(param: string): Promise<void>",
      body: "...",
      startLine: 42,
      endLine: 58,
      calls: ["otherFunction", "thirdFunction"],
      imports: ["./module"]
    }
  ]
}
```

### Phase 2: Graph Loading

**Files to modify:**
- `.context/ontology.cypher` — add Chunk, DEFINES, CALLS, IMPORTS
- `scaffold/scripts/load-ryu.sh` — import chunk TSVs

**TSV outputs:**
- `entities.chunk.jsonl` — all chunks
- `relations.defines.tsv` — file→chunk links
- `relations.calls.tsv` — chunk→chunk call edges
- `relations.imports.tsv` — chunk→file import edges

### Phase 3: Search Integration

**Files to modify:**
- `mcp/src/search.ts` — extend search to include Chunk entities
- `mcp/src/embeddings.ts` — embed chunk bodies

**Ranking adjustments:**
- Chunks inherit trust_level from parent File
- Recency = parent File's updated_at (chunks don't have independent timestamps)
- Graph score bonus for high-degree chunks (many callers = important)

### Phase 4: MCP Tool Updates

**New MCP tools:**
1. `cortex_trace_calls` — "what does this function call?"
2. `cortex_find_callers` — "what calls this function?"
3. `cortex_impact_analysis` — "if I change X, what breaks?"

**Updated tools:**
- `cortex_search` — now returns chunks when more relevant than files
- `cortex_get_context` — includes related chunks via call graph

## Example: TrafficQualityReportService

**Before (file-level):**
```cypher
MATCH (f:File {path: "Main.vb"})
RETURN f.excerpt
// Returns: "1947 lines of Main.vb..."
```

**After (chunk-level):**
```cypher
MATCH (c:Chunk {name: "QualityMail.SendReport"})
RETURN c.signature, c.body

// Returns just the SendReport method

MATCH (c:Chunk {name: "QualityMail.SendReport"})-[:CALLS]->(called:Chunk)
RETURN called.name

// Returns: ["ReportRepository.New", "Html.CreateReport", "SendMail"]
```

**Impact analysis:**
```cypher
// "What breaks if I change ReportItem?"
MATCH (target:Chunk)-[:CALLS*1..3]->(item:Chunk {name: "ReportItem"})
RETURN target.name, target.file_id
// Returns all functions within 3 hops that depend on ReportItem
```

## Testing Strategy

1. **Unit tests:**
   - Parser correctness (TS/JS/Python)
   - Call extraction accuracy
   - Chunk deduplication (same function, different versions)

2. **Integration test:**
   - Ingest Cortex repo itself
   - Verify chunks created for all .ts/.mjs files
   - Check call graph completeness (e.g., `search.ts` calls `embeddings.ts`)

3. **Benchmark:**
   - Re-run TrafficQualityReportService benchmark with chunking enabled
   - Target: +2-3 points on Tasks 2, 3, 7 (data flow, impact, refactoring)

## Migration Path

**Backward compatibility:**
- Old queries still work (File entities unchanged)
- Chunks are additive (new entity type)
- Flag to disable chunking: `chunk_code: false` in `.context/config.yaml`

**Performance:**
- Chunk count = ~5-10x file count (expect 100 files → 500-1000 chunks)
- Graph size increases but RyuGraph handles 10k+ nodes easily
- Embedding time increases but embeddings are cached

## Success Metrics

1. **Chunk coverage:** >80% of code functions extracted
2. **Call graph accuracy:** >90% precision on "what calls X" queries
3. **Benchmark improvement:** +2-3 points on comprehension tasks
4. **Query relevance:** Search returns correct function instead of whole file ≥75% of time

## Open Questions

1. **Nested functions?** — Initial impl: skip nested, only top-level functions
2. **Anonymous functions?** — Generate synthetic names like `<anonymous:line42>`
3. **Large functions (500+ lines)?** — Keep as single chunk, flag with `large: true`
4. **Cross-language calls?** — Initially: only track calls within same file. Phase 2: cross-file via imports.

## Timeline

- **Week 1:** AST parsers + chunk extraction (TS/JS/Python)
- **Week 2:** Graph schema + loading
- **Week 3:** Search integration + MCP tools
- **Week 4:** Testing + benchmark + docs

---

**Status:** Design phase  
**Next step:** Implement TypeScript/JavaScript parser
