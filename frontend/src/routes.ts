export type Route =
  | { page: "overview" }
  | { page: "bootstrap"; version?: string }
  | { page: "repoDetail"; repoKey: string; version?: string };

/**
 * Hash routes. The cortex version is optional everywhere; when absent the app
 * resolves it to the newest published version from the index.
 *
 *   #/                                     overview
 *   #/bootstrap                            bootstrap metrics, latest version
 *   #/bootstrap/v/<version>                bootstrap metrics, pinned version
 *   #/bootstrap/v/<version>/repos/<key>    repo detail, pinned version
 *   #/bootstrap/repos/<key>                repo detail, latest version (legacy)
 */
export function parseRoute(hash: string): Route {
  const normalized = hash.replace(/^#\/?/, "");
  const parts = normalized.split("/").filter(Boolean);

  if (parts[0] !== "bootstrap") {
    return { page: "overview" };
  }

  if (parts[1] === "v" && parts[2]) {
    const version = decodeURIComponent(parts[2]);
    if (parts[3] === "repos" && parts[4]) {
      return { page: "repoDetail", version, repoKey: decodeURIComponent(parts.slice(4).join("/")) };
    }
    return { page: "bootstrap", version };
  }

  if (parts[1] === "repos" && parts[2]) {
    return { page: "repoDetail", repoKey: decodeURIComponent(parts.slice(2).join("/")) };
  }

  return { page: "bootstrap" };
}

export function bootstrapHash(version?: string): string {
  return version ? `#/bootstrap/v/${encodeURIComponent(version)}` : "#/bootstrap";
}

export function repoDetailHash(repoKey: string, version?: string): string {
  const key = encodeURIComponent(repoKey);
  return version ? `#/bootstrap/v/${encodeURIComponent(version)}/repos/${key}` : `#/bootstrap/repos/${key}`;
}
