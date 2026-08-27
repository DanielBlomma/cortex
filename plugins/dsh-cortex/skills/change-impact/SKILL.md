---
name: change-impact
description: Use when planning a refactor, changing shared code, or making any modification whose blast radius is unclear - maps affected entities and traversal paths with Cortex before the first edit
---

# Change Impact

## Workflow

1. `cortex impact "<query-or-entity-id>" --json` — get the blast radius and
   likely traversal paths for the change.
2. `cortex related <entity-id> --json` on the entities you plan to modify —
   find every caller and dependency.
3. `cortex rules --json` — check architectural rules the change must respect.

## Rules

- Summarize the affected surface (files, entities, rules) BEFORE editing.
- A caller you did not list is a caller you will break: verify call sites
  found by impact/related against the actual code.
- Rerun impact after large edits; the change may have altered the radius.
