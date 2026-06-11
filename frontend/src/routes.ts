export type Route =
  | { page: "overview" }
  | { page: "bootstrap" }
  | { page: "repoDetail"; repoKey: string };

export function parseRoute(hash: string): Route {
  const normalized = hash.replace(/^#\/?/, "");
  const parts = normalized.split("/").filter(Boolean);

  if (parts[0] === "bootstrap" && parts[1] === "repos" && parts[2]) {
    return { page: "repoDetail", repoKey: decodeURIComponent(parts.slice(2).join("/")) };
  }

  if (parts[0] === "bootstrap") {
    return { page: "bootstrap" };
  }

  return { page: "overview" };
}

export function repoDetailHash(repoKey: string): string {
  return `#/bootstrap/repos/${encodeURIComponent(repoKey)}`;
}
