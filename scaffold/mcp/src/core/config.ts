import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Role, RBACConfig } from "./rbac/check.js";
import { parseValidatorsConfig, type ValidatorsConfig } from "./validators/config.js";

export type TelemetryConfig = {
  enabled: boolean;
  endpoint: string;
  api_key: string;
  interval_minutes: number;
};

export type EnterpriseServiceConfig = {
  endpoint: string;
  api_key: string;
  base_url: string;
};

export type EnterpriseActivation =
  | { active: true; reason: "active"; endpoint: string; api_key: string }
  | {
      active: false;
      reason:
        | "missing_api_key"
        | "missing_endpoint"
        | "invalid_api_key_format"
        | "invalid_endpoint_format";
      endpoint: string | null;
      api_key: string | null;
    };

export type AuditConfig = {
  enabled: boolean;
  retention_days: number;
};

export type PolicyConfig = {
  enabled: boolean;
  endpoint: string;
  api_key: string;
  sync_interval_minutes: number;
};

export type ComplianceFramework =
  | "iso27001"
  | "iso42001"
  | "soc2"
  | "gdpr"
  | "ai_act"
  | "nis2";

export type ComplianceConfig = {
  frameworks: ComplianceFramework[];
  eu_addons: boolean;
};

export type GovernMode = "off" | "advisory" | "enforced";
export type GovernTier = "prevent" | "wrap" | "detect" | "off";

export type GovernConfig = {
  mode: GovernMode;
  sync_on_startup: boolean;
  sync_interval_minutes: number;
  tier_claude: GovernTier;
  tier_codex: GovernTier;
  tier_copilot: GovernTier;
  detect_ungoverned: boolean;
  govern_endpoint: string;
};

export type EnterpriseConfig = {
  enterprise: EnterpriseServiceConfig;
  telemetry: TelemetryConfig;
  audit: AuditConfig;
  policy: PolicyConfig;
  rbac: RBACConfig;
  validators: ValidatorsConfig;
  compliance: ComplianceConfig;
  govern: GovernConfig;
};

const DEFAULT_FRAMEWORKS: ComplianceFramework[] = ["iso27001", "iso42001", "soc2"];
const EU_ADDON_FRAMEWORKS: ComplianceFramework[] = ["gdpr", "ai_act", "nis2"];
const VALID_FRAMEWORKS = new Set<ComplianceFramework>([
  ...DEFAULT_FRAMEWORKS,
  ...EU_ADDON_FRAMEWORKS,
]);
const VALID_MODES = new Set<GovernMode>(["off", "advisory", "enforced"]);
const VALID_TIERS = new Set<GovernTier>(["prevent", "wrap", "detect", "off"]);

const DEFAULTS: EnterpriseConfig = {
  enterprise: {
    endpoint: "",
    api_key: "",
    base_url: "",
  },
  telemetry: {
    enabled: false,
    endpoint: "",
    api_key: "",
    interval_minutes: 10,
  },
  audit: {
    enabled: true,
    retention_days: 90,
  },
  policy: {
    enabled: true,
    endpoint: "",
    api_key: "",
    sync_interval_minutes: 240,
  },
  rbac: {
    enabled: false,
    default_role: "developer",
  },
  validators: {},
  compliance: {
    frameworks: [],
    eu_addons: false,
  },
  govern: {
    mode: "off",
    sync_on_startup: true,
    sync_interval_minutes: 60,
    tier_claude: "prevent",
    tier_codex: "prevent",
    tier_copilot: "wrap",
    detect_ungoverned: true,
    govern_endpoint: "",
  },
};

const VALID_ROLES: Role[] = ["admin", "developer", "readonly"];

function isValidRole(value: string | undefined): value is Role {
  return VALID_ROLES.includes(value as Role);
}

function stripInlineComment(value: string): string {
  // Strip # comments that aren't inside quotes
  const singleMatch = value.match(/^'([^']*)'(\s*#.*)?$/);
  if (singleMatch) return singleMatch[1];
  const doubleMatch = value.match(/^"([^"]*)"(\s*#.*)?$/);
  if (doubleMatch) return doubleMatch[1];
  // Unquoted: strip from first # preceded by whitespace
  const commentIdx = value.search(/\s+#/);
  return commentIdx >= 0 ? value.slice(0, commentIdx).trimEnd() : value;
}

function parseInlineList(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function parseSimpleYaml(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  let section = "";
  for (const line of text.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const sectionMatch = trimmed.match(/^(\w+):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    const kvMatch = trimmed.match(/^\s+(\w+):\s*(.+?)\s*$/);
    if (kvMatch && section) {
      result[`${section}.${kvMatch[1]}`] = stripInlineComment(kvMatch[2]);
      continue;
    }

    const topMatch = trimmed.match(/^(\w+):\s*(.+?)\s*$/);
    if (topMatch) {
      result[topMatch[1]] = stripInlineComment(topMatch[2]);
    }
  }
  return result;
}

function isLikelyApiKey(value: string): boolean {
  return /^(?:ctx|ent)_[A-Za-z0-9._-]{8,}$/.test(value);
}

function isLikelyHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function resolveEnterpriseActivation(config: EnterpriseConfig): EnterpriseActivation {
  const apiKey = config.enterprise.api_key.trim();
  const endpoint = config.enterprise.endpoint.trim();

  if (!apiKey) {
    return { active: false, reason: "missing_api_key", api_key: null, endpoint: endpoint || null };
  }

  if (!endpoint) {
    return { active: false, reason: "missing_endpoint", api_key: apiKey, endpoint: null };
  }

  if (!isLikelyApiKey(apiKey)) {
    return { active: false, reason: "invalid_api_key_format", api_key: apiKey, endpoint };
  }

  if (!isLikelyHttpUrl(endpoint)) {
    return { active: false, reason: "invalid_endpoint_format", api_key: apiKey, endpoint };
  }

  return { active: true, reason: "active", api_key: apiKey, endpoint };
}

function deriveEndpoint(baseUrl: string, suffix: string): string {
  if (!baseUrl) return "";
  return baseUrl.replace(/\/$/, "") + suffix;
}

function isValidTier(value: string | undefined): value is GovernTier {
  return value !== undefined && VALID_TIERS.has(value as GovernTier);
}

function isValidMode(value: string | undefined): value is GovernMode {
  return value !== undefined && VALID_MODES.has(value as GovernMode);
}

function resolveFrameworks(rawList: string | undefined, euAddons: boolean): ComplianceFramework[] {
  const parsed = rawList ? parseInlineList(rawList) : null;
  const base = parsed && parsed.length > 0
    ? parsed.filter((f): f is ComplianceFramework => VALID_FRAMEWORKS.has(f as ComplianceFramework))
    : DEFAULT_FRAMEWORKS.slice();
  if (!euAddons) return base;
  const merged = new Set<ComplianceFramework>(base);
  for (const f of EU_ADDON_FRAMEWORKS) merged.add(f);
  return Array.from(merged);
}

export function loadEnterpriseConfig(contextDir: string): EnterpriseConfig {
  let raw: string;
  try {
    raw = readFileSync(join(contextDir, "enterprise.yml"), "utf8");
  } catch {
    try {
      raw = readFileSync(join(contextDir, "enterprise.yaml"), "utf8");
    } catch {
      return DEFAULTS;
    }
  }

  const fields = parseSimpleYaml(raw);
  const enterpriseApiKey = fields["enterprise.api_key"] ?? DEFAULTS.enterprise.api_key;
  const baseUrl = (fields["enterprise.base_url"] ?? fields["enterprise.endpoint"] ?? "").replace(/\/$/, "");
  const enterpriseEndpoint = fields["enterprise.endpoint"] ?? baseUrl;

  const telemetryEndpoint =
    fields["enterprise.endpoint_telemetry"] ??
    fields["telemetry.endpoint"] ??
    deriveEndpoint(baseUrl, "/api/v1/telemetry/push");
  const telemetryApiKey = fields["telemetry.api_key"] ?? enterpriseApiKey;
  const policyEndpoint =
    fields["enterprise.endpoint_policy"] ??
    fields["policy.endpoint"] ??
    deriveEndpoint(baseUrl, "/api/v1/policies/sync");
  const policyApiKey = fields["policy.api_key"] ?? enterpriseApiKey;
  const governEndpoint =
    fields["enterprise.endpoint_govern"] ??
    deriveEndpoint(baseUrl, "/api/v1/govern");

  const euAddons = fields["compliance.eu_addons"] === "true";
  const frameworks = resolveFrameworks(fields["compliance.frameworks"], euAddons);

  const governMode = isValidMode(fields["govern.mode"]) ? fields["govern.mode"] : DEFAULTS.govern.mode;

  return {
    enterprise: {
      endpoint: enterpriseEndpoint,
      api_key: enterpriseApiKey,
      base_url: baseUrl,
    },
    telemetry: {
      endpoint: telemetryEndpoint,
      api_key: telemetryApiKey,
      enabled: fields["telemetry.enabled"] !== undefined
        ? fields["telemetry.enabled"] === "true"
        : !!(telemetryEndpoint && telemetryApiKey),
      interval_minutes: parseInt(fields["telemetry.interval_minutes"] ?? "", 10) || DEFAULTS.telemetry.interval_minutes,
    },
    audit: {
      enabled: fields["audit.enabled"] !== "false",
      retention_days: parseInt(fields["audit.retention_days"] ?? "", 10) || DEFAULTS.audit.retention_days,
    },
    policy: {
      enabled: fields["policy.enabled"] !== "false",
      endpoint: policyEndpoint,
      api_key: policyApiKey,
      sync_interval_minutes: parseInt(fields["policy.sync_interval_minutes"] ?? "", 10) || DEFAULTS.policy.sync_interval_minutes,
    },
    rbac: {
      enabled: fields["rbac.enabled"] === "true",
      default_role: isValidRole(fields["rbac.default_role"]) ? fields["rbac.default_role"] : DEFAULTS.rbac.default_role,
    },
    validators: parseValidatorsConfig(fields),
    compliance: {
      frameworks,
      eu_addons: euAddons,
    },
    govern: {
      mode: governMode,
      sync_on_startup: fields["govern.sync_on_startup"] !== "false",
      sync_interval_minutes: parseInt(fields["govern.sync_interval_minutes"] ?? "", 10) || DEFAULTS.govern.sync_interval_minutes,
      tier_claude: isValidTier(fields["govern.tier_claude"]) ? fields["govern.tier_claude"] : DEFAULTS.govern.tier_claude,
      tier_codex: isValidTier(fields["govern.tier_codex"]) ? fields["govern.tier_codex"] : DEFAULTS.govern.tier_codex,
      tier_copilot: isValidTier(fields["govern.tier_copilot"]) ? fields["govern.tier_copilot"] : DEFAULTS.govern.tier_copilot,
      detect_ungoverned: fields["govern.detect_ungoverned"] !== "false",
      govern_endpoint: governEndpoint,
    },
  };
}
