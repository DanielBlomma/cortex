import { join } from "node:path";
import { loadEnterpriseConfig } from "./config.js";
import { enterpriseCredentialId } from "./license.js";

/**
 * Resolve the opaque per-user Enterprise identity for a project.
 *
 * The identifier binds the normalized endpoint and API key without
 * persisting either credential in shared daemon metadata.
 */
export function configuredEnterpriseCredentialId(cwd: string): string | null {
  const config = loadEnterpriseConfig(join(cwd, ".context"));
  const apiKey = config.enterprise.api_key.trim();
  const endpoint = (
    config.enterprise.base_url ||
    config.enterprise.endpoint
  ).trim();
  if (!apiKey || !endpoint) return null;
  return enterpriseCredentialId(endpoint, apiKey);
}
