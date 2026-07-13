# Agent Control System

This folder is the durable operating memory for agent work in this project.
It exists so the manager does not depend on a long chat context for scope,
decisions, approvals, or handoffs.

## Control Rules

- The manager gates scope, contracts, implementation, validation, staging, and merge.
- Agents receive small context packets from `context-packets/`, not the whole history.
- Every agent handoff is logged in `handoff-ledger.md`.
- Every decision that affects implementation or release is logged in `manager-log.md`.
- Every requirement is tracked in `acceptance-matrix.md`.
- Every unresolved security, privacy, data, or delivery risk is tracked in `risk-register.md`.
- Every merge conflict and resolution decision is tracked in `conflict-ledger.md`.
- Work is executed through `agent-work-orders.md`.
- Every work order goes through review and iteration using `review-iteration-protocol.md`.
- Issue-tracker items mirror milestones and approvals, but this folder keeps the repo-local record.
- Closed history in `manager-log.md` and `handoff-ledger.md` is rotated to `archive/` at day
  rollover; the live files keep only current state and open items, small enough for a fresh
  session to read whole.

## Status Vocabulary

- `Merged` means the PR is merged — not that the work order is accepted.
- `Accepted` means the manager recorded acceptance after review iteration and validation evidence.
- `Complete` means accepted with all evidence gates in the packet closed; any open gate is
  named in the status (e.g. "Merged; run evidence pending").

## Required Gates

1. Scope Gate: the work order names the owned files/entities, affected package
   area (`bin/`, `scaffold/mcp/`, `scaffold/scripts/`, `frontend/`,
   `benchmark/`, release metadata, or docs), and any stacked PR dependency.
2. Contract Gate: MCP tool schemas, CLI flags, config formats, parser outputs,
   release metadata, and static site data contracts are documented before
   implementation changes land.
3. Implementation Gate: touched areas pass their focused local commands:
   root `npm test`; `npm test` in `scaffold/mcp`; `npm run build` and
   `npm audit --audit-level=high` in `frontend`; plus
   `npm run release:check-version-sync` when package or release metadata is in scope.
4. Security and Privacy Gate: changes preserve Cortex's local-first model,
   do not introduce source upload, secrets exposure, or unexpected network
   calls, and respect existing rule/source-of-truth behavior.
5. Release and Deploy Gate: npm package, Claude plugin metadata, Pages
   workflow, and benchmark site changes are validated with the relevant build,
   version sync, and live smoke evidence before acceptance.
6. Merge Gate: conflict ledger is checked, accepted review findings are closed
   or explicitly deferred, PR/work-order traceability is updated, and `main`
   is pushed only after the required gates are green.

## Planning Artifacts

- `workflow-playbook.md`: reusable manager/agent workflow.
- `agent-work-orders.md`: manager backlog of scoped agent assignments.
- `review-iteration-protocol.md`: required first-pass review and iteration loop.
- `conflict-ledger.md`: conflict status, resolution decisions, and validation evidence.
- `context-packets/`: compact packets that keep each agent inside a controlled context window.

## Manager Workflow

1. Create or update a context packet before assigning work.
2. Log the assignment in `handoff-ledger.md`.
3. Assign required reviewers before first-pass work starts.
4. Require the agent to return changed files/entities, tests run, risks, and next decisions.
5. Run review, triage findings, and require iteration for accepted findings.
6. Update `manager-log.md`, `risk-register.md`, `acceptance-matrix.md`, and the PR body.
7. Mirror milestone decisions to the relevant issue-tracker item.
