import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export type RepoIdentity = {
  repo_remote_hash: string | null;
  repo_branch: string | null;
  repo_head_sha: string | null;
  repo_dirty: boolean | null;
};

export const NULL_IDENTITY: RepoIdentity = {
  repo_remote_hash: null,
  repo_branch: null,
  repo_head_sha: null,
  repo_dirty: null,
};

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
  } catch {
    return null;
  }
}

// Normalize a git remote URL so all clone styles of the same repo hash to
// the same value. All of the following collapse to "github.com/org/repo":
//   git@github.com:org/repo.git
//   ssh://git@github.com/org/repo.git
//   https://github.com/org/repo.git
//   https://user:token@github.com/org/repo
export function normalizeRemoteUrl(url: string): string {
  let s = url.trim();

  if (!s.includes("://")) {
    // scp-style: [user@]host:path
    const scp = s.match(/^(?:[^@\s]+@)?([^:\s/]+):(.+)$/);
    if (scp) s = `${scp[1]}/${scp[2]}`;
  } else {
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    s = s.replace(/^[^@/]+@/, "");
  }

  s = s.toLowerCase();
  s = s.replace(/\/+$/, "");
  s = s.replace(/\.git$/, "");
  return s;
}

// Resolved live on every call so dirty/HEAD/branch reflect the real-time
// state of the working tree, not a session-start snapshot.
export function getRepoIdentity(cwd: string): RepoIdentity {
  const insideRepo = git(["rev-parse", "--is-inside-work-tree"], cwd) === "true";
  if (!insideRepo) return NULL_IDENTITY;

  const remote = git(["config", "--get", "remote.origin.url"], cwd);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const headSha = git(["rev-parse", "HEAD"], cwd);
  const status = git(["status", "--porcelain"], cwd);

  return {
    repo_remote_hash: remote
      ? createHash("sha256").update(normalizeRemoteUrl(remote)).digest("hex")
      : null,
    repo_branch: branch && branch !== "HEAD" ? branch : null,
    repo_head_sha: headSha,
    repo_dirty: status === null ? null : status.length > 0,
  };
}
