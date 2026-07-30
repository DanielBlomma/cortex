import { loadProjectCliModule } from "./project-runtime.mjs";

const RUN_CLIS = new Set(["claude", "codex", "copilot"]);

export async function runRunCommand(args) {
  const sub = args[0];
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    console.log("Usage:");
    console.log("  cortex run <claude|codex|copilot> [args...]");
    console.log("");
    console.log("Wraps the named AI CLI in cortex enforcement:");
    console.log(
      "  claude/codex: passthrough — their own managed-config + sandbox",
    );
    console.log(
      "                cover Tier 1 enforcement after 'cortex enterprise install --api-key-stdin'.",
    );
    console.log(
      "  copilot:      Tier 2 — OS-level sandbox (sandbox-exec on macOS,",
    );
    console.log(
      "                bwrap on Linux). Denies writes to ~/.copilot/,",
    );
    console.log(
      "                ~/.copilot.local/, /etc/copilot* so AI cannot",
    );
    console.log("                reconfigure itself out of governance.");
    console.log("");
    console.log(
      "Tip: alias copilot='cortex run copilot' so direct 'copilot' invocations",
    );
    console.log(
      "are also wrapped. Direct invocations are otherwise caught by Tier 3",
    );
    console.log("ungoverned-session detection (Phase 5).");
    return;
  }
  if (!RUN_CLIS.has(sub)) {
    throw new Error(`Unknown AI CLI: ${sub}. Use claude, codex, or copilot.`);
  }
  const mod = await loadProjectCliModule("run");
  const exitCode = await mod.runAiCli({ cli: sub, args: args.slice(1) });
  process.exit(exitCode);
}
