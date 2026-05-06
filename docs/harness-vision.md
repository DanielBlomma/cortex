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
- Workflow state — JSON in `.context/workflow/<session_id>/` plus per-stage artifacts. Lives for one workflow run.
- Cortex memory and rules — long-lived facts (architectural decisions, conventions, prohibited patterns). Lives for the repository's lifetime.

Agents do not read the previous agent's transcript. They read a declared handoff schema that the previous stage produced. This forces structured communication instead of free-form chat history that bleeds bias.

Example flow:

Plan
→ produces plan.json (steps, files, constraints)

Review
→ reads plan.json
→ produces review.json (approved or needs_changes + comments)

Build
→ reads plan.json + review.json
→ produces changes.json (files changed, dist artifacts)

Mutation
→ reads changes.json
→ produces mutation-report.json

Security
→ reads changes.json
→ produces security-report.json

Approval
→ reads every prior artifact (human, not agent)

Three of the four building blocks already exist in Cortex:

- Long-lived memory across sessions — provided by the memory system (MEMORY.md + per-fact files).
- Facts with trust and recency — provided by rules and the context engine.
- Evidence and audit per run — provided by the audit pipeline (`.context/audit/host-events-*.jsonl`).
- Workflow state per session — to build.

Workflow state is therefore not a new memory system. It is a thin file-backed directory layout plus an envelope composer in the daemon that builds the agent prompt for each stage, validates the agent's output against the stage's schema, and writes the artifact plus an audit event.

---

## Continuous Validation

Validation must happen during execution, not after.

Examples:
- architecture validation
- security validation
- unit tests
- mutation tests
- coverage checks
- compliance checks
- review agents
- forbidden action detection

Execution should stop automatically if critical policies fail.

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
