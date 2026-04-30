import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { verifyLicense } from "../core/license.js";

/**
 * One-liner enterprise onboarding.
 *
 *   $ cortex enterprise <api-key> [--endpoint <url>]
 *
 * Replaces the manual `.context/enterprise.yml` editing flow that's been
 * the friction point for new users. Validates the key against the
 * license endpoint before writing config — so a typo'd key fails fast
 * with a clear error rather than going silently into community-mode.
 */

const DEFAULT_ENDPOINT = "https://cortex-web-rho.vercel.app";

export type EnterpriseSetupOptions = {
  apiKey: string;
  endpoint?: string;
  cwd?: string;
};

export type EnterpriseSetupResult = {
  ok: boolean;
  message: string;
  configPath?: string;
  edition?: string;
  expiresAt?: string;
};

const API_KEY_RE = /^(?:ctx|ent)_[A-Za-z0-9._-]{8,}$/;

function buildEnterpriseYaml(endpoint: string, apiKey: string): string {
  const lines = [
    "enterprise:",
    `  endpoint: ${endpoint}`,
    `  api_key: ${apiKey}`,
    "",
    "telemetry:",
    "  enabled: true",
    "  interval_minutes: 1",
    `  endpoint: ${endpoint}/api/v1/telemetry/push`,
    `  api_key: ${apiKey}`,
    "",
    "policy:",
    `  endpoint: ${endpoint}/api/v1/policies/sync`,
    `  api_key: ${apiKey}`,
    "",
  ];
  return lines.join("\n");
}

export async function runEnterpriseSetup(
  options: EnterpriseSetupOptions,
): Promise<EnterpriseSetupResult> {
  const cwd = options.cwd ?? process.cwd();
  const endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, "");
  const apiKey = options.apiKey.trim();

  if (!API_KEY_RE.test(apiKey)) {
    return {
      ok: false,
      message:
        "API key must start with 'ctx_' or 'ent_' followed by at least 8 alphanumeric/._- chars.",
    };
  }

  if (!/^https?:\/\//.test(endpoint)) {
    return {
      ok: false,
      message: `Endpoint must be http(s) URL: ${endpoint}`,
    };
  }

  const contextDir = join(cwd, ".context");
  if (!existsSync(contextDir)) {
    return {
      ok: false,
      message: `No .context/ at ${cwd}. Run 'cortex init --bootstrap' first.`,
    };
  }

  // Validate key BEFORE writing config — fail fast, no half-configured state.
  const license = await verifyLicense(contextDir, endpoint, apiKey, {
    client_version: process.env.CORTEX_VERSION,
  });

  if (!license.valid) {
    return {
      ok: false,
      message: `License rejected: ${license.reason} (source=${license.source}). Verify the API key and endpoint are correct.`,
    };
  }

  // Write enterprise.yml.
  const configPath = join(contextDir, "enterprise.yml");
  try {
    mkdirSync(contextDir, { recursive: true });
    writeFileSync(configPath, buildEnterpriseYaml(endpoint, apiKey), "utf8");
  } catch (err) {
    return {
      ok: false,
      message: `Failed to write ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return {
    ok: true,
    message: "Enterprise configuration written.",
    configPath,
    edition: license.edition,
    expiresAt: license.expires_at,
  };
}
