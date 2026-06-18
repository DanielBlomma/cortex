import { ArrowRight, ChevronsRight, Cpu, Search } from "lucide-react";

import type { StageKey } from "./types";

export function StageCanvas({ stageKey, accent }: { stageKey: StageKey; accent: string }) {
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
                className="cortex-track-dot absolute left-0 top-1/2 h-1 w-6 -translate-y-1/2 rounded-full"
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
            <circle
              cx={node.x}
              cy={node.y}
              r={11}
              fill={`hsl(${accent} / 0.15)`}
              stroke={`hsl(${accent})`}
              strokeWidth={1.5}
            />
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
          className="cortex-track-dot absolute left-0 top-1/2 h-1 w-10 -translate-y-1/2 rounded-full"
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
