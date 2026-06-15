import { useEffect, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  Binary,
  ChevronsRight,
  Cpu,
  DownloadCloud,
  FileCode2,
  type LucideIcon,
  Network,
  Search
} from "lucide-react";

import { cn } from "@/lib/utils";

type StageKey = "resolve" | "ingest" | "embed" | "graph" | "serve";

type Stage = {
  key: StageKey;
  label: string;
  icon: LucideIcon;
  /** HSL triple (no `hsl(...)` wrapper) so we can compose alpha variants. */
  accent: string;
  tagline: string;
  blurb: string;
  facts: readonly string[];
};

const STAGES: readonly Stage[] = [
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

const CYCLE_MS = 7200;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function BootstrapPipeline() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = usePrefersReducedMotion();

  // Re-arm a one-shot timer on every stage change so a manual click also gets a
  // full cycle before auto-advance resumes. Paused on hover/focus and disabled
  // entirely under reduced-motion.
  useEffect(() => {
    if (reduced || paused) return;
    const timer = setTimeout(() => {
      setActive((current) => (current + 1) % STAGES.length);
    }, CYCLE_MS);
    return () => clearTimeout(timer);
  }, [active, paused, reduced]);

  const stage = STAGES[active];
  const rootStyle = { "--accent-hsl": stage.accent } as CSSProperties;

  return (
    <div
      className="rounded-xl border bg-card p-5 shadow-sm transition-colors sm:p-6"
      style={rootStyle}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <StageRail active={active} onSelect={setActive} />

      {!reduced && !paused ? (
        <div className="mt-4 h-0.5 w-full overflow-hidden rounded-full bg-border/60">
          <div
            key={active}
            className="cortex-progress h-full rounded-full"
            style={{ background: `hsl(${stage.accent})`, animationDuration: `${CYCLE_MS}ms` }}
          />
        </div>
      ) : (
        <div className="mt-4 h-0.5 w-full rounded-full bg-border/60" />
      )}

      <div className="mt-6 grid items-stretch gap-6 md:grid-cols-[1.25fr_1fr]">
        <div className="relative min-h-[220px] overflow-hidden rounded-lg border bg-muted/30 p-4">
          <StageCanvas key={active} stageKey={stage.key} accent={stage.accent} />
        </div>
        {/* Every stage's detail is stacked in one grid cell so the panel sizes
            to the tallest stage and stays a constant height — advancing the
            timer (or clicking a stage) never reflows the page below it. */}
        <div className="grid">
          {STAGES.map((item, index) => (
            <div
              key={item.key}
              className={cn("[grid-area:1/1]", index === active ? "" : "invisible pointer-events-none")}
              aria-hidden={index !== active}
            >
              <StageDetail stage={item} index={index} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StageRail({ active, onSelect }: { active: number; onSelect: (index: number) => void }) {
  return (
    <div className="flex items-start">
      {STAGES.map((stage, index) => {
        const isActive = index === active;
        const Icon = stage.icon;
        return (
          <button
            key={stage.key}
            type="button"
            onClick={() => onSelect(index)}
            aria-pressed={isActive}
            aria-label={`Stage ${index + 1}: ${stage.label}`}
            className="group relative flex flex-1 flex-col items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* Connector to the next node, drawn behind the circles. Anchored to
                this column's center and one column wide, so it reaches exactly
                the next node's center — node centers stay evenly spaced. */}
            {index < STAGES.length - 1 ? (
              <span aria-hidden className="absolute left-1/2 top-1 z-0 flex h-11 w-full items-center">
                <span className="cortex-track h-0.5 w-full rounded-full bg-border">
                  <span className="cortex-track-dot absolute inset-y-0 left-0 w-8 rounded-full bg-gradient-to-r from-transparent via-foreground/50 to-transparent" />
                </span>
              </span>
            ) : null}
            <span
              className={cn(
                "relative z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 bg-card transition-all duration-300",
                isActive ? "scale-110" : "border-border text-muted-foreground group-hover:text-foreground"
              )}
              style={
                isActive
                  ? {
                      borderColor: `hsl(${stage.accent})`,
                      color: `hsl(${stage.accent})`,
                      background: `hsl(${stage.accent} / 0.08)`,
                      boxShadow: `0 0 0 4px hsl(${stage.accent} / 0.12)`
                    }
                  : undefined
              }
            >
              <Icon className="h-5 w-5" />
              <span
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold text-primary-foreground"
                style={{ background: isActive ? `hsl(${stage.accent})` : "hsl(var(--muted-foreground))" }}
              >
                {index + 1}
              </span>
            </span>
            <span
              className={cn(
                "text-center text-xs font-medium transition-colors",
                isActive ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {stage.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function StageDetail({ stage, index }: { stage: Stage; index: number }) {
  return (
    <div className="flex flex-col justify-center gap-3">
      <div className="flex items-center gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ background: `hsl(${stage.accent} / 0.12)`, color: `hsl(${stage.accent})` }}
        >
          Step {index + 1} / {STAGES.length}
        </span>
        <span className="text-xs text-muted-foreground">{stage.tagline}</span>
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{stage.label}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{stage.blurb}</p>
      <div className="flex flex-wrap gap-1.5">
        {stage.facts.map((fact) => (
          <span
            key={fact}
            className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
            style={{ borderColor: `hsl(${stage.accent} / 0.35)` }}
          >
            {fact}
          </span>
        ))}
      </div>
    </div>
  );
}

function StageCanvas({ stageKey, accent }: { stageKey: StageKey; accent: string }) {
  switch (stageKey) {
    case "resolve":
      return <ResolveCanvas accent={accent} />;
    case "ingest":
      return <IngestCanvas accent={accent} />;
    case "embed":
      return <EmbedCanvas accent={accent} />;
    case "graph":
      return <GraphCanvas accent={accent} />;
    case "serve":
      return <ServeCanvas accent={accent} />;
  }
}

const RESOLVE_PACKAGES = [
  { label: "tree-sitter grammars", delay: 0 },
  { label: "onnx embedding runtime", delay: 0.18 },
  { label: "ryugraph engine", delay: 0.36 }
] as const;

function ResolveCanvas({ accent }: { accent: string }) {
  return (
    <div className="flex h-full flex-col justify-center gap-4">
      {RESOLVE_PACKAGES.map((pkg) => (
        <div key={pkg.label} className="cortex-anim-rise" style={{ animationDelay: `${pkg.delay}s` }}>
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="font-mono">{pkg.label}</span>
            <span className="font-mono" style={{ color: `hsl(${accent})` }}>
              ready
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-border/60">
            <div
              className="cortex-fillbar h-full w-full rounded-full"
              style={{ background: `hsl(${accent})`, animationDelay: `${pkg.delay + 0.12}s` }}
            />
          </div>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">
        Installed under <code className="rounded bg-muted px-1 py-0.5">.context/</code> — no global state.
      </p>
    </div>
  );
}

const INGEST_FILES = ["auth.ts", "User.java", "parse.go", "schema.sql"] as const;
const INGEST_LANES = [0, 1, 2] as const;

function IngestCanvas({ accent }: { accent: string }) {
  return (
    <div className="flex h-full items-center gap-3">
      <div className="flex flex-col gap-1.5">
        {INGEST_FILES.map((file, index) => (
          <span
            key={file}
            className="cortex-anim-rise rounded border bg-background px-2 py-1 font-mono text-[10px]"
            style={{ animationDelay: `${index * 0.08}s` }}
          >
            {file}
          </span>
        ))}
      </div>
      <ChevronsRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex flex-1 flex-col gap-2.5">
        {INGEST_LANES.map((lane) => (
          <div key={lane} className="flex items-center gap-2">
            <span className="flex shrink-0 items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <Cpu className="h-3 w-3" />w{lane + 1}
            </span>
            <div className="cortex-track h-px flex-1 bg-border">
              <span
                className="cortex-track-dot absolute top-1/2 left-0 h-1 w-6 -translate-y-1/2 rounded-full"
                style={{ background: `hsl(${accent})`, animationDelay: `${lane * 0.3}s` }}
              />
            </div>
            <div className="flex shrink-0 gap-1">
              {[0, 1].map((chunk) => (
                <span
                  key={chunk}
                  className="cortex-anim-pop h-4 w-4 rounded-sm"
                  style={{
                    background: `hsl(${accent} / ${0.4 + chunk * 0.35})`,
                    animationDelay: `${0.5 + lane * 0.15 + chunk * 0.2}s`
                  }}
                />
              ))}
            </div>
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground">files → chunks, in parallel</p>
      </div>
    </div>
  );
}

const EMBED_CELLS = Array.from({ length: 48 }, (_, index) => index);

function EmbedCanvas({ accent }: { accent: string }) {
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="rounded border bg-background px-2 py-0.5 font-mono">chunk</span>
        <ArrowRight className="h-3 w-3" />
        <span className="font-mono">[0.12, -0.04, 0.37, …]</span>
      </div>
      <div className="grid grid-cols-12 gap-1">
        {EMBED_CELLS.map((cell) => {
          // Deterministic pseudo-random intensity so the grid reads like a
          // heat-mapped vector without per-render jitter.
          const intensity = 0.18 + (((cell * 37) % 11) / 11) * 0.82;
          const delay = (cell % 12) * 0.03 + Math.floor(cell / 12) * 0.07;
          return (
            <span
              key={cell}
              className="cortex-anim-pop aspect-square rounded-[2px]"
              style={{ background: `hsl(${accent} / ${intensity.toFixed(2)})`, animationDelay: `${delay}s` }}
            />
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">384 dims per entity · runs locally on the ONNX runtime.</p>
    </div>
  );
}

type GraphNode = { id: string; x: number; y: number; label: string };

const GRAPH_NODES: readonly GraphNode[] = [
  { id: "file", x: 42, y: 38, label: "File" },
  { id: "fn1", x: 138, y: 24, label: "fn" },
  { id: "fn2", x: 150, y: 92, label: "fn" },
  { id: "cls", x: 248, y: 52, label: "class" },
  { id: "rule", x: 240, y: 122, label: "Rule" },
  { id: "adr", x: 58, y: 118, label: "ADR" }
] as const;

const GRAPH_EDGES: readonly [string, string][] = [
  ["file", "fn1"],
  ["file", "fn2"],
  ["fn1", "cls"],
  ["fn2", "cls"],
  ["rule", "cls"],
  ["adr", "file"]
];

function GraphCanvas({ accent }: { accent: string }) {
  const byId = new Map(GRAPH_NODES.map((node) => [node.id, node]));
  return (
    <div className="flex h-full items-center justify-center">
      <svg viewBox="0 0 300 150" className="h-full w-full" role="img" aria-label="Code graph of entities and relations">
        {GRAPH_EDGES.map(([from, to], index) => {
          const a = byId.get(from);
          const b = byId.get(to);
          if (!a || !b) return null;
          return (
            <line
              key={`${from}-${to}`}
              className="cortex-edge"
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={`hsl(${accent} / 0.55)`}
              strokeWidth={1.5}
              style={{ strokeDasharray: 300, animationDelay: `${index * 0.12}s` }}
            />
          );
        })}
        {GRAPH_NODES.map((node, index) => (
          <g
            key={node.id}
            className="cortex-anim-pop"
            style={{ animationDelay: `${0.3 + index * 0.1}s`, transformBox: "fill-box", transformOrigin: "center" }}
          >
            <circle cx={node.x} cy={node.y} r={11} fill={`hsl(${accent} / 0.15)`} stroke={`hsl(${accent})`} strokeWidth={1.5} />
            <text
              x={node.x}
              y={node.y + 3}
              textAnchor="middle"
              fontSize={8}
              fontFamily="ui-monospace, monospace"
              fill={`hsl(${accent})`}
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

const SERVE_RESULTS = [
  { name: "auth/login.ts › verifyToken", score: 0.94 },
  { name: "middleware/session.ts", score: 0.87 },
  { name: "rule: no-plaintext-secrets", score: 0.79 }
] as const;

const SERVE_SIGNALS = ["semantic", "graph", "trust", "recency"] as const;

function ServeCanvas({ accent }: { accent: string }) {
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="cortex-anim-rise flex items-center gap-2 rounded border bg-background px-2 py-1.5 font-mono text-[11px]">
        <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate">context.search("how are sessions verified?")</span>
      </div>
      <div className="cortex-track my-1 h-px w-full bg-border">
        <span
          className="cortex-track-dot absolute top-1/2 left-0 h-1 w-10 -translate-y-1/2 rounded-full"
          style={{ background: `hsl(${accent})` }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        {SERVE_RESULTS.map((result, index) => (
          <div
            key={result.name}
            className="cortex-anim-rise flex items-center gap-2"
            style={{ animationDelay: `${0.4 + index * 0.16}s` }}
          >
            <span className="w-8 shrink-0 text-right font-mono text-[10px]" style={{ color: `hsl(${accent})` }}>
              {result.score.toFixed(2)}
            </span>
            <div className="relative h-5 flex-1 overflow-hidden rounded border bg-background">
              <div
                className="cortex-fillbar absolute inset-y-0 left-0 rounded"
                style={{
                  width: `${Math.round(result.score * 100)}%`,
                  background: `hsl(${accent} / 0.15)`,
                  animationDelay: `${0.5 + index * 0.16}s`
                }}
              />
              <span className="absolute inset-0 flex items-center truncate px-2 font-mono text-[10px]">
                {result.name}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-auto flex flex-wrap gap-1 pt-1">
        {SERVE_SIGNALS.map((signal) => (
          <span
            key={signal}
            className="rounded-full border px-1.5 py-0.5 text-[9px] text-muted-foreground"
            style={{ borderColor: `hsl(${accent} / 0.35)` }}
          >
            {signal}
          </span>
        ))}
      </div>
    </div>
  );
}
