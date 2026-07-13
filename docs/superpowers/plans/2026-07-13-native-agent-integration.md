# WO-023: Native Agent Integration and Session Bootstrap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Cortex behavior layer: a dual-manifest plugin (Claude Code + Codex) with five skills, a cached SessionStart bootstrap that survives clear/compaction, a marketplace entry, and an upgraded `cortex init` AGENTS.md fallback.

**Architecture:** One plugin directory (`plugins/cortex/`) holds both manifests, a shared `skills/` tree, and `hooks/` (Claude Code wiring + a client-neutral Node script). The CLI stays the engine; skills instruct `cortex ... --json`. Versions are kept in sync by extending `scripts/sync-release-version.mjs`.

**Tech Stack:** Plain Node ESM (`.mjs`), `node --test` (root suite), JSON manifests, markdown skills. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-13-native-agent-integration-design.md`
**Branch:** `feat/native-agent-integration` (already created)

**Repo facts the implementer needs:**
- Root tests run via `npm test` whose `test` script lists files EXPLICITLY — new test files must be added to that list in `package.json`.
- Index markers inside a Cortex repo: `.context/db/graph.ryu`, `.context/embeddings/entities.jsonl` (existence) and `.context/hooks/last-update.epoch` (unix seconds, freshness). `.context/cache/` exists for cache files.
- `scripts/sync-release-version.mjs` already supports `.claude-plugin/marketplace.json` (optional entry, `plugins[]` item with `name: "cortex"`), so the marketplace file only needs to be created.
- Existing AGENTS.md installer: `installCodexAgentsSection` in `bin/cortex.mjs` (~line 484); existing test `tests/init-agents.test.mjs` asserts the section contains ``Run `cortex update` `` — keep that line when upgrading.
- Current version everywhere: `2.3.0`.

---

### Task 1: Baton artifacts

**Files:**
- Create: `docs/agent-control/context-packets/013-native-agent-integration.md`
- Modify: `docs/agent-control/agent-work-orders.md` (append row)
- Modify: `docs/agent-control/handoff-ledger.md` (append row)
- Modify: `docs/agent-control/acceptance-matrix.md` (append REQ-12 row)
- Modify: `docs/agent-control/manager-log.md` (append dated note)

- [ ] **Step 1: Create the context packet**

Write `docs/agent-control/context-packets/013-native-agent-integration.md`:

```markdown
# Context Packet 013: Native Agent Integration and Session Bootstrap

Date: 2026-07-13
Work order: WO-023
Requirement: REQ-12
Spec: docs/superpowers/specs/2026-07-13-native-agent-integration-design.md

## Problem

Cortex ships capability (CLI retrieval, MCP tools) but no behavior layer.
Agents forget to use Cortex unless a repo-level CLAUDE.md forces them. A
skill defines when and how a tool is used; the tool alone does not create
the habit (compare Superpowers: skills + session bootstrap + plugin
discovery).

## Scope

- `plugins/cortex/`: add `.codex-plugin/plugin.json`, `skills/` (five
  skills), `hooks/hooks.json`, `hooks/session-start.mjs`.
- `.claude-plugin/marketplace.json` at the repo root.
- `bin/cortex.mjs`: upgrade `installCodexAgentsSection` bootstrap text.
- `scripts/sync-release-version.mjs`: cover the Codex manifest.
- Tests: `tests/session-bootstrap.test.mjs`, `tests/plugin-manifests.test.mjs`,
  `tests/plugin-skills.test.mjs`, extended `tests/init-agents.test.mjs`.

## Non-scope

Copilot/Gemini, retrieval/review logic, REQ-9 changes, external Codex
marketplace submission.

## Constraints

- CLI-first (REQ-9): skills instruct `cortex ... --json`; MCP arrives via
  plugin discovery only.
- The session hook must never fail or noticeably delay a session; silent
  no-op outside Cortex repos.
- Keep ``Run `cortex update` `` in the AGENTS.md section (existing test
  asserts it).
```

- [ ] **Step 2: Append the WO-023 row to `agent-work-orders.md`**

Append to the work-order table:

```markdown
| WO-023 | CLI and Runtime | Ship the native agent behavior layer: dual-manifest plugin (Claude Code + Codex), five Cortex skills, and a cached SessionStart bootstrap that survives clear/compaction. | `plugins/cortex` skills + hooks + dual manifests, `.claude-plugin/marketplace.json`, upgraded AGENTS.md section, extended version sync, session-bootstrap/manifest/skill tests. | New root tests (session bootstrap, plugin manifests, skill lint) plus init-agents, full root and MCP suites, and `release:sync-version --check`. | REQ-12, context packet 013 | Assigned |
```

- [ ] **Step 3: Append the handoff-ledger row**

Append under the template table in `handoff-ledger.md`:

```markdown
| 2026-07-13 | Claude (main session) | WO-023 native agent integration | 013-native-agent-integration | `plugins/cortex/**`, `.claude-plugin/marketplace.json`, `bin/cortex.mjs` (AGENTS.md section), `scripts/sync-release-version.mjs`, `tests/{session-bootstrap,plugin-manifests,plugin-skills,init-agents}.test.mjs` | Pending | Pending | Codex manifest schema verified against official docs during implementation | Open |
```

- [ ] **Step 4: Append the REQ-12 row to `acceptance-matrix.md`**

```markdown
| REQ-12 | Ship a native behavior layer so agents use Cortex automatically: plugin skills with trigger descriptions and a session bootstrap that survives new sessions, clear, and compaction. | Plugin directory has only the MCP manifest; Codex integration is a two-line AGENTS.md section; no skills, hooks, or marketplace entry. | `plugins/cortex` skills/hooks/manifests, root `.claude-plugin/marketplace.json`, `cortex init` AGENTS.md upgrade, `sync-release-version` coverage. | New root tests (session bootstrap, manifests, skill lint); init-agents tests; `release:sync-version --check`; full root + MCP suites. | Not ready |
```

- [ ] **Step 5: Append a manager-log note**

Add under a `## 2026-07-13` heading (create it if missing):

```markdown
- WO-023 assigned (context packet 013): native agent integration and session
  bootstrap on branch `feat/native-agent-integration`. Design spec approved
  by the user; REQ-12 added to the acceptance matrix.
```

- [ ] **Step 6: Commit**

```bash
git add docs/agent-control
git commit -m "Assign WO-023 native agent integration (context packet 013)"
```

---

### Task 2: Session bootstrap script (TDD)

**Files:**
- Create: `plugins/cortex/hooks/session-start.mjs`
- Test: `tests/session-bootstrap.test.mjs`
- Modify: `package.json` (add the test file to the root `test` script list)

- [ ] **Step 1: Write the failing tests**

Create `tests/session-bootstrap.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  findContextDir,
  main,
  readStatus,
  renderBootstrap,
} from "../plugins/cortex/hooks/session-start.mjs";

const SCRIPT_PATH = fileURLToPath(
  new URL("../plugins/cortex/hooks/session-start.mjs", import.meta.url),
);

function makeContextRepo({ indexed = true, epochSeconds = null } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-session-"));
  const contextDir = path.join(repoRoot, ".context");
  fs.mkdirSync(path.join(contextDir, "hooks"), { recursive: true });
  if (indexed) {
    fs.mkdirSync(path.join(contextDir, "db"), { recursive: true });
    fs.writeFileSync(path.join(contextDir, "db", "graph.ryu"), "stub", "utf8");
  }
  if (epochSeconds !== null) {
    fs.writeFileSync(
      path.join(contextDir, "hooks", "last-update.epoch"),
      `${epochSeconds}\n`,
      "utf8",
    );
  }
  return { repoRoot, contextDir };
}

function runScript(cwd) {
  return spawnSync(process.execPath, [SCRIPT_PATH], {
    input: JSON.stringify({ cwd, hook_event_name: "SessionStart" }),
    encoding: "utf8",
  });
}

test("fresh index produces a bootstrap pointing at using-cortex", () => {
  const nowMs = 1_800_000_000_000;
  const { repoRoot } = makeContextRepo({ epochSeconds: Math.floor(nowMs / 1000) - 60 });
  try {
    const contextDir = findContextDir(repoRoot);
    const text = renderBootstrap(readStatus(contextDir, nowMs), nowMs);
    assert.match(text, /Cortex is active/);
    assert.match(text, /using-cortex/);
    assert.match(text, /cortex search/);
    assert.match(text, /Index last updated: \d{4}-\d{2}-\d{2}T/);
    assert.doesNotMatch(text, /cortex bootstrap|more than 7 days/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("stale index adds an update nudge", () => {
  const nowMs = 1_800_000_000_000;
  const eightDaysAgo = Math.floor(nowMs / 1000) - 8 * 24 * 60 * 60;
  const { repoRoot } = makeContextRepo({ epochSeconds: eightDaysAgo });
  try {
    const contextDir = findContextDir(repoRoot);
    const text = renderBootstrap(readStatus(contextDir, nowMs), nowMs);
    assert.match(text, /more than 7 days old/);
    assert.match(text, /cortex update/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("missing index warns and suggests cortex bootstrap", () => {
  const nowMs = 1_800_000_000_000;
  const { repoRoot } = makeContextRepo({ indexed: false });
  try {
    const contextDir = findContextDir(repoRoot);
    const text = renderBootstrap(readStatus(contextDir, nowMs), nowMs);
    assert.match(text, /WARNING: no Cortex index found/);
    assert.match(text, /cortex bootstrap/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("no .context directory yields no output and exit 0", () => {
  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-session-plain-"));
  try {
    assert.equal(findContextDir(plainDir), null);
    assert.equal(main(JSON.stringify({ cwd: plainDir }), plainDir), null);
    const result = runScript(plainDir);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  } finally {
    fs.rmSync(plainDir, { recursive: true, force: true });
  }
});

test("fresh cache is trusted; corrupt cache falls back to recompute", () => {
  const nowMs = 1_800_000_000_000;
  const { repoRoot, contextDir } = makeContextRepo();
  const cachePath = path.join(contextDir, "cache", "session-status.json");
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify({ computed_at_ms: nowMs - 1000, indexed: false, last_update_ms: null }),
      "utf8",
    );
    assert.equal(readStatus(contextDir, nowMs).indexed, false);

    fs.writeFileSync(cachePath, "{not json", "utf8");
    assert.equal(readStatus(contextDir, nowMs).indexed, true);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("expired cache is recomputed", () => {
  const nowMs = 1_800_000_000_000;
  const { repoRoot, contextDir } = makeContextRepo();
  const cachePath = path.join(contextDir, "cache", "session-status.json");
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        computed_at_ms: nowMs - 11 * 60 * 1000,
        indexed: false,
        last_update_ms: null,
      }),
      "utf8",
    );
    assert.equal(readStatus(contextDir, nowMs).indexed, true);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("stdin cwd wins over process cwd and nested dirs resolve upward", () => {
  const { repoRoot } = makeContextRepo({ epochSeconds: 1_700_000_000 });
  const nested = path.join(repoRoot, "src", "deep");
  fs.mkdirSync(nested, { recursive: true });
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-session-other-"));
  try {
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: elsewhere,
      input: JSON.stringify({ cwd: nested }),
      encoding: "utf8",
    });
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(payload.hookSpecificOutput.additionalContext, /Cortex is active/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Add the test file to the root test script**

In `package.json`, append ` tests/session-bootstrap.test.mjs` to the end of the
`node --test ...` file list in the `test` script (single line, space-separated,
same style as the existing entries).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/session-bootstrap.test.mjs`
Expected: FAIL — `Cannot find module .../plugins/cortex/hooks/session-start.mjs`

- [ ] **Step 4: Implement the hook script**

Create `plugins/cortex/hooks/session-start.mjs`:

```javascript
#!/usr/bin/env node
// Claude Code SessionStart hook. Emits a short Cortex bootstrap as
// additionalContext when the session starts inside a Cortex-enabled
// repository. Exits silently (code 0, no output) everywhere else and on
// every error: this hook must never break or delay a session.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CACHE_RELATIVE_PATH = path.join("cache", "session-status.json");
const CACHE_TTL_MS = 10 * 60 * 1000;
const STALE_INDEX_MS = 7 * 24 * 60 * 60 * 1000;

export function findContextDir(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, ".context");
    try {
      if (fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // not here: keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

export function computeStatus(contextDir, nowMs) {
  const indexed =
    fs.existsSync(path.join(contextDir, "db", "graph.ryu")) ||
    fs.existsSync(path.join(contextDir, "embeddings", "entities.jsonl"));
  let lastUpdateMs = null;
  try {
    const epoch = Number.parseInt(
      fs.readFileSync(path.join(contextDir, "hooks", "last-update.epoch"), "utf8").trim(),
      10,
    );
    if (Number.isFinite(epoch) && epoch > 0) {
      lastUpdateMs = epoch * 1000;
    }
  } catch {
    // no update marker: freshness stays unknown
  }
  return { computed_at_ms: nowMs, indexed, last_update_ms: lastUpdateMs };
}

export function readStatus(contextDir, nowMs) {
  const cachePath = path.join(contextDir, CACHE_RELATIVE_PATH);
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const age = nowMs - cached?.computed_at_ms;
    if (typeof cached?.indexed === "boolean" && age >= 0 && age < CACHE_TTL_MS) {
      return cached;
    }
  } catch {
    // missing or corrupt cache: recompute
  }
  const status = computeStatus(contextDir, nowMs);
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, `${JSON.stringify(status)}\n`, "utf8");
  } catch {
    // cache writes are best effort
  }
  return status;
}

export function renderBootstrap(status, nowMs) {
  const lines = [
    "Cortex is active in this repository.",
    "- Use the `using-cortex` skill before answering code questions.",
    '- Search first: `cortex search "<query>" --json`; never answer from memory.',
    '- Check `cortex rules --json` before suggesting changes and `cortex impact "<query>" --json` before refactors.',
    "- Review changed files with `cortex pattern-evidence <file> --json`.",
  ];
  if (!status.indexed) {
    lines.push(
      "WARNING: no Cortex index found. Run `cortex bootstrap` before relying on context.",
    );
  } else if (status.last_update_ms === null) {
    lines.push("Index last updated: unknown.");
  } else {
    lines.push(`Index last updated: ${new Date(status.last_update_ms).toISOString()}.`);
    if (nowMs - status.last_update_ms > STALE_INDEX_MS) {
      lines.push("The index is more than 7 days old. Run `cortex update`.");
    }
  }
  return lines.join("\n");
}

export function main(stdinText, fallbackCwd) {
  let startDir = fallbackCwd;
  try {
    const input = JSON.parse(stdinText);
    if (typeof input?.cwd === "string" && input.cwd.length > 0) {
      startDir = input.cwd;
    }
  } catch {
    // no/invalid stdin payload: fall back to the process cwd
  }
  const contextDir = findContextDir(startDir);
  if (!contextDir) {
    return null;
  }
  const nowMs = Date.now();
  const status = readStatus(contextDir, nowMs);
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: renderBootstrap(status, nowMs),
    },
  });
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    let stdinText = "";
    try {
      stdinText = fs.readFileSync(0, "utf8");
    } catch {
      // stdin unavailable (manual run)
    }
    const output = main(stdinText, process.cwd());
    if (output) {
      process.stdout.write(`${output}\n`);
    }
  } catch {
    // never fail the session
  }
  process.exit(0);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/session-bootstrap.test.mjs`
Expected: PASS, 7/7

- [ ] **Step 6: Commit**

```bash
git add plugins/cortex/hooks/session-start.mjs tests/session-bootstrap.test.mjs package.json
git commit -m "Add cached Cortex session bootstrap hook script"
```

---

### Task 3: Five skills + skill lint test (TDD)

**Files:**
- Test: `tests/plugin-skills.test.mjs`
- Create: `plugins/cortex/skills/using-cortex/SKILL.md`
- Create: `plugins/cortex/skills/repo-research/SKILL.md`
- Create: `plugins/cortex/skills/change-impact/SKILL.md`
- Create: `plugins/cortex/skills/pattern-review/SKILL.md`
- Create: `plugins/cortex/skills/context-review/SKILL.md`
- Modify: `package.json` (add the test file to the `test` script list)

- [ ] **Step 1: Write the failing lint test**

Create `tests/plugin-skills.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_DIR = fileURLToPath(new URL("../plugins/cortex/skills", import.meta.url));
const EXPECTED_SKILLS = [
  "using-cortex",
  "repo-research",
  "change-impact",
  "pattern-review",
  "context-review",
];
const MAX_BODY_LINES = 100;

function parseSkill(skillName) {
  const raw = fs.readFileSync(path.join(SKILLS_DIR, skillName, "SKILL.md"), "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(match, `${skillName}: SKILL.md must start with YAML frontmatter`);
  const frontmatter = Object.fromEntries(
    match[1]
      .split("\n")
      .filter((line) => line.includes(":"))
      .map((line) => [
        line.slice(0, line.indexOf(":")).trim(),
        line.slice(line.indexOf(":") + 1).trim(),
      ]),
  );
  return { frontmatter, body: match[2] };
}

for (const skillName of EXPECTED_SKILLS) {
  test(`skill ${skillName} has trigger frontmatter and a bounded body`, () => {
    const { frontmatter, body } = parseSkill(skillName);
    assert.equal(frontmatter.name, skillName);
    assert.match(frontmatter.description, /^Use when /);
    assert.ok(frontmatter.description.length >= 40, "description too short to trigger well");
    const bodyLines = body.split("\n").length;
    assert.ok(bodyLines <= MAX_BODY_LINES, `body has ${bodyLines} lines (max ${MAX_BODY_LINES})`);
    assert.match(body, /cortex |context\.review/, "body must reference cortex commands");
  });
}
```

- [ ] **Step 2: Add the test file to the root test script**

In `package.json`, append ` tests/plugin-skills.test.mjs` to the `test` script
file list.

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/plugin-skills.test.mjs`
Expected: FAIL — `ENOENT ... plugins/cortex/skills/using-cortex/SKILL.md`

- [ ] **Step 4: Write the five skills**

Create `plugins/cortex/skills/using-cortex/SKILL.md`:

````markdown
---
name: using-cortex
description: Use when starting any conversation or answering any question about code in this repository - establishes that Cortex context must be consulted before answering, and dispatches to the right Cortex skill for research, impact, and review tasks
---

# Using Cortex

Cortex maintains a local, ranked index of this repository (graph, embeddings,
rules). Never answer a code question from memory when Cortex is available.

## The rule

Before answering any question about this codebase, run:

```bash
cortex search "<query>" --json
```

Cite the entity ids and paths you used. If a command fails because there is
no `.context/` directory or no index, say so and suggest `cortex bootstrap`
(first time) or `cortex update` (stale index) instead of guessing.

## Dispatch

| Situation | Skill / command |
|---|---|
| "How does X work?", exploring code | `repo-research` skill |
| Planning a refactor or risky change | `change-impact` skill |
| Reviewing a file or diff | `pattern-review` skill |
| Finalizing a PR or full review | `context-review` skill |
| Architectural constraints | `cortex rules --json` |
| After significant changes | `cortex update` |

## MCP equivalents

If Cortex MCP tools are connected, `context.search`, `context.get_related`,
`context.get_rules`, `context.impact`, and `context.reload` map to the CLI
commands above. Prefer whichever is available; the CLI needs no registration.
````

Create `plugins/cortex/skills/repo-research/SKILL.md`:

```markdown
---
name: repo-research
description: Use when exploring how something works in this repository, locating an implementation, or answering "how/where does X" questions - retrieves cited Cortex context instead of grepping blindly or answering from memory
---

# Repo Research

## Workflow

1. Search: `cortex search "<topic>" --json` — read the top results and their
   scores.
2. Expand: `cortex related <entity-id> --json` on the most relevant hits to
   find callers, dependencies, and neighboring entities.
3. Read: open the cited files at the cited lines before drawing conclusions.

## Rules

- Quote entity ids and `path:line` citations in your answer.
- Two searches with different phrasings beat one; entity names and file
  basenames make good query terms.
- If results look stale or empty, run `cortex update` and retry once.
```

Create `plugins/cortex/skills/change-impact/SKILL.md`:

```markdown
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
```

Create `plugins/cortex/skills/pattern-review/SKILL.md`:

````markdown
---
name: pattern-review
description: Use when reviewing a changed file, diff, or pull request - retrieves repo-local pattern evidence with Cortex so review feedback follows this repository's conventions before generic best practices
---

# Pattern Review

## Workflow

For each changed file:

```bash
cortex pattern-evidence <file-path> --json
```

Evidence is ordered by locality: same file, same module, same feature area,
then repository-wide fallback.

## Rules

- Prefer local evidence: if the same file or module already solves this kind
  of problem, the change should follow that pattern
  (rule.repo_local_pattern_review).
- Cite evidence (`path`, `start_line`-`end_line`) for every pattern claim.
- `local_pattern_found: false` with fallback evidence means weaker claims:
  present repository-wide patterns as suggestions, not conventions.
- Do not invent a pass/fail: pattern evidence is advisory context.
````

Create `plugins/cortex/skills/context-review/SKILL.md`:

```markdown
---
name: context-review
description: Use when finalizing any code review, pull request, or completed change - runs the Cortex review gates so policy rules and pattern evidence are checked before sign-off
---

# Context Review

## Workflow

1. If the enterprise MCP tool `context.review` is available, run it with
   scope `changed` and include its policy results in the review.
2. CLI fallback when MCP is not connected:
   - `cortex rules --json` — verify the change respects active rules.
   - `cortex pattern-evidence <file> --json` for each changed file (see the
     `pattern-review` skill).
3. Report failures verbatim; do not soften failing policies.

## Rules

- Run the review BEFORE declaring work finished, not after.
- `pattern_review` output is non-blocking advisory context; policy failures
  from validators are blocking findings.
- After substantial changes, run `cortex update` so the review sees them.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/plugin-skills.test.mjs`
Expected: PASS, 5/5

- [ ] **Step 6: Commit**

```bash
git add plugins/cortex/skills tests/plugin-skills.test.mjs package.json
git commit -m "Add five Cortex behavior skills with trigger descriptions"
```

---

### Task 4: Manifests, hook wiring, marketplace, version sync (TDD)

**Files:**
- Test: `tests/plugin-manifests.test.mjs`
- Create: `plugins/cortex/hooks/hooks.json`
- Create: `plugins/cortex/.codex-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Modify: `plugins/cortex/.claude-plugin/plugin.json` (description)
- Modify: `scripts/sync-release-version.mjs` (add Codex manifest entry)
- Modify: `package.json` (add the test file to the `test` script list)

- [ ] **Step 1: Verify the Codex plugin manifest schema against the official docs**

Fetch https://developers.openai.com/codex/plugins/build and confirm the
manifest filename/fields for Codex plugins (`.codex-plugin/plugin.json`,
`name`/`version`/`description`, skills auto-discovery, MCP config). If the
schema differs from the JSON in Step 4, adapt Step 4 (and the test in Step 2)
to the documented schema — the shared `skills/` layout and version-sync
requirements stay the same.

- [ ] **Step 2: Write the failing manifest test**

Create `tests/plugin-manifests.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

function readJson(relative) {
  return JSON.parse(
    fs.readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8"),
  );
}

const version = readJson("package.json").version;

test("claude and codex plugin manifests exist and share the release version", () => {
  const claude = readJson("plugins/cortex/.claude-plugin/plugin.json");
  const codex = readJson("plugins/cortex/.codex-plugin/plugin.json");
  assert.equal(claude.name, "cortex");
  assert.equal(codex.name, "cortex");
  assert.equal(claude.version, version);
  assert.equal(codex.version, version);
});

test("marketplace entry lists the cortex plugin at the release version", () => {
  const marketplace = readJson(".claude-plugin/marketplace.json");
  const plugin = marketplace.plugins.find((entry) => entry.name === "cortex");
  assert.ok(plugin, "marketplace must list the cortex plugin");
  assert.equal(plugin.version, version);
  assert.equal(plugin.source, "./plugins/cortex");
});

test("session hook is wired for startup, resume, clear, and compact", () => {
  const hooks = readJson("plugins/cortex/hooks/hooks.json");
  const entries = hooks.hooks.SessionStart;
  assert.ok(Array.isArray(entries) && entries.length > 0);
  const matcher = entries[0].matcher;
  for (const source of ["startup", "resume", "clear", "compact"]) {
    assert.ok(matcher.includes(source), `SessionStart matcher must include ${source}`);
  }
  assert.match(entries[0].hooks[0].command, /session-start\.mjs/);
});

test("mcp config runs the workspace-following npx command", () => {
  const mcp = readJson("plugins/cortex/.mcp.json");
  assert.ok(mcp.mcpServers.cortex, "cortex MCP server must be defined");
});
```

- [ ] **Step 3: Add the test file to the root test script, run, verify it fails**

Append ` tests/plugin-manifests.test.mjs` to the `test` script list in
`package.json`.

Run: `node --test tests/plugin-manifests.test.mjs`
Expected: FAIL — `ENOENT ... .codex-plugin/plugin.json`

- [ ] **Step 4: Create the manifests**

Create `plugins/cortex/hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs\""
          }
        ]
      }
    ]
  }
}
```

Create `plugins/cortex/.codex-plugin/plugin.json` (adapted to Step 1 findings
if needed):

```json
{
  "name": "cortex",
  "version": "2.3.0",
  "description": "Cortex local context: search, impact, rules, and pattern evidence for the active workspace",
  "mcpServers": "./.mcp.json"
}
```

Create `.claude-plugin/marketplace.json`:

```json
{
  "name": "cortex",
  "owner": {
    "name": "Daniel Blomma",
    "email": "daniel.blomma@gmail.com"
  },
  "plugins": [
    {
      "name": "cortex",
      "source": "./plugins/cortex",
      "description": "AI-powered code context: search, impact, rules, and pattern evidence backed by a local index",
      "version": "2.3.0"
    }
  ]
}
```

In `plugins/cortex/.claude-plugin/plugin.json`, update the description:

```json
"description": "Cortex local context: five behavior skills, a session bootstrap, and an optional MCP bridge"
```

- [ ] **Step 5: Extend the version sync script**

In `scripts/sync-release-version.mjs`, add to the `syncPlan` array after the
`plugins/cortex/.claude-plugin/plugin.json` entry:

```javascript
    {
      path: "plugins/cortex/.codex-plugin/plugin.json",
      required: true,
      transform: (value) => syncPluginManifest(value, version)
    },
```

- [ ] **Step 6: Run the tests and the sync check, verify both pass**

Run: `node --test tests/plugin-manifests.test.mjs`
Expected: PASS, 4/4

Run: `node scripts/sync-release-version.mjs --check`
Expected: `[release] metadata is in sync for version 2.3.0`

- [ ] **Step 7: Commit**

```bash
git add plugins/cortex .claude-plugin scripts/sync-release-version.mjs tests/plugin-manifests.test.mjs package.json
git commit -m "Add dual plugin manifests, session hook wiring, and marketplace entry"
```

---

### Task 5: Upgrade the cortex init AGENTS.md section (TDD)

**Files:**
- Modify: `bin/cortex.mjs` (`installCodexAgentsSection`, ~line 484)
- Test: `tests/init-agents.test.mjs` (extend existing)

- [ ] **Step 1: Extend the existing test with failing assertions**

In `tests/init-agents.test.mjs`, inside the test
`"cortex init scaffolds AGENTS.md for Codex-compatible repos"`, after the
existing `assert.match(contents, /<!-- cortex:auto:start -->[\s\S]*Run \`cortex update\`/);`
add:

```javascript
    assert.match(contents, /using-cortex/);
    assert.match(contents, /cortex search "<query>" --json/);
    assert.match(contents, /cortex pattern-evidence/);
```

- [ ] **Step 2: Run the test to verify the new assertions fail**

Run: `node --test tests/init-agents.test.mjs`
Expected: FAIL — `The input did not match the regular expression /using-cortex/`

- [ ] **Step 3: Upgrade the section text**

In `bin/cortex.mjs`, replace the `section` constant inside
`installCodexAgentsSection` with:

```javascript
  const section = `## Cortex Auto Workflow
- Use the \`using-cortex\` skill if available; otherwise follow the commands below.
- Search before answering code questions: \`cortex search "<query>" --json\`; never answer from memory.
- Check \`cortex rules --json\` before suggesting changes and \`cortex impact "<query>" --json\` before refactors.
- Review changed files with \`cortex pattern-evidence <file> --json\` before finalizing.
- Run \`cortex update\` before completing substantial code changes.
- If background sync is enabled, check with \`cortex watch status\`.`;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/init-agents.test.mjs`
Expected: PASS (all tests in the file, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add bin/cortex.mjs tests/init-agents.test.mjs
git commit -m "Upgrade cortex init AGENTS.md section to a using-cortex bootstrap"
```

---

### Task 6: Docs, changelog, full verification, Baton close-out

**Files:**
- Modify: `README.md` (new section after the Quick Start section)
- Modify: `CHANGELOG.md` (new Unreleased section at the top)
- Modify: `docs/agent-control/agent-work-orders.md` (WO-023 status)
- Modify: `docs/agent-control/handoff-ledger.md` (WO-023 row Output/Tests)

- [ ] **Step 1: Add the README section**

After the Quick Start section in `README.md`, add:

````markdown
## Agent plugin (Claude Code + Codex)

The `plugins/cortex` directory is a dual-manifest agent plugin: five behavior
skills (`using-cortex`, `repo-research`, `change-impact`, `pattern-review`,
`context-review`), a SessionStart bootstrap that re-injects Cortex
instructions after new sessions, `/clear`, and compaction (Claude Code), and
an MCP config that follows the active workspace.

Claude Code:

```bash
/plugin marketplace add DanielBlomma/cortex
/plugin install cortex@cortex
```

Codex discovers the same skills through `.codex-plugin/plugin.json`; repos
initialized with `cortex init` also get an AGENTS.md bootstrap section as a
fallback when the plugin is not installed. The CLI remains the engine — the
plugin only adds the behavior layer, and `cortex connect` stays opt-in.
````

- [ ] **Step 2: Add the changelog entry**

At the top of `CHANGELOG.md` (above `## 2.3.0`):

```markdown
## Unreleased

### Added

- Added a native agent behavior layer: dual plugin manifests (Claude Code +
  Codex), five Cortex skills with trigger descriptions, a cached
  SessionStart bootstrap that survives clear/compaction, and a Claude Code
  marketplace entry.

### Changed

- Upgraded the `cortex init` AGENTS.md section from an update reminder to a
  compact using-cortex bootstrap.
```

- [ ] **Step 3: Run the full verification suite**

```bash
npm test
cd scaffold/mcp && npm test && cd ../..
node scripts/sync-release-version.mjs --check
```

Expected: root suite passes (216 pre-existing + the new session-bootstrap,
plugin-skills, plugin-manifests tests), MCP suite passes 367/367, sync check
reports in sync.

- [ ] **Step 4: Update Baton status**

- In `agent-work-orders.md`, change the WO-023 row status from `Assigned` to
  `Implemented locally` and set Validation Evidence to the actual test counts
  from Step 3.
- In `handoff-ledger.md`, update the WO-023 row: Output = `plugin skills,
  hooks, manifests, marketplace, AGENTS.md upgrade`, Tests = actual counts
  from Step 3, Manager Decision stays `Open` (user accepts).
- In `manager-log.md`, append under `## 2026-07-13`:

```markdown
- WO-023 implemented locally on `feat/native-agent-integration`; full root +
  MCP suites and version-sync check passed. Awaiting user review/merge.
```

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/agent-control
git commit -m "Document the agent behavior layer and close out WO-023 locally"
```

---

## Verification checklist (end state)

- [ ] `npm test` (root) passes with the three new test files in the list
- [ ] `cd scaffold/mcp && npm test` passes
- [ ] `node scripts/sync-release-version.mjs --check` passes
- [ ] `node plugins/cortex/hooks/session-start.mjs < /dev/null` inside this
      repo prints a bootstrap JSON; in `/tmp` prints nothing, exit 0
- [ ] Baton rows (WO-023, REQ-12, ledger, manager log) reflect final status
