import {
  ArrowRight,
  Boxes,
  Braces,
  FileSearch,
  GitFork,
  Network,
  ScrollText,
  Shield,
  Sparkles,
  Workflow,
  Zap
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const FEATURES = [
  {
    icon: Sparkles,
    title: "Higher-quality suggestions",
    description:
      "Assistants see the right files, symbols and architectural rules instead of guessing from a directory listing."
  },
  {
    icon: Zap,
    title: "Lower token cost",
    description:
      "Targeted retrieval delivers a compact, ranked context — a fraction of the tokens of raw file dumps."
  },
  {
    icon: Shield,
    title: "Privacy by design",
    description:
      "Indexing, embeddings and graph storage all run locally in your repo. No code leaves the machine."
  },
  {
    icon: ScrollText,
    title: "Architectural governance",
    description:
      "Rules and ADRs are first-class graph nodes, enforced at retrieval time with source-of-truth ranking."
  },
  {
    icon: Braces,
    title: "Multi-language engine",
    description:
      "One tree-sitter based pipeline chunks JavaScript, TypeScript, Python, Go, Rust, Java, C/C++, C#, Ruby, SQL and more."
  },
  {
    icon: Workflow,
    title: "One-command setup",
    description:
      "cortex init --bootstrap scaffolds the project, indexes the repo, generates embeddings and loads the graph."
  }
] as const;

const PIPELINE = [
  {
    icon: FileSearch,
    title: "Ingest",
    description:
      "Tree-sitter parses source files into entities — files, chunks (functions, classes, methods), rules, ADRs, modules."
  },
  {
    icon: Boxes,
    title: "Embed",
    description:
      "A local sentence-transformer model vectorizes every entity for semantic search. No API keys, fully offline."
  },
  {
    icon: Network,
    title: "Graph",
    description:
      "Entities and relations (CALLS, DEFINES, IMPORTS, CONSTRAINS, IMPLEMENTS, …) load into RyuGraph, a local property graph."
  },
  {
    icon: GitFork,
    title: "Retrieve & govern",
    description:
      "MCP tools combine semantic search with graph traversal, ranked by semantic, graph, trust and recency signals."
  }
] as const;

const MCP_TOOLS = [
  { name: "context.search", description: "Semantic + lexical search over all indexed entities" },
  { name: "context.get_related", description: "Graph neighbors of an entity up to a chosen depth" },
  { name: "context.impact", description: "Likely impact paths for a change, ranked and filterable" },
  { name: "context.get_rules", description: "Architectural rules that apply to a scope" },
  { name: "context.reload", description: "Hot-reload the context graph after re-indexing" }
] as const;

const LANGUAGES = [
  "JavaScript",
  "TypeScript",
  "Python",
  "Go",
  "Rust",
  "Java",
  "C / C++",
  "C#",
  "Ruby",
  "VB.NET",
  "VB6",
  "SQL",
  "Bash",
  "Config & resources"
] as const;

export function OverviewPage() {
  return (
    <main className="mx-auto flex max-w-[96rem] flex-col gap-12 px-4 pb-16 pt-10">
      <section className="mx-auto flex max-w-3xl flex-col items-center gap-5 text-center">
        <Badge variant="secondary" className="px-3 py-1 text-xs">
          Local · Repo-scoped · MCP
        </Badge>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Repo-scoped context for AI coding assistants
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
          Cortex turns your repository into a queryable context engine: semantic search, a code graph and
          architectural rules, served to Claude Code, Codex and any MCP client — entirely on your machine.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <a
            href="#/bootstrap"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Explore bootstrap metrics
            <ArrowRight className="h-4 w-4" />
          </a>
          <a
            href="https://www.npmjs.com/package/@danielblomma/cortex-mcp"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center rounded-md border border-input bg-background px-5 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            npm install -g @danielblomma/cortex-mcp
          </a>
        </div>
      </section>

      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">Why cortex</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.title}>
              <CardHeader className="pb-2">
                <feature.icon className="mb-1 h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>{feature.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <h2 className="text-xl font-semibold tracking-tight">How bootstrap works</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">cortex bootstrap</code> runs the full
          indexing pipeline. The bootstrap metrics pages on this site measure exactly this phase across 69
          large open-source repositories.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PIPELINE.map((stage, index) => (
            <Card key={stage.title} className="relative">
              <CardHeader className="pb-2">
                <div className="mb-1 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  <stage.icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <CardTitle className="text-base">{stage.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>{stage.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-5">
          <h2 className="text-xl font-semibold tracking-tight">MCP tools</h2>
          <Card>
            <CardContent className="divide-y p-0">
              {MCP_TOOLS.map((tool) => (
                <div key={tool.name} className="flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-center sm:gap-4">
                  <code className="shrink-0 rounded bg-muted px-2 py-1 text-xs font-medium sm:w-44">
                    {tool.name}
                  </code>
                  <span className="text-sm text-muted-foreground">{tool.description}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-5">
          <h2 className="text-xl font-semibold tracking-tight">Language coverage</h2>
          <Card>
            <CardContent className="flex flex-wrap gap-2 p-6">
              {LANGUAGES.map((language) => (
                <Badge key={language} variant="outline" className="px-3 py-1 text-xs">
                  {language}
                </Badge>
              ))}
            </CardContent>
          </Card>
          <p className="text-sm text-muted-foreground">
            Language-specific tree-sitter parsers produce AST-based chunks; a windowed splitter covers
            everything else, so every repository gets useful context.
          </p>
        </div>
      </section>
    </main>
  );
}
