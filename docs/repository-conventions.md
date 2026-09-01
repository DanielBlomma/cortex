# Repository Convention Profiles

`cortex conventions <path-or-entity> --json` inspects deterministic convention
profiles derived from the current local Cortex index. Profile generation does
not train or call a model, planner, provider, or network service.

## Contract

The profile and manifest schema version is `1`; the generator version is
`repo-conventions-v1`. Profiles are scoped by `repository_id`, indexed
`language`, and the closest available subsystem in this order:

1. an indexed module connected to the file by `CONTAINS`;
2. an indexed project connected by `INCLUDES_FILE`;
3. the file's repository-relative directory.

Only active `source_of_truth: true` rules and directly applicable,
non-superseded ADRs are returned in `authoritative_evidence`, participate in
supersession, or contribute convention claims and conflicts. Documents,
chunks, modules, and projects must be active everywhere they contribute to a
profile: scope selection, exports, targets, citations, callers, relations,
related subsystems, output, and persistence. `conventions` has no inactive or
deprecated-data opt-in. Relations have no eligibility field and grant no
authority by themselves; a relation is usable only when neither endpoint is a
known ineligible record and the consuming subsystem validates its exact live
endpoints. ADR applicability is exact indexed graph evidence:
`CONSTRAINS` from the ADR to a file or subsystem, or `IMPLEMENTS` from that
file or subsystem to the ADR. Prose and path substrings do not grant authority.
An ADR is suppressed only when an active superseder has the same canonical
exact set of applicable files/subsystems. Disjoint and partially overlapping
sets remain independently visible. Self, mutual, and longer active
supersession cycles for one exact applicability set are rejected as invalid
policy graphs; no strongly connected component disappears silently.
Authoritative evidence is never merged into frequency-based facts.
`structural_facts` records observations from exports, tests, and graph
connections. Every fact is explicitly non-normative and informational, and
every fact and reusable symbol cites indexed entities or source spans.

Reusable symbols come only from indexed exports. Their role is assigned from
indexed kind, name, signature, and path fields. Serialized reusable relations
must be genuinely incident on that exact symbol. Symbol-level `CALLS` and
`IMPORTS` edges and file-to-symbol `DEFINES` edges may be retained; a
file-to-file `IMPORTS` edge is not reattributed to every export in the file.
Callers and tests are included only when backed by an exact symbol-incident
relation. Cortex does not synthesize usage requirements from a symbol's name.

An active rule or ADR may declare an exact convention claim with a line of the
form `convention:<key>=<value>`. Active claims with different values are
returned in `conflicts`, and lower-priority contradictory active claims remain
in the same complete claim set. Each conflict serializes its
`governing_priority`, so precedence is explicit without erasure. Every claim
must match one unique authoritative record by source ID, type, priority, and
evidence identity. When more than the version-1 cap are active, the
deterministic `conflicts_omitted` diagnostic reports the exact omitted
conflict count.

## Determinism and persistence

Profiles are stored under `.context/cache/conventions/v1/`. File names,
ordering, canonical JSON, source hashes, profile hashes, and the manifest are
content-derived. Generation timestamps and absolute paths are excluded. An
update rewrites only profiles whose source or graph-dependent inputs changed,
keeps byte-identical profiles untouched, and removes profiles for deleted
scopes.

The state root and each existing descendant component are checked without
following symlinks before creation, read, write, rename, or removal. Manifest
profile paths are canonical values derived from validated profile IDs; a
persisted path never grants independent deletion authority. State leaves must
be single-link regular files. Manifest and profile readers check the complete
ancestor chain, parent, leaf identity, type, link count, and size before a
single byte read, then recheck parent/leaf identity, type, size, returned byte
length, and UTF-8 byte stability after the read. Observable ancestor, leaf,
special-file, replacement, and size swaps therefore fail closed. These checks close stable-layout traversal,
symlink, special-file, and hard-link attacks. Portable Node filesystem APIs do
not provide directory-handle-relative operations on every supported platform,
so a privileged concurrent local mutator can still race the final check and
operation; Cortex rechecks identities and fails closed when that race is
observable, but does not claim complete race elimination.

Persisted and indexed repository paths have one strict canonical grammar:
nonempty repository-relative forward-slash paths with no absolute/drive form,
backslash, repeated separator, trailing separator, `..`, or internal `.`
segment. The single `.` sentinel is allowed only for a root directory scope;
it is never a file identity. User file-path targets use a separate alias
normalizer, so safe spellings such as leading `./`, repeated separators, and
internal `.` segments resolve to that one canonical identity without relaxing
persisted/index validation.

Version-1 limits are part of every profile and manifest:

- 2,000,000 bytes per persisted profile;
- 1,000,000 bytes per persisted manifest, enforced from file metadata before
  every read;
- 1,000,000 bytes per repository control `.context/config.yaml`, enforced
  from file metadata before its single read and rechecked by identity, size,
  and returned byte length after the read;
- 256 profiles per generation;
- 8,000,000 aggregate serialized bytes across generated profiles;
- 4,000,000 bytes per serialized inspection response;
- 100 reusable symbols per profile;
- 20 graph relations per reusable symbol;
- 10 evidence citations per structural fact;
- 5 representative callers and tests per reusable symbol;
- 20 related subsystems and 50 explicit conflicts per profile;
- 1,024 characters per path, 1,000 per identifier, 256 per symbol name, and
  2,000 per signature.

The 10-citation limit applies independently to subsystem evidence,
authoritative applicability, every structural fact, and each retained related
subsystem. Authority and related-subsystem records preserve the complete
pre-cap `observed_count`. Related-subsystem citations are selected
deterministically by relation type before remaining slots are filled, and
`relation_types` is derived only from retained exact evidence. The version-1
`subsystem_evidence_omitted`, `authoritative_evidence_omitted`, and
`related_subsystem_evidence_omitted` diagnostics account for these citation
losses; positive omission values require coherent saturated evidence. The
existing `reusable_relations_omitted` count includes only relations belonging
to the 100 retained symbols, never relations on symbols omitted by the symbol
cap. Each retained reusable symbol records the complete pre-cap
`representative_callers_observed_count` and
`representative_tests_observed_count`. The profile-level
`representative_callers_omitted` and `representative_tests_omitted`
diagnostics are exact sums for retained symbols; a positive value requires the
corresponding five-item array to be saturated.

`source_hash` covers the exact canonical dependency closure consumed by the
builder. In addition to a profile's primary files and governing records, that
closure includes output-affecting external caller/test chunks, relation
endpoints, and the unique active file, chunk, module, project, rule, or ADR
records that back serialized output. It also includes the exact canonical
diagnostic values derived from every pre-cap input, so a transition across a
relation, subsystem, citation, symbol, caller/test, conflict, or malformed-
record cap changes the source hash even when the retained array is unchanged.
Volatile dates are excluded, input order is canonicalized, and unrelated
indexed records are not hashed. A change to external line, metadata, or an
omission count that changes a profile therefore changes its source hash
without making unrelated graph records invalidate it.

Oversized indexed symbol records and capped reusable relations/subsystems or
conflicts are counted in deterministic diagnostics. Malformed, absolute, parent-escaping,
stale, deleted, and symlink targets are rejected. Path strings and indexed
file, chunk, module, and project IDs all use the same backing-filesystem
validation and must resolve to the expected real file or directory without a
symlink in any repository-relative component. Readers recursively validate
all required keys, types, bounds, IDs, canonical paths, uniqueness, and
cross-field invariants before verifying hashes. Standalone profile validation
proves schema, canonical form, internal invariants, and hashes, but cannot
prove indexed meaning without `ContextData`. The context-aware validator
recomputes canonical builder output and requires an exact match before return
or persistence. Persistence requires `ContextData` and the complete canonical
indexed profile set.

Every path-bearing citation is validated before return or persistence. This
includes profile files, subsystem evidence, authoritative ADR paths,
structural facts, reusable symbols, representative callers/tests, and
related-subsystem graph evidence. Each citation must have one unique indexed
backing record, and every cited live path is checked for stale or mismatched
identity, symlink ancestors/leaves, special files, and hard links. Safe
cross-subsystem citations remain valid and need not belong to the selected
profile's `file_ids`. File IDs encode canonical backed paths; symbol paths and
primary evidence agree; representative tests use test paths;
related-subsystem evidence matches the corresponding graph fact; and
subsystem, authority, conflict, manifest, and profile identities are tied
together. Positive omission diagnostics are accepted only when their
corresponding returned arrays are saturated at the versioned cap.

Every reusable relation passes the same exact graph-edge and endpoint
validator. File, chunk, module, and project endpoints require one unique
eligible indexed record and safe live filesystem backing; module/project IDs
must encode their canonical path. Unsupported endpoint shapes are rejected.

The production repository identity read treats `.context/config.yaml` as a
trusted control file only after validating the repository root, `.context`
ancestor, and leaf without following symlinks. Symlinked ancestors/leaves,
special files, hard links, and replaced identities fail closed without
disclosing external contents or link targets. Controls over the versioned
1,000,000-byte limit are rejected from metadata before parsing or persistence.

`cortex conventions` is an inspection command. Its response limit is measured
against the exact pretty-printed public JSON bytes (including `ok`, `command`,
`input`, duplicated context fields, `data`, and the trailing newline) before
profile persistence. Targets are bounded before context loading or profile
work. JSON failures use the same exact byte-budgeted pretty-JSON-plus-newline
policy, include a bounded and sanitized `input`, and never echo an oversized
raw target. Text diagnostics are sanitized and bounded as well. Arbitrary
graph-loader warnings and raw graph exception text are omitted from successful
JSON and text output before either public envelope is constructed. Its success
JSON envelope contains the
versioned profiles, version-1 limits, target, counts, persistence summary, and
local context source. It does not publish a guidance evidence order or define
future task-relevance tiers.

Every public text-bearing string uses one visible-text policy before JSON or
text serialization. C0/C1 controls (including newline, carriage return, DEL,
and terminal escape), Unicode line and paragraph separators (`U+2028` and
`U+2029`), Unicode bidirectional controls, and the same characters inside
identifiers or indexed context are rejected rather than rewritten, so JSON
identities are never silently changed. Rejection is sanitized and occurs
before persistence; the text formatter independently validates its complete
payload before rendering.

Entity targets with `file:`, `chunk:`, `module:`, or `project:` prefixes and
rules/ADRs in either colon or dot form are classified before context access.
They use the 1,000-character identifier limit; path targets use the
1,024-character path limit. Over-limit targets fail before graph loading,
profile generation, or persistence.

The schema version remains `1`. A derived cache manifest containing exactly
the prior version-1 limit keys and values (and only missing
`max_repository_control_bytes`) is augmented in memory and passed through the
complete current manifest validator. Only that otherwise-current manifest is
accepted for migration. Its validated inventory remains authoritative for
stale cleanup: retained profiles are rewritten to current canonical bytes and
deleted scopes are removed. Any partial, reordered, duplicate, altered, or
otherwise invalid manifest continues to fail closed. One persisted inspection
builds and validates the canonical collection once and threads it through
selection and a private trusted persistence path. Observable traversal probes
require exactly one context, one static, and one live-backing validation pass;
public validation and persistence entry points remain defensive.

An empty generated profile set carries the explicitly resolved repository
identity into its manifest instead of falling back to another worktree's
default configuration.
