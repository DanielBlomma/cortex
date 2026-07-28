# Dependabot Remediation

## Objective

Close the open npm dependency advisories reported for the current 2.4.1
release branch without weakening the Enterprise boundary work or introducing
unreviewed application changes.

## Baseline

The GitHub CLI token is stale, so the private alert API cannot currently be
queried. The npm registry audit endpoint provides the package/advisory source
data used for this work order.

- `frontend/package-lock.json`: one high-severity PostCSS path traversal
  advisory (`GHSA-r28c-9q8g-f849`), affecting PostCSS through 8.5.17.
- `scaffold/mcp/package-lock.json`: 13 vulnerable package nodes:
  - critical/high archive and expansion paths in `tar`, `adm-zip`,
    `brace-expansion`, `sharp`, and their Transformers/ONNX parent chain;
  - high URI/YAML parsing issues in `fast-uri` and `js-yaml`;
  - moderate Hono adapter/framework and protobuf issues;
  - low `body-parser` limit handling.
- Root and both parser lockfiles report zero npm audit findings.

## Dependency Ownership

- Frontend owns PostCSS directly.
- The MCP runtime owns `@modelcontextprotocol/sdk`, `js-yaml`, `minimatch`,
  and `@huggingface/transformers` directly.
- MCP SDK owns the Hono/Express/Ajv chains.
- Transformers owns pinned ONNX runtime and Sharp chains.
- RyuGraph owns the CMake/tar chain.

## Remediation Contract

1. Prefer patched releases within the existing dependency major.
2. Update `@modelcontextprotocol/sdk` to 1.30.x so its declared adapter range
   accepts patched `@hono/node-server` 2.x.
3. Use explicit transitive overrides only when an upstream direct dependency
   does not yet admit the patched version:
   - `adm-zip` 0.6.x for the pinned ONNX runtime;
   - `sharp` 0.35.x for Transformers 4.2.x.
4. Raise the package engine floor from generic Node 20 to Node 20.9, the first
   Node 20 LTS release and the minimum required by patched Sharp.
5. Do not use `npm audit fix --force` or accept a vulnerable no-fix chain.
6. Keep release version 2.4.1 because the security release is not yet merged,
   tagged, or published.

## Owned Files

- `frontend/package.json`
- `frontend/package-lock.json`
- `scaffold/mcp/package.json`
- `scaffold/mcp/package-lock.json`
- `package.json`
- `.github/workflows/release-bump.yml`
- `.github/workflows/release-publish.yml`
- `.github/workflows/pages.yml`
- `README.md`
- `CHANGELOG.md`
- Agent-control records for WO-025 / REQ-14 / R3

## Validation

- `npm audit --json --package-lock-only` reports zero vulnerabilities in all
  five committed npm lockfiles.
- Clean installs succeed for frontend and MCP runtime.
- `npm run build` passes in frontend.
- Full MCP and root test suites pass.
- A Transformers text-embedding import/model smoke exercises the overridden
  native dependency tree without image input.
- `npm run release:check-version-sync`, package dry-run, and
  `git diff --check` pass.
- `cortex update` completes after the lockfile and control-doc changes.

## Rollback Boundary

If the `adm-zip` or `sharp` override proves runtime-incompatible, do not
downgrade to a vulnerable version. Keep the release unpublished and either
patch the owning dependency chain or replace the affected embedding runtime in
a separately reviewed work order.

## Outcome

Accepted locally on 2026-07-28 for the unreleased 2.4.1 branch. Every committed
npm lockfile audits at zero vulnerabilities. Clean installs, frontend build,
native embedding/image/ZIP smoke, full MCP/root suites, context regressions,
workflow parsing, version sync, package dry-run, and diff checks pass.
GitHub's default-branch Dependabot alerts will reconcile only after merge.
