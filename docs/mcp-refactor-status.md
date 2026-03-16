# MCP Search Refactor Status

## Current State

`mcp/src/search.ts` has been significantly reduced and now mostly orchestrates the three MCP flows instead of carrying all implementation details inline.

The same refactors have been mirrored into `scaffold/mcp/src/`.

## Extracted Modules

Impact-related extraction completed:

- `mcp/src/presets.ts`
- `mcp/src/impactPresentation.ts`
- `mcp/src/impactRanking.ts`
- `mcp/src/impactResults.ts`
- `mcp/src/impactTraversal.ts`
- `mcp/src/impactResponse.ts`

Related-graph extraction completed:

- `mcp/src/relatedTraversal.ts`
- `mcp/src/relatedResponse.ts`

Search-related extraction completed:

- `mcp/src/searchCore.ts`
- `mcp/src/searchResults.ts`
- `mcp/src/contextEntities.ts`
- `mcp/src/graphMetrics.ts`
- `mcp/src/impactSeed.ts`
- `mcp/src/rules.ts`

## What `search.ts` Still Owns

`mcp/src/search.ts` now mostly contains:

- shared orchestration for:
  - `runContextSearch`
  - `runContextRelated`
  - `runContextImpact`

## Verified State

Last verified green after the refactors above:

- `npm test`
- `npm --prefix mcp test`

Both passed after:

- impact presentation extraction
- impact ranking extraction
- impact result construction extraction
- impact traversal extraction
- impact response extraction
- related traversal extraction
- related response extraction
- search core extraction
- search result extraction
- context entity/catalog extraction

## Recommended Next Steps

1. Break out `resolveImpactSeed` if you want impact orchestration to be fully presentation-free and flow-only.
2. After that, keep `search.ts` as an entrypoint/orchestration module only.

## Practical Goal

The next clean stopping point is:

- `search.ts` as orchestration only
- separate modules for:
  - search core helpers
  - search ranking/results
  - shared entity/catalog construction
  - related traversal/response
  - impact traversal/ranking/results/response

That would make future changes to MCP behavior much less risky than continuing to expand a single central file.
