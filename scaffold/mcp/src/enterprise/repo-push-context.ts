import {
  NULL_IDENTITY,
  getRepoIdentity,
  type RepoIdentity,
} from "../core/telemetry/repo-identity.js";

export type RepoPushContext = {
  project_root?: string;
  repo_identity?: RepoIdentity;
};

// Resolve identity for a push. When `project_root` is set we re-query git on
// every call so dirty/HEAD reflect real-time state; otherwise fall back to a
// pre-resolved identity, and finally to the null identity so the four
// repo_* fields are always present in the outbound payload (the privacy
// boundary documents them as always-present, possibly-null).
export function resolveRepoIdentity(context: RepoPushContext): RepoIdentity {
  if (context.project_root) return getRepoIdentity(context.project_root);
  if (context.repo_identity) return context.repo_identity;
  return NULL_IDENTITY;
}
