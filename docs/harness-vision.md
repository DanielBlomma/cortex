# Cortex Harness Vision

## Goal

Extend Cortex from a context and governance engine into a local-first execution harness for controlled AI-driven software development.

The purpose is not to replace developers.

The purpose is to:
- structure AI execution
- enforce organizational workflows
- integrate validation into execution itself
- make AI-generated code predictable, reviewable, compliant, and safe

---

## Core Philosophy

Traditional AI coding workflows are incomplete.

Most systems work like this:

Generate → Review Later

This creates:
- inconsistent quality
- architectural drift
- duplicated mistakes
- unsafe operations
- missing governance
- weak traceability

Cortex Harness changes this model into:

Generate → Validate Continuously

Validation, testing, review, governance, and policy enforcement become part of the execution loop itself.

---

## Design Principles

The harness must be:

- local-first
- repository-scoped
- lightweight
- secure by default
- policy-driven
- developer-friendly
- enterprise-compatible

No cloud dependency should be required for core functionality.

All execution should be possible locally per repository.

---

## Existing Cortex Foundations

Harness functionality must build on top of existing Cortex components:

- MCP integration
- local daemon
- hooks system
- context engine
- memory system
- rules/policies
- capability controls

The harness should orchestrate these components into a controlled execution runtime.

---

## High-Level Architecture

Developer / AI Client
↓
MCP
↓
Cortex Daemon
↓
Workflow Engine
↓
Hooks + Policies + Capabilities
↓
Validation + Testing + Review
↓
Evidence Trail + Memory

---

## Workflow-Based Execution

Organizations must be able to define AI-driven development workflows.

Example:

Plan
→ Review
→ Build
→ Review
→ Mutation Tests
→ Security Review
→ Human Approval

Each stage may define:
- allowed agents
- required gates
- validation steps
- approval requirements
- compliance checks

---

## State, Memory & Handoffs

Agents start each invocation with an empty context yet must remember what to do.

The resolution is to keep state outside the agent. Each agent invocation is a pure function — the harness owns the state.

Memory lives in three layers, each with a different lifetime:

- Stage envelope — compressed input to a single agent (task spec, prior decisions it needs, capabilities, scope). Lives for one invocation.
- Workflow run — `.agents/<task-id>/`. Holds the stage artifacts (`plan.md`, `review.md`, `changes.md`, `mutation-report.md`, `security-report.md`) and a `state.json` describing where the run is. Everything in the directory is tracked in git, including `state.json`. The daemon writes `state.json` only at stage boundaries — same cadence as the artifacts — so there is no mid-tick churn to clutter `git status`. A developer can resume the run on another machine simply by checking out the branch.
- Cortex memory and rules — long-lived facts (architectural decisions, conventions, prohibited patterns). Lives for the repository's lifetime.

Agents do not read the previous agent's transcript. They read a declared handoff schema that the previous stage produced. This forces structured communication instead of free-form chat history that bleeds bias.

Stage artifacts are markdown files with YAML frontmatter, matching the format Cortex already uses for `SKILL.md`, `MEMORY.md`, and rules. Frontmatter carries the structured fields the harness validates; the body carries the reasoning the next stage actually needs to read. JSON is reserved for daemon-internal bookkeeping (`state.json`, audit events) where there is no human-authored content to preserve.

Example artifact (`.agents/2026-05-06-add-skills-ui/review.md`):

```markdown
---
stage: review
approved: false
blocking_comments: 1
references:
  - plan.md
---

# Review of the plan

The plan is mostly fine, but the migration step needs an IF NOT EXISTS
guard to stay idempotent on re-runs.

## Comments

- migration step needs IF NOT EXISTS guards (blocking)
```

Example flow:

Plan
→ produces plan.md (steps, files, constraints)

Review
→ reads plan.md
→ produces review.md (approved or needs_changes + comments)

Build
→ reads plan.md + review.md
→ produces changes.md (files changed, dist artifacts)

Mutation
→ reads changes.md
→ produces mutation-report.md

Security
→ reads changes.md
→ produces security-report.md

Approval
→ reads every prior artifact (human, not agent)

Why everything lives in `.agents/<task-id>/` and is tracked:

- Code review becomes "I can see the AI's plan, the AI-review of the plan, the diff that implements it, and the security report — all in one PR." That is the harness's evidence trail rendered in the tool engineers already use.
- A developer who switches machines or hands the run off to a colleague resumes by checking out the branch — no separate state to ship around.
- A failed workflow leaves partial artifacts that the developer can either commit (as evidence of what blocked) or `git restore` if they were noise. Failed runs are also evidence.
- Writing `state.json` only on stage boundaries keeps the cadence aligned with the artifacts; there is no daemon-tick churn to fight.

Three of the four building blocks already exist in Cortex:

- Long-lived memory across sessions — provided by the memory system (`MEMORY.md` + per-fact files).
- Facts with trust and recency — provided by rules and the context engine.
- Evidence and audit per run — provided by the audit pipeline (`.context/audit/host-events-*.jsonl`) plus, going forward, the tracked `.agents/` history.
- Workflow state per session — to build.

Workflow state is therefore not a new memory system. It is a thin tracked directory layout under `.agents/<task-id>/` plus an envelope composer in the daemon that builds the agent prompt for each stage, validates the agent's frontmatter against the stage's schema, and writes the artifact plus an audit event.

---

## Continuous Validation

Validation must happen during execution, not after.

The split of responsibility is strict:

- **Cortex defines what must be validated.** Each stage in a workflow declares the validators it requires (mutation testing, security scanning, coverage thresholds, architecture checks, compliance gates) and the criteria those validators must meet.
- **The developer's AI agent runs the validators.** Cortex does not execute test runners, mutators, or scanners itself. The agent — running in the developer's local environment — invokes whatever tooling the validator references and reports the result back through the stage artifact.
- **Cortex enforces that validators were actually run** by checking the produced artifact's frontmatter against the stage's declared validator list. Missing or failed validators block the run unless the developer explicitly overrides (see *Process Enforcement & Overrides* below).

Examples of validators a stage might require (the agent picks the concrete tool):

- architecture validation
- security validation
- unit tests
- mutation tests
- coverage checks
- compliance checks
- review agents
- forbidden action detection

Mutation testing is one example, not the only one — workflows can require any validator that produces a structured pass/fail signal.

Execution should stop automatically if critical validators fail and no override is recorded.

---

## Capability-Based Agent Control

Agents must operate under least-privilege principles.

Capabilities define:
- what an agent may read
- what an agent may modify
- what tools it may use
- what environments it may access

Examples:
- builder-agent may edit src/
- reviewer-agent may only review
- no agent may delete production config
- no agent may access secrets unless explicitly allowed

---

## Policy Hierarchy

Execution must support layered control:

Organization Policy
→ Project Policy
→ Developer Intent

Organization policies define hard restrictions.

Projects define workflows and architecture.

Developers define task intent and local preferences.

---

## Process Enforcement & Overrides

Cortex's role in the harness is to enforce the **way of working** — not to perform the work itself.

What Cortex enforces:

- The right stages run, in the right order, for the right kind of task
- Each stage's required validators are declared and reported on
- Capability gates apply to every tool call inside a stage
- Every stage transition is logged with its artifact and outcome

What Cortex does **not** do:

- Run the validators themselves (the agent does)
- Decide what tooling the agent uses to satisfy a validator (the agent picks)
- Author the actual code, plan, or review (the agent does, the stage envelope tells it what's required)

### Overrides

A developer must be able to override a stage's requirements when their context warrants it — but every override is a recorded deviation from the agreed-upon process, not a silent skip.

Override signals:

- the developer (or their agent on their behalf) explicitly marks a stage as overridden when calling `cortex.workflow.advance`
- the override carries a free-text reason and the list of validators / requirements that were skipped
- the artifact's frontmatter records the override
- a high-evidence audit event is written so reviewers and auditors can see the deviation in the evidence trail
- downstream stages and the final approval stage see the override and can choose to be stricter

The override mechanism exists so the harness stays usable in the messy reality of software work, while still leaving a clear paper trail when someone steps outside ordinary process.

---

## Dashboard Integration

A dashboard should allow organizations to configure:

- workflows
- policies
- rules
- quality gates
- capabilities
- compliance frameworks

The daemon synchronizes these settings locally into each repository.

---

## Evidence Trail

Every execution must produce traceable evidence.

Examples:
- what context was used
- what rules were applied
- what actions were attempted
- what was blocked
- what tests passed
- what reviews succeeded

The goal is enterprise-grade auditability and trust.

---

## End Goal

Cortex should become:

- a controlled AI development runtime
- a governance layer for AI agents
- a local-first execution system for enterprise AI development

The focus is not making models smarter.

The focus is making AI-driven development reliable, scalable, and controllable.
