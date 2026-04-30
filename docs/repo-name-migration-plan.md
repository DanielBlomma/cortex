# Repo Name Migration Plan

## Goal

Replace git-derived repo identity metadata with the existing `repo` field,
derived from the project root directory name.

## Scope

1. Remove `repo_remote_hash`, `repo_branch`, `repo_head_sha`, and `repo_dirty`
   from outbound telemetry, audit, reviews, violations, and workflow payloads.
2. Remove git-based repo identity helpers and push-context resolution.
3. Use `path.basename(projectRoot)` as the single source of truth for `repo`.
4. Update tests to assert `repo` behavior instead of git metadata behavior.
5. Verify any server-side/schema usage inside this repo and update it to consume
   `repo`.

## Implementation Steps

1. Update the boundary/payload contract to document and emit `repo`.
2. Simplify telemetry push context and all enterprise push contexts to carry `repo`.
3. Remove `repo-identity.ts` and `repo-push-context.ts`, then replace callers in:
   - `scaffold/mcp/src/enterprise/index.ts`
   - `scaffold/mcp/src/daemon/main.ts`
   - `scaffold/mcp/src/cli/telemetry-test.ts`
   - `scaffold/mcp/src/enterprise/*/push.ts`
4. Search the repo for any remaining `repo_*` git fields and update or delete them.
5. Rewrite `scaffold/mcp/tests/repo-identity.test.mjs` into a repo-focused test file.
6. Run the relevant MCP test suite and fix any fallout.

## Validation

1. Every outbound push channel includes `repo`.
2. `repo` follows `CORTEX_PROJECT_ROOT` when set.
3. No remaining code depends on git remote/branch/SHA/dirty for repo identity.
