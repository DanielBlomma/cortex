# All-Language Parser-Backed Codebase-Dialect Program

## Objective

Implement and evaluate a staged proof that tests whether observations from every
existing Cortex programming-language parser materially improve Cortex's ability
to recover task-relevant codebase dialect.

This is an evidence-first program, not a broad product rollout. It uses the
parsers Cortex already has; it does not replace parser technology or add new
language support. It must establish whether the approach works across the full
current programming-language portfolio before Cortex adds a public dialect
command or integrates dialect into code generation and review.

## User Intent And Working Definition

In Cortex, **codebase dialect** means:

> The recurring, locally evidenced structural and implementation patterns that
> show how a particular codebase normally solves a particular kind of problem.

Repository conventions can be discussed at four levels:

1. coding style: formatting, naming, braces, and surface language idioms;
2. structural conventions: how files, classes, functions, modules, ownership,
   and responsibilities are organized;
3. implementation patterns: how comparable problems are solved, including
   abstraction reuse, control flow, call order, data/state representation,
   errors/results/fallbacks, and testing shape; and
4. architectural patterns: system-wide layers, dependency boundaries, events,
   CQRS, and similar principles.

The primary dialect target is levels 2 and 3. Coding style and architecture may
provide evidence, but neither can substitute for recurring structural and
implementation patterns.

The intended product flow is task-conditioned:

```text
Task
  -> find genuinely similar implementations
  -> identify their recurring local patterns
  -> state those patterns with concrete repository evidence
  -> generate a solution that follows them
  -> verify the candidate against the same patterns
```

WO-051 through WO-055 prove the observation and pattern-recovery portion of this
flow in bounded stages. Generation and candidate verification remain later,
separately gated work.

## Durable Starting State

- Planning worktree: `/Users/danielnilsson/GIT/cortex-wo051-dialect-poc`.
- Planning branch: `plan/wo051-dialect-poc`.
- Accepted product base: `e74e03fcb4c864c9e932f20de4ec529568df761d`.
- Package version: `2.5.2`; no version or dependency change is authorized.
- The base contains accepted repository conventions, task guidance, and diff
  review behavior from WO-A through WO-C.
- The discarded WO-D/WO-050 worktree is not a source branch and no file from it
  may be copied into this work order.
- Prior negative learning carried into this packet: a five-task review could not
  obtain profiles through its legacy scaffold path, and the accepted v1 profile
  contract was limited to exported-symbol, test-layout, and graph-connection
  facts. That result is motivation only, not evaluation data for WO-051.
- WO-051 must establish a clean baseline and capability inventory for every
  current programming-language parser before any observation behavior changes.

Start implementation in a fresh session and a separate feature worktree after
this planning packet is accepted. The implementation session receives only this
packet and its direct references.

## Core Hypothesis

Existing language-aware parsers can provide a reliable structured observation
layer, and a task-conditioned comparison over those observations can recover
recurring local structural and implementation patterns more accurately than
current chunk, symbol-name, and call/import context alone.

The hypothesis is false for this work order unless the blinded candidate beats
the frozen baseline while retaining perfect positive-claim citation precision.

## Division Of Responsibility

```text
language parser -> structured local observations with exact source spans
retrieval       -> task-relevant comparable implementations
comparison      -> recurring structural and implementation patterns
output          -> cited, non-normative dialect facts for evaluation
```

An AST node is an observation, not a dialect claim. Cortex may describe a pattern
only after comparable implementations supply repeated local evidence. One-off
syntax, a symbol name, or a generic language best practice receives no dialect
credit.

## Scope

### Languages And Existing Parser Families

The program covers every programming-language family in the canonical parser
registry:

| Family | Existing parser path | Included modes |
|---|---|---|
| JavaScript | Acorn AST | `.js`, `.jsx`, `.mjs`, `.cjs` |
| TypeScript | Acorn plus `acorn-typescript` AST | `.ts`, `.tsx`, `.mts`, `.cts` |
| C | C/C++ Tree-sitter dispatcher with existing fallback | `.c`, `.h` |
| C++ | C/C++ Tree-sitter dispatcher with existing fallback | `.cpp`, `.cc`, `.hpp`, `.hh` |
| C# | existing Roslyn bridge | `.cs` |
| VB.NET | existing Roslyn bridge | `.vb` |
| VB6 | existing lightweight parser | `.bas`, `.cls`, `.frm`, `.ctl` |
| SQL | existing SQL parser | `.sql` |
| Rust | existing Tree-sitter dispatcher with regex fallback | `.rs` |
| Python | existing Tree-sitter parser | `.py` |
| Go | existing Tree-sitter parser | `.go` |
| Java | existing Tree-sitter parser | `.java` |
| Ruby | existing Tree-sitter parser | `.rb` |
| Bash | existing Tree-sitter parser | `.sh`, `.bash`, `.zsh` |

JSX, TSX, headers, shell variants, and other listed modes require deterministic
fixture coverage but are not counted as separate language families. Markdown,
`.config`, `.resx`, and `.settings` remain structured non-code inputs and are
outside this program.

Use each parser's current normal implementation. Do not add grammars, replace
Acorn, Roslyn, Tree-sitter, or lightweight parsers, or change fallback selection.
The shared layer must publish an explicit per-language capability manifest so a
lighter parser can report unsupported observation families rather than
fabricating facts.

### Implementation Placement

The dialect feature belongs at the common parser-result boundary, not inside
Tree-sitter alone:

```text
existing parser implementation
  - Tree-sitter queries and node walkers
  - Acorn/acorn-typescript AST walkers
  - Roslyn syntax walkers
  - existing SQL and VB6 lightweight extraction
              |
              v
shared DialectObservation[] contract
              |
              v
canonical ingest sidecar -> task retrieval -> recurrence comparison
```

Each parser family owns the smallest adapter capable of translating its native
syntax representation into the shared observation contract. Shared Tree-sitter
helpers and queries should be reused by the Tree-sitter languages, but Acorn,
Roslyn, SQL, and VB6 must not be routed through Tree-sitter or reparsed from raw
text by a second parser.

The ingest pipeline consumes one uniform observation array and must not need to
know which parser technology produced it. Cross-example comparison operates on
the shared vocabulary plus retained language-specific shape. Parser capability
gaps remain explicit data; downstream code cannot reinterpret `unsupported` as
absence of a local pattern or as permission to invent one.

### Observation families

Implement a small shared observation vocabulary covering:

1. declaration ownership, nesting, and surrounding file/module structure;
2. ordered calls, delegation, branching, early return, and fallback shape;
3. exception/error/result construction and propagation;
4. state, field, parameter, return, and container representation; and
5. test declaration, setup/fixture, assertion, parameterization, and teardown
   shape when present.

Language-specific observations remain available when normalization would erase
a meaningful local idiom. Every retained observation carries a canonical
repository-relative path, containing chunk identity where available, exact line
span, category, normalized shape, language-specific shape, and stable
content-derived identity.

### Persistence boundary

The contract owner must decide and test one bounded sidecar contract for
observations.
Do not overload graph authority, rules, ADRs, or existing v1 convention facts.
Do not add raw AST persistence. Persist only the minimal normalized observation
and citation data required for deterministic comparison.

The preferred candidate is a versioned JSONL index generated by the canonical
packaged ingest pipeline. If source review proves another existing owned index
is safer and smaller, record that decision before implementation and preserve
the same determinism, containment, and cap requirements.

### Experimental output

Expose the proof through a benchmark-owned evaluator or an explicitly
experimental internal module. Do not add a stable public CLI/MCP contract in
WO-051. Output facts must be:

- task-conditioned and subsystem-local;
- explicitly informational and non-normative;
- supported by at least two concrete unchanged-code citations;
- deterministic and bounded; and
- explicit about absence, insufficient evidence, ambiguity, and omitted counts.

## Sequenced Work Orders

The program is intentionally split so every implementation and review fits a
fresh context window:

1. **WO-051 — contract and harness:** freeze the shared observation schema,
   canonical language/capability manifest, per-family golden fixture format,
   baseline/candidate isolation protocol, caps, containment rules, and blind
   evaluation harness. No parser behavior changes.
2. **WO-052 — Acorn and Tree-sitter adapters:** implement observations for
   JavaScript, TypeScript, C, C++, Rust, Python, Go, Java, Ruby, and Bash using
   their existing parsers and current fallback contracts.
3. **WO-053 — Roslyn and lightweight adapters:** implement observations for C#,
   VB.NET, VB6, and SQL using their existing parsers. C# and VB.NET acceptance
   runs in an environment with the existing .NET toolchain available; final
   all-language evidence cannot count a skip as coverage.
4. **WO-054 — persistence and task-conditioned comparison:** integrate the
   versioned bounded observation sidecar into canonical ingest and implement
   comparable-implementation retrieval plus recurrence comparison without a
   stable public CLI/MCP contract.
5. **WO-055 — blinded all-language evaluation:** freeze new tasks and facets,
   compare the accepted baseline with the candidate, score before reveal, and
   decide whether the all-language dialect hypothesis passes.

Each stage requires its own context packet, feature worktree, fresh session,
focused tests, independent review, and manager acceptance. A failed stage stops
all dependent stages without lowering the gates.

## Blinded Evidence Design

### Fixture selection

- Select at least one fresh real task for every one of the 14 language families.
- A task must have an immutable base commit and at least two genuinely
  comparable unchanged implementations in its local subsystem.
- The evaluator freezes task bindings and base trees before candidate output is
  inspected.
- Tasks, gold facets, issue text, and patches used in prior WO-D/WO-050 work are
  prohibited from final acceptance. They may not be used for tuning.
- Use clean supported bootstrap/index creation. Legacy scaffold migration is a
  separate product concern and must not confound this proof.

### Phase 1: freeze gold from unchanged base code

A blinded evaluator sees only the unchanged local subsystem and tests. It must
freeze at least 56 applicable dialect facets across the 14 tasks, with at least
four facets per language family and coverage across all observation families
that the frozen capability manifest marks applicable.

Each facet records category, exact local statement, scope, criticality, at least
two concrete citations, and why the examples establish recurrence rather than a
one-off. The evaluator must not see issue text, patch bytes, mechanism rubrics,
candidate output, or post-patch code before the gold is hash-frozen.

### Phase 2: freeze the baseline

Run the same clean index and task inputs using current accepted chunks,
embeddings, graph relations, conventions, and guidance, but without candidate
dialect observations. Retain exact output, citations, byte counts, diagnostics,
and hashes.

### Phase 3: freeze the candidate

Run the candidate with the same base tree, source scope, task text, retrieval
budget, and non-dialect index inputs. The only experimental difference is the
new parser-backed observation and comparison path. Retain exact output and hashes
before any patch is revealed.

### Phase 4: score before reveal

For every gold facet, score baseline and candidate as:

- `explicit`: states the task-relevant recurring idiom with sufficient correct
  citations;
- `partial`: finds useful owners/examples but does not state the idiom;
- `absent`: does not expose the facet; or
- `contradicted`: states a conflicting idiom.

Separately score every positive claim for citation validity, recurrence, scope,
and unsupported normativity. Owner discovery and generic semantic retrieval are
reported separately and cannot substitute for dialect recall.

### Phase 5: optional reveal sanity check

After scoring is immutable, a patch may be revealed only to report which frozen
facets it exercised and whether it conformed. Patch correctness cannot increase
dialect recall and is not an acceptance gate for the all-language proof.

## Program Acceptance Gates

The all-language proof passes at WO-055 only if all are true:

1. all 14 language families have an available experimental output, at least one
   exact fresh task, at least four applicable facets, and a complete phase/hash
   chain; JSX/TSX and the other registered syntax modes pass their fixture gates;
2. at least 56 applicable frozen facets complete the full program;
3. candidate aggregate strict recall is at least `0.80`;
4. candidate strict recall is at least `0.60` for every language family;
5. critical-facet strict recall is at least `0.80`;
6. positive-claim citation precision is `1.00`;
7. there are zero contradicted facets and zero unsupported normative claims;
8. candidate aggregate strict recall exceeds the frozen baseline by at least
   `0.30` absolute;
9. every explicit fact has at least two valid unchanged local citations;
10. two clean reruns are byte-identical after canonicalization;
11. observation output is locally contained, bounded, and performs zero model,
    provider, planner, telemetry, or network calls;
12. malformed syntax, unsupported constructs, oversized sources, truncated
    output, and parser unavailability fail explicitly without fabricating facts;
13. every canonical programming-language parser and registered syntax mode
    passes focused observation and existing parser regression tests; and
14. the candidate does not change existing v1 conventions, guidance, review,
    graph, embedding, or chunk output for languages and fixtures outside the
    experimental path.

Failure is a valid result. It stops the next dependent work order and records
whether the problem was parser capability, observation quality,
comparable-implementation retrieval, recurrence comparison, or evaluation
availability. It does not authorize lowering gates or tuning frozen tasks.

## Required Implementation Tests

- Exact unit tests for every applicable observation family in all 14 languages,
  including positive, negative, ambiguous, malformed, nested, and
  language-specific cases.
- Exact capability-manifest tests proving unsupported categories are reported
  and cannot silently become positive dialect claims.
- Parser result and worker-protocol tests proving observations cannot be confused
  with chunks, errors, graph edges, or authoritative policy.
- Full/changed ingest equivalence and stale-observation removal.
- Deterministic ordering, stable IDs/hashes, cap/omission accounting, source-span
  validation, path containment, symlink/hard-link denial where persisted data is
  read or written, and no raw AST serialization.
- Baseline/candidate isolation tests proving the candidate changes only when the
  observation path is enabled.
- Harness tests that reject phase reordering, task/gold mutation, output
  overwrite, citation drift, source-tree drift, and reveal before scoring.

## Validation

During implementation run focused parser, ingest, worker, containment, and
benchmark tests. Before acceptance run:

```text
node --test tests/*parser.test.mjs tests/tree-sitter-*.test.mjs
node --test <new capability, observation, ingest, and benchmark tests>
npm test
(cd scaffold/mcp && npm test)
cortex update
cortex pattern-evidence <every changed file> --json
cortex doctor
cortex watch status
git diff --check
```

If package inventory, ownership, managed scaffold, dependency metadata, or parser
selection must change, stop and split that work into a new packet rather than
silently expanding the active stage.

Required independent reviews: Parser/Code Quality, Contract/Integration,
Security/Containment, and Validation/Evaluation. The gold evaluator and final
reviewer must be different fresh sessions from the implementation owner.

## Non-Goals

- no coding-style inference or formatter replacement;
- no general architectural-policy inference;
- no new programming language or parser migration;
- no replacement of existing Acorn, Tree-sitter, Roslyn, dispatcher, fallback,
  SQL, or VB6 parser behavior;
- no model-generated dialect claims;
- no generated-solution quality claim;
- no candidate diff-review integration;
- no stable CLI/MCP schema or default behavior change;
- no legacy scaffold migration remediation;
- no reuse or retuning of prior WO-D/WO-050 tasks, gold, patches, or harnesses;
- no release, publish, tag, merge, or deployment action.

## Follow-On Roadmap

Only after WO-055 passes:

1. **WO-056 — generation and verification:** compare issue-only/current context
   against all-language dialect context for generated solutions, then verify
   candidates against the same pre-reveal evidence.
2. **Promotion work order:** decide public query/schema stability, v1
   compatibility, scaffold migration, performance budgets, and release/version
   implications only after downstream benefit is demonstrated.

Each follow-on requires its own packet, feature worktree, fresh session,
uncontaminated tasks, and independent review.

## Cleanup Boundary

The discarded worktree `/Users/danielnilsson/GIT/cortex-wo-d-2.5.2` contains no
product changes required by this plan. It must not be used as the WO-051 base.
After this packet and its control rows are reviewed and durably retained, the
old worktree and its branch may be removed as one explicit cleanup operation.

Do not delete individual files from that dirty worktree during WO-051. Before
removal, record its exact path, branch, HEAD, status, and the fact that all
desired product intent is carried by this packet. Worktree and branch removal
are separate destructive actions and require an explicit cleanup decision.

## Direct References

- `docs/agent-control/workflow-playbook.md`
- `docs/agent-control/context-packets/010-repo-local-pattern-review.md`
- `docs/repository-conventions.md`
- `docs/repository-guidance.md`
- `scaffold/scripts/lib/ingest/parser-registry.mjs`
- `scaffold/scripts/lib/ingest/parser-composition.mjs`
- `scaffold/scripts/lib/ingest/pipeline-stages.mjs`
- `scaffold/scripts/parsers/javascript.mjs`
- `scaffold/scripts/parsers/javascript/ast.mjs`
- `scaffold/scripts/parsers/javascript/chunks.mjs`
- `scaffold/scripts/parsers/javascript/calls.mjs`
- `scaffold/scripts/parsers/javascript/imports.mjs`
- `scaffold/scripts/parsers/javascript/patterns.mjs`
- `scaffold/scripts/parsers/javascript/scope-builder.mjs`
- `scaffold/scripts/parsers/javascript/scope-resolver.mjs`
- `scaffold/scripts/parsers/cpp-dispatch.mjs`
- `scaffold/scripts/parsers/cpp-treesitter.mjs`
- `scaffold/scripts/parsers/csharp.mjs`
- `scaffold/scripts/parsers/vbnet.mjs`
- `scaffold/scripts/parsers/vb6.mjs`
- `scaffold/scripts/parsers/sql.mjs`
- `scaffold/scripts/parsers/rust-dispatch.mjs`
- `scaffold/scripts/parsers/rust-treesitter.mjs`
- `scaffold/scripts/parsers/tree-sitter/base.mjs`
- `scaffold/scripts/parsers/python-treesitter.mjs`
- `scaffold/scripts/parsers/go-treesitter.mjs`
- `scaffold/scripts/parsers/java-treesitter.mjs`
- `scaffold/scripts/parsers/ruby-treesitter.mjs`
- `scaffold/scripts/parsers/bash-treesitter.mjs`
- `scaffold/scripts/parsers/tree-sitter/queries/python.chunks.scm`
- `scaffold/scripts/parsers/tree-sitter/queries/python.calls.scm`
- `scaffold/scripts/ingest-worker.mjs`
- `scaffold/scripts/lib/ingest/workers.mjs`
- `scaffold/scripts/lib/ingest/pipeline-stages.mjs`
- `scaffold/mcp/src/conventions.ts`
- `scaffold/mcp/src/guidance.ts`
- `tests/javascript-parser.test.mjs`
- `tests/cpp-treesitter-parser.test.mjs`
- `tests/csharp-parser.test.mjs`
- `tests/vbnet-parser.test.mjs`
- `tests/vb6-parser.test.mjs`
- `tests/sql-parser.test.mjs`
- `tests/rust-treesitter-parser.test.mjs`
- `tests/tree-sitter-base.test.mjs`
- `tests/python-treesitter-parser.test.mjs`
- `tests/go-treesitter-parser.test.mjs`
- `tests/java-treesitter-parser.test.mjs`
- `tests/ruby-treesitter-parser.test.mjs`
- `tests/bash-treesitter-parser.test.mjs`
- `tests/tree-sitter-error-reporting.test.mjs`
- `tests/tree-sitter-robustness.test.mjs`
- `benchmark/bootstrapbench/README.md`

## Start Condition

Do not implement from this planning session. After manager acceptance, create a
new feature worktree from the accepted base plus this packet/control commit and
start WO-051 in a fresh session using only this packet and its direct
references. The first action is to freeze the canonical language inventory,
parser capability matrix, existing output contracts, and per-mode fixtures. Do
not change parser behavior in WO-051.
