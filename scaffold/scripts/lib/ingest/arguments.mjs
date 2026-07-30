export function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    printHelp();
    process.exit(0);
  }

  return {
    mode: args.has("--changed") ? "changed" : "full",
    verbose: args.has("--verbose")
  };
}
export function printHelp() {
  console.log("Usage: ./scripts/ingest.sh [--changed] [--verbose]");
  console.log("");
  console.log("Options:");
  console.log("  --changed   Ingest only changed/untracked files when git is available.");
  console.log("  --verbose   Print skipped files and additional diagnostics.");
  console.log("  -h, --help  Show this help message.");
}

export function parsePositiveIntegerEnv(name, fallback) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function parseNonNegativeIntegerEnv(name, fallback) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function isTruthyEnv(value) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false" && normalized !== "no" && normalized !== "off";
}

export function createIngestMemoryTrace() {
  const enabled = isTruthyEnv(process.env.CORTEX_INGEST_TRACE_MEMORY);

  return {
    enabled,
    checkpoint(label, counts = {}) {
      if (!enabled) {
        return;
      }

      const memory = process.memoryUsage();
      process.stderr.write(
        `${JSON.stringify({
          type: "cortex.ingest.memory",
          label,
          rss_bytes: memory.rss,
          rss_mb: Number((memory.rss / 1024 / 1024).toFixed(2)),
          heap_used_bytes: memory.heapUsed,
          external_bytes: memory.external,
          counts
        })}\n`
      );
    }
  };
}
