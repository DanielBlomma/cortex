# Semantic Quality Query Pack v1

This pack defines natural-language retrieval questions for before/after
embedding experiments. It is designed to catch semantic quality regressions
when changing token budgets, text profiles, or embedding input construction.

## Rules

- All queries are written in English.
- File names may be used as anchors, but queries must ask about behavior,
  design pattern, data flow, integration, fallback/error handling, caching, or
  tests.
- Queries must not be simple `find file X` prompts.
- If a query names a file, that file alone is not sufficient to pass. Expected
  hits should include related files or entities that explain the behavior.
- The same query pack must be used for before and after runs.

## Schema

Each `.jsonl` line is one query:

```json
{
  "schema_version": 1,
  "pack": "semantic-quality-v1",
  "repo_key": "owner__repo",
  "repo": "owner/repo",
  "repo_sha": "pinned benchmark commit",
  "id": "repo-semantic-001",
  "language": "en",
  "query": "English engineering task question",
  "category": "behavior category",
  "top_k": 10,
  "expected_hits": ["path/or/entity", "related/path/or/entity"],
  "must_keep": true,
  "review_status": "agent_drafted",
  "rationale": "Why this query tests semantic retrieval"
}
```

`review_status=agent_drafted` means the query is suitable for exploratory
baseline/after comparison. Before turning failures into a hard release gate,
the manager should review expected hits against the pinned repo and update the
status if needed.

## Gate

The first acceptance gate is strict on recall, tolerant on rank:

- Compare the same query against before and after indexes for the same repo,
  model, top-k, config, and cache policy.
- Every `must_keep` expected hit found in the before top 10 must remain in the
  after top 10.
- Rank movement inside top 10 is allowed.
- Missing expected hits require manual review before accepting a faster
  embedding strategy.

## Running

Run against an already indexed repo root:

```bash
node benchmark/bootstrapbench/run-query-pack.mjs \
  --repo-root benchmark/bootstrapbench/results/<run-id>/workspaces/<repo_key> \
  --repo-key <repo_key> \
  --run-id <run-id>
```

The runner verifies that the target repo's `git rev-parse HEAD` matches the
pack's pinned SHA unless `--allow-sha-mismatch` is used for an exploratory
local run. Results are written under
`benchmark/bootstrapbench/results/<run-id>/query-quality/`.
