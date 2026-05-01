# Cortex Govern Mode

Cortex Govern Mode is the non-bypassable enforcement layer that ships as part of `cortex enterprise`. It guarantees — for compliance frameworks like ISO 27001, ISO 42001, SOC 2, GDPR, EU AI Act and NIS 2 — that an AI CLI on a developer's machine cannot remove its own audit trail, weaken its own permissions, or run outside the organisation's policy.

There is no separate `cortex govern` command. **Enterprise IS govern.** A single command sets up the entire stack:

```sh
sudo cortex enterprise <api-key>
```

This document tree explains, in order:

- [migration-guide.md](./migration-guide.md) — moving from pre-Fas-1 enterprise (three-keys YAML, no managed-settings) to the consolidated single-key flow.
- [install-claude.md](./install-claude.md) — what `sudo cortex enterprise <key>` writes for Claude Code, where, and what each rule prevents the AI from doing.
- [install-codex.md](./install-codex.md) — the equivalent for Codex CLI, including the `requirements.toml` admin layer.
- [install-copilot.md](./install-copilot.md) — Tier 2 wrapper details: PATH-shim, OS sandbox profile, `cortex run copilot` semantics, and what bypass attempts look like to Tier 3 detection.
- [compliance-mapping.md](./compliance-mapping.md) — which Cortex Govern mechanism satisfies which framework control. For revisor + procurement.
- [e2e-test-plan.md](./e2e-test-plan.md) — manual end-to-end test checklists per CLI per OS. Exercise these before shipping any change to managed-settings shape, hook protocol, or cursor logic.

## Tier model — which AI CLI gets which protection

| Tier | What it does | Who gets it | Why |
|---|---|---|---|
| **1 — Prevent** | OS-level managed config that user/project settings cannot override; PreToolUse hooks return `deny`; bypass-modes disabled at admin layer | Claude Code, Codex CLI | These CLIs document a managed-config layer the AI cannot reach |
| **2 — Wrap** | Real binary stays untouched; PATH-shim re-execs through `cortex run` which spawns inside `sandbox-exec` (macOS) or `bwrap` (Linux); writes to `~/.copilot/`, `~/.copilot.local/`, `/etc/copilot*` are denied at the OS sandbox layer | Copilot CLI | GitHub does not ship a managed-config layer for Copilot CLI; sandbox is the only mechanism that makes silent reconfiguration impossible |
| **3 — Detect** | Cortex daemon scans the host process tree every minute; AI binaries running outside cortex orchestration are logged to audit; in `enforced` mode, same-user processes are SIGTERMed | Every AI CLI on the host (Claude, Codex, Copilot, Gemini, Aider, Cursor — extensible list) | Catches direct invocations that bypass the shim, brand-new AI CLIs we haven't yet added Tier 1/2 support for |

## Mode model — how strict the enforcement is

| Mode | Audit | Block | Tamper response |
|---|---|---|---|
| `off` | none | none | n/a |
| `advisory` | yes | hooks return `ask`/`allow` with audit | logs only |
| `enforced` | yes | hooks return `deny` for policy violations; SessionStart refuses if tamper-lock is active | SIGTERMs ungoverned same-user processes; `.cortex-tamper.lock` blocks new sessions until `sudo cortex enterprise repair` |

`mode` is read from `enterprise.yml` `govern.mode` and from the per-install record in `.context/govern.local.json`. The strictest applies if they disagree.

## What's ON the wire

The cortex daemon talks to the cortex-web govern endpoints over HTTPS with bearer auth (the same `enterprise.api_key`). What is NOT on the wire:

- No source code
- No prompts
- No tool arguments (only their *types*: tool name, exit status)
- No environment variables (other than the host's OS + version + AI CLIs detected)

What IS on the wire:

- `enterprise.api_key` (Bearer header) — identifies your org
- ETag-bearing `GET /api/v1/govern/config?cli=&frameworks=` — fetches merged managed-settings + deny-rules
- `POST /api/v1/govern/heartbeat` — host_id, OS, AI CLIs detected, govern_mode, active_frameworks, config_version
- `POST /api/v1/govern/applied` — kvittens that managed config was written successfully
- `POST /api/v1/govern/ungoverned` — Tier 3 detection events (host_id, cli, binary, pid, parent_pid, action_taken)
- `POST /api/v1/govern/tamper` — hook-tampering detection (host_id, cli, hook_name, last_seen, missing_seconds)

The privacy boundary is documented in `scaffold/mcp/src/enterprise/privacy/boundary.ts` (version 3 as of v2.x).

## Operator surface

```sh
# Install
sudo cortex enterprise <api-key>
sudo cortex enterprise <api-key> --frameworks iso27001,soc2,gdpr
sudo cortex enterprise <api-key> --no-hooks      # skip Claude Code hooks (rare)
sudo cortex enterprise <api-key> --no-daemon     # don't auto-start daemon

# Inspect
cortex enterprise status                          # compact (no sudo)
cortex enterprise status --verbose
cortex enterprise status --json

# Re-fetch config + re-apply (after cortex-web pushes new bundles)
sudo cortex enterprise sync

# Recover from a detected tamper event
sudo cortex enterprise repair
sudo cortex enterprise repair --reason "Verified that npm-update touched ~/.claude/settings.json on 2026-05-01"

# Remove
sudo cortex enterprise uninstall                                # advisory hosts: just clears it
sudo cortex enterprise uninstall --break-glass --reason "..."   # required if any CLI is in enforced mode

# Runtime wrapper for AI CLIs (mainly used by the auto-installed PATH-shim)
cortex run claude   <args>      # passthrough
cortex run codex    <args>      # passthrough
cortex run copilot  <args>      # OS sandbox wrap
```

## When something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| `cortex enterprise <key>` exits with "requires admin privileges" | not running with sudo | re-run as `sudo cortex enterprise <key>` |
| `Use 'sudo' to elevate (not 'su' or root login)` | running directly as root, no SUDO_USER | log in as your normal user, then `sudo cortex enterprise <key>` |
| SessionStart blocked: "tamper lock active" | hooks were silent for >5min mid-session, daemon flagged it | review `.context/.cortex-tamper.lock`; if benign, `sudo cortex enterprise repair --reason "..."` |
| Status shows `↺ UPDATE AVAILABLE` | cortex-web has a new bundle version | `sudo cortex enterprise sync` |
| `cortex enterprise install` fails with "Copilot CLI not found in PATH" | Copilot binary missing | install GitHub Copilot CLI (`gh copilot extension install` or `npm i -g @github/copilot-cli`), then `sudo cortex enterprise sync` |

For full incident-response playbook see `e2e-test-plan.md` § Recovery scenarios.
