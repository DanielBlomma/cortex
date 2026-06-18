import { Binary, DownloadCloud, FileCode2, Network, Search } from "lucide-react";

import type { Stage } from "./types";

export const STAGES: readonly Stage[] = [
  {
    key: "resolve",
    label: "Resolve",
    icon: DownloadCloud,
    accent: "222 47% 45%",
    tagline: "Provision the local toolchain",
    blurb:
      "cortex bootstrap installs everything the pipeline needs — tree-sitter grammars, the ONNX embedding runtime and the RyuGraph engine — vendored under .context/ inside your repo. No services to start, nothing leaves the machine.",
    facts: ["One command", "All deps vendored", "Zero cloud calls"]
  },
  {
    key: "ingest",
    label: "Ingest",
    icon: FileCode2,
    accent: "221 83% 53%",
    tagline: "Parse source into entities",
    blurb:
      "Tree-sitter parses every file into structured entities — files, functions, classes, methods, plus rules and ADRs. Parsing fans out across a worker pool, one worker per core, so large repos index in parallel.",
    facts: ["Worker pool · ≤ 8 cores", "AST-accurate chunks", "14+ languages"]
  },
  {
    key: "embed",
    label: "Embed",
    icon: Binary,
    accent: "199 89% 48%",
    tagline: "Vectorize for semantic search",
    blurb:
      "A local sentence-transformer (all-MiniLM-L6-v2) turns each entity into a 384-dimension vector on the ONNX runtime — fully offline, no API keys. Unchanged code reuses cached vectors, so re-runs only embed what moved.",
    facts: ["all-MiniLM-L6-v2", "384 dimensions", "Offline · cache-aware"]
  },
  {
    key: "graph",
    label: "Graph",
    icon: Network,
    accent: "173 80% 36%",
    tagline: "Load the code graph",
    blurb:
      "Entities and their relations — DEFINES, CALLS, IMPORTS, CONSTRAINS, IMPLEMENTS, SUPERSEDES — bulk-load into RyuGraph, a local embedded property graph that powers fast traversal queries over the codebase.",
    facts: ["RyuGraph · embedded", "6 relation types", "Bulk COPY load"]
  },
  {
    key: "serve",
    label: "Serve",
    icon: Search,
    accent: "262 70% 56%",
    tagline: "Answer through MCP",
    blurb:
      "MCP tools answer assistant queries by fusing semantic search with graph traversal, ranked by semantic similarity, graph proximity, source-of-truth trust and recency — a compact, governed context instead of raw file dumps.",
    facts: ["context.search + graph", "4-signal ranking", "Rules enforced"]
  }
] as const;

export const CYCLE_MS = 7200;
