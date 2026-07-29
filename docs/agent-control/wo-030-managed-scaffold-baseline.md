# WO-030 Managed Scaffold Ownership Baseline

## Acceptance State

WO-030 is accepted locally on `refactor/cli-ingest-modularization` against the
released `v2.4.1` baseline
`5ae3b00948bad26af2e5eaea60ce0b52567db352`. The package version remains
`2.4.1`; WO-031 owns integrated release readiness and any `2.4.2` metadata.

## Ownership Contract

- `scaffold/ownership/current.json` selects a versioned ownership manifest.
- `scaffold/ownership/v1.json` explicitly inventories 380 managed files,
  protected paths, preserved seed files, and legacy relocation roots.
- Initialized projects persist the installed manifest version and SHA-256
  fingerprints in `.context/scaffold-state.json`.
- A forced upgrade may delete an obsolete path only when the prior
  package-controlled manifest owned it and the installed fingerprint proves it
  is unmodified. A locally modified obsolete file fails the upgrade before any
  cleanup.
- A current managed path may be overwritten only when prior manifest/state
  proves ownership. A newly introduced managed path that collides with an
  unknown file fails closed before cleanup.
- Pre-state `2.4.1` projects are bridged by
  `scaffold/ownership/baseline-v2.4.1.json`, tied to commit `5ae3b0` and exact
  hashes for the three generated files whose bytes changed during WO-027
  through WO-029. Other pre-state files must equal the current package source.
- Legacy root scripts are removed only through an explicit `legacyRoots`
  mapping and exact equality to a current package source or pinned `2.4.1`
  baseline hash. Modified and lookalike same-name project scripts survive.
- `config.yaml`, `rules.yaml`, `ontology.cypher`, both Enterprise YAML
  spellings, `AGENTS.md`, and `CLAUDE.md` are protected from managed ownership.
  Existing files are preserved; Enterprise YAML is mode-hardened to `0600`.

## Filesystem Safety

Manifest, baseline, installed-state, managed, preserved, obsolete, legacy, and
text-helper paths reject non-portable paths, traversal, empty/broad roots,
symlinked components, non-file destinations, and live/legacy target
collisions. Managed and text updates use same-directory temporary files plus
atomic rename, so replacing a project hard link does not truncate an external
inode. Enterprise permission hardening rejects multiply linked configs.

Cleanup never recursively deletes a managed root. Unknown neighboring files
and symlinks are left alone. Every cleanup and copy target is revalidated
immediately before mutation; obsolete content is re-hashed and inode identity
is checked again.

Portable Node filesystem APIs do not expose `openat`/dirfd-relative mutation,
so a same-user process could theoretically swap an ancestor in the final
validation-to-syscall interval. Review accepted this narrow concurrent-mutator
race under the repo-local CLI trust model. Static symlink layouts, target
swaps, hard-link aliases, and ordinary project input are covered and fail
closed.

## Review Iteration

Initial independent review found:

- a new managed target could overwrite an unknown collision;
- an ignored `AGENTS.md` fixture would be missing from a clean checkout;
- legacy cleanup trusted project-controlled marker strings;
- direct copies and permission changes could mutate hard-linked external data;
- pre-state `2.4.1` projects lacked an ownership bridge;
- helper text writes followed a symlinked `.claude` ancestor; and
- `legacyRoots` could collide with live managed targets.

All findings were fixed with negative or migration regressions. Final Code
Quality, Contract, Security and Privacy, Integration, and Validation reviews
report no blocker, major, or minor findings.

## Validation Evidence

- Syntax and focused init/config/agent/migration/ownership/Enterprise matrix:
  59/59.
- Root suite: 81/81 context regressions and 320/320 Node tests.
- MCP suite: 413/413.
- Package/version: `2.4.1` metadata remains synchronized; dry-run package has
  417 files, including the current/versioned/baseline ownership metadata,
  ownership runtime, and all 15 canonical ingest modules.
- Packed install smoke: clean init followed by `init --force` persisted 380
  fingerprints, preserved unknown/config/ontology/agent/Enterprise content,
  repaired Enterprise mode to `0600`, installed all 15 ingest modules, and did
  not copy the unowned stale `dist/embeddingModel.js`.
- The checked-in `2.4.1` worker fixture matches SHA-256
  `5240b2339b152908dba06d349c2190ecca1881b5be4808cf8021f63fb9557aba`
  and passes both pre-state `.context` upgrade and legacy-root migration.
- `git diff --check` and release version synchronization pass.
- Cortex update embedded 129 changed entities, reused 966, and failed zero;
  graph load completed. Pattern evidence succeeded for all nine changed indexed
  code/control files, doctor passed 8/8, and the optional watcher is stopped.

WO-031 must rerun the integrated suites, audits, package extraction,
bootstrap/doctor/update/search smokes, and repeated memory comparison before
changing release metadata.
