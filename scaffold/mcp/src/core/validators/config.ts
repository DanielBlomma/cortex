export type ValidatorsConfig = Record<string, Record<string, unknown>>;

/**
 * Parse the validators section from the simple YAML fields map.
 *
 * Fields arrive as flat "validators.max-file-size.max_bytes" = "500000" entries.
 * We reconstruct them into nested config: { "max-file-size": { max_bytes: 500000 } }.
 */
export function parseValidatorsConfig(fields: Record<string, string>): ValidatorsConfig {
  const config: ValidatorsConfig = {};
  const prefix = "validators.";

  for (const [key, value] of Object.entries(fields)) {
    if (!key.startsWith(prefix)) continue;

    const rest = key.slice(prefix.length);
    const dotIndex = rest.indexOf(".");
    if (dotIndex < 0) continue;

    const validatorId = rest.slice(0, dotIndex);
    const optionKey = rest.slice(dotIndex + 1);

    if (!config[validatorId]) {
      config[validatorId] = {};
    }

    config[validatorId][optionKey] = coerceValue(value);
  }

  return config;
}

function coerceValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  const num = Number(value);
  if (!Number.isNaN(num) && value.trim() !== "") return num;
  // Handle YAML-style arrays: ["a", "b", "c"]
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      return JSON.parse(value);
    } catch {
      // Fall through to string
    }
  }
  return value;
}
