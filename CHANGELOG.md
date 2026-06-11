# Changelog

## 2.1.0 — 2026-06-11

New features and behavior changes, no API breaks.

### Changed

- **Default embedding model is now `jinaai/jina-embeddings-v2-base-code`**
  (was `Xenova/all-MiniLM-L6-v2`). The old model truncated input at 512
  tokens, which clipped the majority of file-level embeddings in typical
  repositories and made code-oriented queries miss implementation files.
  The jina code model has an 8192-token window. Override with
  `CORTEX_EMBED_MODEL` as before.
- **Embedding input text is no longer character-capped.** The previous
  7000-char entity cap and 2000-char chunk-body preview (and the
  `CORTEX_EMBED_MAX_CHARS` env var) were calibrated for small models. The
  tokenizer's own 8192-token truncation is now the only limit.
  `CORTEX_EMBED_MAX_CHARS` is removed and silently ignored if set.
- **`graph_score` now uses a midrank percentile of relation degree within
  the entity's own type** instead of `min(1, degree/4)`, which saturated at
  degree >= 4 and made the graph ranking weight a constant for nearly every
  entity. Percentiles are type-neutral (every type averages ~0.5), so
  hub-heavy types such as rules cannot drown out leaf code.
- **Default ranking weights changed** to `semantic: 0.55, graph: 0.10,
  trust: 0.20, recency: 0.15` (was `0.40 / 0.25 / 0.20 / 0.15`). Graph
  degree mostly measures how many rules constrain an entity, so it gets low
  weight; this reweighting and the percentile graph_score were benchmarked
  as a pair. **Existing projects keep their per-project `config.yaml` —
  ranking weights are NOT updated automatically.** To adopt the new
  defaults, edit `.context/config.yaml`:

  ```yaml
  ranking:
    semantic: 0.55
    graph: 0.10
    trust: 0.20
    recency: 0.15
  ```

### Added

- **Markdown chunking.** `.md`/`.mdx` files are now chunked into H1–H3
  heading-bounded sections (headings inside fenced code blocks are ignored,
  preamble before the first heading is captured, empty sections are
  skipped). Long sections are window-split with overlap, so prose gets
  overlap while code stays symbol-chunked without it. Queries that target a
  specific document section now return that section chunk directly.
- `rules.yaml` is now preserved on re-scaffold (`cortex init --force`),
  alongside `config.yaml`, so project-specific rules survive upgrades.

### Upgrading an existing project

1. `npm i -g @danielblomma/cortex-mcp@2.1.0`
2. In the project: `cortex init --force` (re-scaffolds `.context/mcp` and
   `.context/scripts`; your `config.yaml`, `rules.yaml`, notes and
   decisions are preserved), then `cortex bootstrap`.
3. `cortex update` — the stored embedding-model id no longer matches, so
   this triggers a **full re-embed automatically**. Cost: roughly 2 minutes
   per 1000 entities plus a one-time download of the jina ONNX model. The
   embeddings file grows (768-dim vectors vs 384).
4. Restart the MCP server (e.g. restart your editor/agent session) — the
   compiled search code only loads on process start.

Known quirk: the MCP server lazy-loads the embeddings file, so the first
search immediately after a re-embed can be served from a stale cache —
re-run the query.

## 2.0.19 and earlier

See git history (`git log --oneline`) and GitHub releases.
