# Changelog

## 2.6.0 — 2026-08-30

### Added

- Added the opt-in DeepSeek Harness V1 integration source and validated it
  against the pinned Harness `0.1.1-rc.2` release. It exposes the four explicit, agent-scoped
  `cortex_search`, `cortex_related`, `cortex_impact`, and `cortex_rules` tools
  plus five synchronized canonical Cortex behavior skills.
- Bound every invocation to its owning agent workspace and the package-owned
  local Cortex CLI. Cancellation, timeout, malformed output, and output-size
  handling are bounded; installing the bundle does not initialize, update, or
  watch a repository.

### Distribution

- Cortex 2.6.0 publishes only `@danielblomma/cortex-mcp`. Separate npm bundle
  distribution for the DeepSeek Harness integration is deferred and currently
  unavailable.
- Retrieval remains explicit and user-controlled. Proactive V2 retrieval is
  not included in 2.6.0 and remains planned/experimental.

## 2.5.1 — 2026-08-20

### Changed

- Made the packed-artifact release gate accept the successful Node test summary
  emitted by both Node 22 and Node 24 while preserving exact pass counts and
  zero-failure checks. The immutable `v2.5.0` tag was not published after its
  Node 24 gate stopped before npm; the same accepted feature release ships as
  `2.5.1`.

## 2.5.0 — 2026-08-20

### Added

- Added opt-in progressive background indexing for large first-time indexes:
  `cortex bootstrap --background --profile interactive`, followed by
  `cortex indexing status --json`, `cortex indexing pause`, and
  `cortex indexing resume`.
- Added generation-linked ingest, graph, and embedding state. Cortex publishes
  lexical+graph search readiness before semantic completion, writes resumable
  semantic checkpoints atomically, and reports partial semantic coverage
  explicitly.
- Added versioned atomic graph publication with bounded retention. Crash points
  preserve the previous published graph, and a successor generation cannot be
  overwritten by a stale worker.

### Changed

- Foreground `cortex bootstrap` remains the default. The explicit interactive
  profile uses two ingest workers, one embedding session, and four embedding
  threads. It supports macOS, Linux, and WSL; native Windows background mode
  rejects explicitly and retains foreground bootstrap.
- Bound ingest controls, configured and discovered sources, worker and README
  reads, prior caches, all 48 outputs, and dashboard data/npm-cache access to
  regular project-owned paths.
- Stage the complete 48-file output set exclusively, validate the whole set
  before the first rename, replace hard-linked destinations without mutating
  sibling links, clean uncommitted stages, and publish the manifest last.
- Fixed changed-mode matching for safe paths containing repeated separators or
  redundant interior `.` components without changing configured manifest
  spellings or canonical file IDs.
- The frozen Angular run became lexical+graph searchable in 26.751 seconds,
  returned the background CLI in 28.349 seconds, completed semantics in
  290.588 seconds, and resumed after a real SIGTERM from the exact 4,129-record
  checkpoint. Its final 16,314 records are byte- and query-identical to an
  independent foreground control.

### Security

- Reject absolute, parent-relative, backslash-bearing configured source roots,
  drive, UNC, symlinked, redirected, directory, FIFO, socket, and other
  special-node layouts at the source, cache, output, and dashboard boundaries
  with bounded diagnostics. Literal backslashes in discovered POSIX filenames
  remain valid.
- Updated six vulnerable resolutions to fixed same-major versions:
  `hono 4.12.34`, `brace-expansion 5.0.9`, `fast-uri 3.1.5`,
  `ip-address 10.4.0`, `js-yaml 4.3.1`, and `nanoid 3.3.18`.
  Release Bump and Release Publish require zero findings across every
  committed dependency audit and validate the installed packed artifact before
  tagging or publication.

### Upgrade

- Before upgrading, move any external, parent-relative, backslash-bearing
  configured source root, drive/UNC, symlinked, redirected, or special-node
  source/cache/output/dashboard layout to regular project-owned portable
  relative paths. Those formerly unsafe layouts now fail closed. Safe portable
  relative paths and literal backslashes in discovered POSIX filenames need no
  migration.
- Upgrade and refresh an existing project with:

  ```bash
  npm install --global @danielblomma/cortex-mcp@2.5.0
  cortex init --force
  cortex bootstrap
  cortex update
  ```

  If you choose the opt-in background bootstrap instead, wait until
  `cortex indexing status --json` reports `complete` before running
  `cortex update`.

- To opt into progressive first-time indexing, replace the foreground
  `cortex bootstrap` command above with
  `cortex bootstrap --background --profile interactive` and monitor it with
  `cortex indexing status --json`. Wait until status reports `complete` before
  running the final `cortex update`; do not start a competing foreground update
  while background indexing is active.

## 2.4.2 — 2026-07-30

### Changed

- Split the Cortex CLI into cohesive command modules behind the existing
  executable, preserving command names, arguments, streams, exit behavior,
  JSON envelopes, Enterprise trust resolution, and `.context/mcp`
  compatibility.
- Established `scaffold/scripts/lib/ingest/` as the single canonical ingest
  implementation for development and packaged entrypoints. Deterministic
  output, worker fallback, trace checkpoints, and bounded result retention
  remain unchanged.
- Added versioned scaffold ownership and installed fingerprints. Forced
  upgrades remove only unmodified obsolete Cortex-managed files, reject
  modified or unsafe collisions, and preserve unknown files, configuration,
  rules, ontology changes, Enterprise secrets, and agent instructions.
- Extended release synchronization to keep the shipped MCP registry package
  and Node runtime requirement aligned with `package.json`.

### Upgrade

- Upgrade the npm package, then run `cortex init --force`, `cortex bootstrap`,
  and `cortex update`. Projects created before ownership state existed are
  migrated only from hash-verified Cortex 2.4.1 scaffold files.

## 2.4.1 — 2026-07-28

### Security

- Validated remote enterprise skill names, blocked symlink targets, and
  added Cortex ownership markers so personal skill directories cannot be
  overwritten or recursively deleted. Deletion targets are derived from
  managed CLI roots instead of trusting cached absolute paths.
- Bound license-cache reuse to the normalized endpoint and a one-way API-key
  fingerprint. Malformed, future-dated, and expired cache assertions fail
  closed; HTTP 401/403 responses reject authorization without grace.
- Changed enterprise onboarding to read API keys from stdin and atomically
  create `.context/enterprise.yml` with mode `0600`. Remote endpoints require
  HTTPS, with a loopback-only HTTP exception for local development.
- Bound user-global organization artifacts and host process detection to one
  opaque Enterprise credential identity per OS user. A conflicting endpoint
  is rejected, same-endpoint API-key rotation safely purges old marker-owned
  skills and caches, and only one host-wide process scanner runs.
- Moved unattributed process findings into a credential-bound, mode-`0600`
  user-global queue instead of the first project's audit directory.
- Enterprise admin commands now execute only package-owned trusted code.
  Repository runtime modules and project-local state writes never execute with
  root authority; persisted govern paths are not deletion authority.
- Suppressed shared-proxy project audit events when a connection has no
  trustworthy project attribution.
- Added verified socket-based daemon stop/restart. Bootstrap now restarts an
  already-running daemon so the upgraded security code replaces the old
  in-memory runtime, and init repairs preserved Enterprise configs to `0600`.
- Updated the frontend and packaged MCP dependency trees to patched PostCSS,
  SDK, Hono, archive, URI, YAML, protobuf, ONNX ZIP, and Sharp versions. All
  committed npm lockfiles now have a zero-vulnerability audit target.

### Changed

- Replace `sudo cortex enterprise <api-key>` with:

  ```bash
  printf '%s\n' "$CORTEX_API_KEY" |
    sudo cortex enterprise install --api-key-stdin
  ```

- After updating the npm package, run `cortex init --force` and
  `cortex bootstrap`. The latter safely restarts a verified running daemon;
  an npm update alone does not activate this fix in an existing process.
- Existing Enterprise users must then rerun the stdin install to create the
  durable host-identity marker. Confirm
  `cortex enterprise status --json` reports
  `enterprise.host_identity_bound: true`; Cortex never auto-enrolls from a
  repository config.
- The minimum supported runtime is Node.js 20.9 (the first Node 20 LTS
  release), required by the patched native embedding dependency chain.
- Before re-enrollment, review legacy `~/.cortex/skills.local.json` records
  without `credential_id`, back up each exact matching Claude/Codex skill
  directory outside the discovery roots, and back up the state file. Ambiguous
  legacy directories are deliberately not adopted or deleted automatically.

### Rollout and emergency containment

- Do not downgrade to 2.4.0: that reopens the remote skill traversal boundary.
  Use a forward fix.
- Before rollout, back up `.context/enterprise.yml` with ownership and mode
  preserved. After restore, verify the correct owner and run
  `chmod 600 .context/enterprise.yml`.
- If suspicious remote organization content is observed, run
  `cortex daemon stop` and stop Enterprise AI sessions until a forward fix is
  installed. Enforced hooks intentionally fail closed while the daemon is
  unavailable.
- After rollout, verify `cortex daemon status` reports a verified PID,
  `cortex enterprise status` is healthy, the config mode is `0600`, and a
  canary organization sync cannot overwrite an unmanaged personal skill.

## 2.4.0 — 2026-07-13

### Added

- Added a native agent behavior layer: dual plugin manifests (Claude Code +
  Codex), five Cortex skills with trigger descriptions, a cached
  SessionStart bootstrap that survives clear/compaction, and a Claude Code
  marketplace entry.

### Changed

- Upgraded the `cortex init` AGENTS.md section from an update reminder to a
  compact using-cortex bootstrap.

## 2.3.0 — 2026-07-13

### Added

- Added `cortex pattern-evidence <file-path|entity-id>` for cited, structured
  review evidence ordered by same file, module, feature area, and repository
  fallback.
- Integrated bounded, non-blocking pattern context into enterprise
  `context.review` without changing policy pass/fail or workflow trust.

### Changed

- Made equal-score search ordering deterministic with stable entity/path
  tie-breaks.
- Added strict numeric validation for CLI query limits.
- Fixed the enterprise runtime package-version lookup so compiled enterprise
  tools load from the packaged MCP runtime.
- Made `context.review` scope=changed list staged and untracked files in
  repositories without commits instead of falling back to a full project
  walk that ignores `.gitignore`.
- Made pattern review context load the Cortex index once per review instead
  of once per target, and cached the ranking reference-time scan per loaded
  index.
- Unified review path canonicalization and text comparison on the shared
  pattern-evidence and search helpers.

## 2.2.5 — 2026-06-21

### Changed

- Made the default embedding token-budget `auto` mode memory-aware: Cortex
  still starts from the embedding model's maximum context, but degrades to a
  safe cap when local memory headroom is unlikely to fit the full context.

## 2.2.4 — 2026-06-20

### Changed

- Added an explicit embedding token-budget profile and benchmark support for
  `CORTEX_EMBED_MAX_TOKENS`.
- Kept the default `auto` token budget quality-preserving: Cortex uses the
  embedding model's own maximum context unless a numeric cap is explicitly set.
- Reduced embedding memory overhead by avoiding full normalized-text copies for
  cached entities before deciding what needs re-embedding.

## 2.1.0 — 2026-06-11

New features and behavior changes, no API breaks.

### Changed

- **Default embedding model is now `jinaai/jina-embeddings-v2-base-code`**
  (was `Xenova/all-MiniLM-L6-v2`). The old model truncated input at 512
  tokens, which clipped the majority of file-level embeddings in typical
  repositories and made code-oriented queries miss implementation files.
  The jina code model has an 8192-token window. Override with
  `CORTEX_EMBED_MODEL` as before.
- **Embedding input text is no longer character-capped.** The previous
  7000-char entity cap and 2000-char chunk-body preview (and the
  `CORTEX_EMBED_MAX_CHARS` env var) were calibrated for small models. The
  tokenizer's own 8192-token truncation is now the only limit.
  `CORTEX_EMBED_MAX_CHARS` is removed and silently ignored if set.
- **`graph_score` now uses a midrank percentile of relation degree within
  the entity's own type** instead of `min(1, degree/4)`, which saturated at
  degree >= 4 and made the graph ranking weight a constant for nearly every
  entity. Percentiles are type-neutral (every type averages ~0.5), so
  hub-heavy types such as rules cannot drown out leaf code.
- **Default ranking weights changed** to `semantic: 0.55, graph: 0.10,
  trust: 0.20, recency: 0.15` (was `0.40 / 0.25 / 0.20 / 0.15`). Graph
  degree mostly measures how many rules constrain an entity, so it gets low
  weight; this reweighting and the percentile graph_score were benchmarked
  as a pair. **Existing projects keep their per-project `config.yaml` —
  ranking weights are NOT updated automatically.** To adopt the new
  defaults, edit `.context/config.yaml`:

  ```yaml
  ranking:
    semantic: 0.55
    graph: 0.10
    trust: 0.20
    recency: 0.15
  ```

### Added

- **Markdown chunking.** `.md`/`.mdx` files are now chunked into H1–H3
  heading-bounded sections (headings inside fenced code blocks are ignored,
  preamble before the first heading is captured, empty sections are
  skipped). Long sections are window-split with overlap, so prose gets
  overlap while code stays symbol-chunked without it. Queries that target a
  specific document section now return that section chunk directly.
- `rules.yaml` is now preserved on re-scaffold (`cortex init --force`),
  alongside `config.yaml`, so project-specific rules survive upgrades.

### Upgrading an existing project

1. `npm i -g @danielblomma/cortex-mcp@2.1.0`
2. In the project: `cortex init --force` (re-scaffolds `.context/mcp` and
   `.context/scripts`; your `config.yaml`, `rules.yaml`, notes and
   decisions are preserved), then `cortex bootstrap`.
3. `cortex update` — the stored embedding-model id no longer matches, so
   this triggers a **full re-embed automatically**. Cost: roughly 2 minutes
   per 1000 entities plus a one-time download of the jina ONNX model. The
   embeddings file grows (768-dim vectors vs 384).
4. Restart the MCP server (e.g. restart your editor/agent session) — the
   compiled search code only loads on process start.

Known quirk: the MCP server lazy-loads the embeddings file, so the first
search immediately after a re-embed can be served from a stale cache —
re-run the query.

## 2.0.19 and earlier

See git history (`git log --oneline`) and GitHub releases.
