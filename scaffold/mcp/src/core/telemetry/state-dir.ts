import { accessSync, constants, mkdirSync } from "node:fs";
import { join } from "node:path";

const warnedFallbacks = new Set<string>();

function canUseDirectory(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.R_OK | constants.W_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveTelemetryStateDir(contextDir: string): string {
  const primary = join(contextDir, "telemetry");
  if (canUseDirectory(primary)) return primary;

  const fallback = join(contextDir, "cache", "telemetry");
  if (canUseDirectory(fallback)) {
    const warningKey = `${primary}->${fallback}`;
    if (!warnedFallbacks.has(warningKey)) {
      warnedFallbacks.add(warningKey);
      process.stderr.write(
        `[cortex-enterprise] telemetry dir not writable at ${primary}; using ${fallback}\n`,
      );
    }
    return fallback;
  }

  return primary;
}

export function telemetryStatePath(
  contextDir: string,
  ...parts: string[]
): string {
  return join(resolveTelemetryStateDir(contextDir), ...parts);
}
