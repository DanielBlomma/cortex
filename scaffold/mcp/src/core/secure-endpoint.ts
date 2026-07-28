/**
 * Enterprise bearer credentials may travel only over TLS. Loopback HTTP is
 * retained for local development because the connection cannot leave the
 * host. Embedded URL credentials are never accepted.
 */
export function isAllowedEnterpriseEndpoint(endpoint: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (parsed.protocol === "https:") return true;
  if (parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}
