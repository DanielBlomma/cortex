import fs from "node:fs";
import {
  accent,
  bold,
  gradient,
  headerBanner,
  muted,
} from "../style.mjs";
import { PACKAGE_JSON_PATH } from "./paths.mjs";

export function printBanner(title) {
  process.stdout.write(headerBanner({ tagline: title }));
}

export function helpRow(cmd, desc) {
  const target = 46;
  const pad = cmd.length >= target ? " " : " ".repeat(target - cmd.length);
  if (desc) {
    return `  ${accent(cmd)}${pad}${muted(desc)}`;
  }
  return `  ${accent(cmd)}`;
}

function helpSection(title) {
  return `\n${bold(muted(title))}`;
}

export function printHelp() {
  console.log(gradient("CORTEX CLI") + muted("  ·  governance for AI coding agents"));
  console.log(muted("  Cortex is in control. Calm, intelligent, always monitoring."));
  console.log(helpSection("USAGE"));
  console.log(helpRow("cortex <command> [options]"));

  console.log(helpSection("CONTEXT"));
  console.log(helpRow("init [path]", "Scaffold a project with --force/--bootstrap/--connect/--watch"));
  console.log(helpRow("connect [path]", "Register MCP clients (Codex + Claude Code)"));
  console.log(helpRow("bootstrap [--background --profile interactive]", "Install deps, ingest, load graph, optionally embed in background"));
  console.log(helpRow("indexing [status --json|pause|resume]", "Manage progressive semantic indexing"));
  console.log(helpRow("update", "Refresh context for changed files"));
  console.log(helpRow("status", "Project context status"));
  console.log(helpRow("doctor", "Diagnose setup health"));
  console.log(helpRow("ingest [--changed] [--verbose]", "Re-index source files"));
  console.log(helpRow("embed [--changed]", "Recompute embeddings"));
  console.log(helpRow("graph-load [--no-reset]", "Reload the dependency graph"));
  console.log(helpRow("search <query> [--json]", "Search local graph+RAG context"));
  console.log(helpRow("related <entity-id> [--json]", "Show related context entities"));
  console.log(helpRow("impact <query|entity-id> [--json]", "Trace likely impact paths"));
  console.log(helpRow("rules [--json]", "List active context rules"));
  console.log(helpRow("explain <query|entity-id> [--json]", "Show search score evidence"));
  console.log(helpRow("pattern-evidence <file|entity-id> [--query <text>] [--top-k <n>] [--json]", "Collect cited repo-local pattern evidence"));
  console.log(helpRow("conventions <file|entity-id> [--json]", "Inspect bounded active repo-local conventions"));
  console.log(helpRow("guidance <file|entity-id> --task <text> [--json]", "Get bounded cited pre-coding guidance"));
  console.log(helpRow("review --diff [--json]", "Review the current Git candidate against HEAD"));
  console.log(helpRow("dashboard [--interval <sec>]", "Live local dashboard"));
  console.log(helpRow("memory-compile [--dry-run] [--verbose]", "Compile memory artifacts"));
  console.log(helpRow("memory-lint [--verbose] [--json]", "Lint compiled memory"));
  console.log(helpRow("watch [start|stop|status|run|once]", "Background sync (--interval, --debounce, --mode)"));

  console.log(helpSection("GOVERNANCE"));
  console.log(helpRow("enterprise install --api-key-stdin", "Install enforcement + hooks + daemon (sudo)"));
  console.log(helpRow("  ", "[--endpoint <url>] [--frameworks <csv>] [--no-hooks] [--no-daemon]"));
  console.log(helpRow("enterprise status", "Show local enforcement state"));
  console.log(helpRow("enterprise sync", "Force re-fetch + re-apply (sudo)"));
  console.log(helpRow("enterprise uninstall", "Remove enforcement (sudo, --break-glass --reason)"));
  console.log(helpRow("enterprise repair", "Verify managed paths, clear tamper-lock (sudo)"));
  console.log(helpRow("run <claude|codex|copilot> [args...]", "Wrap an AI CLI in cortex enforcement"));
  console.log(helpRow("daemon [start|stop|restart|status]", "Local supervisor daemon"));
  console.log(helpRow("hooks [install|uninstall|status] [--project]", "Claude Code hooks"));
  console.log(helpRow("telemetry test", "Smoke-test the push pipeline"));

  console.log(helpSection("HARNESS"));
  console.log(helpRow("stage start --task-id <id> --description \"...\"", "Start a workflow run for a task"));
  console.log(helpRow("stage status --task-id <id>", "Print run state JSON"));
  console.log(helpRow("stage envelope --task-id <id> [--stage <name>]", "Compose stage prompt envelope"));
  console.log(helpRow("stage advance --task-id <id> --stage <name> --body-file <path>", "Write artifact, advance run"));
  console.log(helpRow("stage run --task-id <id> -- <command>", "Exec a command with CORTEX_ACTIVE_TASK_ID set"));
  console.log(helpRow("workflow state <task-id> [--json]", "Read opt-in maintained analysis state"));
  console.log(helpRow("workflow why <task-id> <fact-id> [--json]", "Explain one active analysis fact"));
  console.log(helpRow("workflow why-not <task-id> <predicate> [--json]", "Explain a missing fact for the bound subject"));
  console.log(helpRow("workflow changes <task-id> --since <epoch> [--json]", "Show maintained-state changes"));

  console.log(helpSection("MISC"));
  console.log(helpRow("mcp", "Run the MCP stdio server for the current project"));
  console.log(helpRow("version", "Print CLI version"));
  console.log(helpRow("help", "This screen"));
  console.log("");
}

export function readCliVersion() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
