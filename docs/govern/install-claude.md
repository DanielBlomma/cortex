# Claude Code — what `sudo cortex enterprise <key>` installs

Tier 1 (Prevent). Claude Code documents a managed-settings layer that strictly trumps user/project settings. Cortex writes to that layer and locks the relevant escape hatches.

## Files written

| Path | Owner | What it is | Why |
|---|---|---|---|
| `/Library/Application Support/ClaudeCode/managed-settings.json` (macOS) | `root:wheel`, mode `0644` | Hooks + permissions.deny + `allowManagedHooksOnly: true` + `disableBypassPermissionsMode: "disable"` | The Claude Code harness merges this *above* user/project; deny rules are always-wins and `allowManagedHooksOnly` blocks user hooks from loading at all |
| `/etc/claude-code/managed-settings.json` (Linux) | `root:root`, mode `0644` | Same as above | Same |
| `~/.claude/settings.json` | SUDO_USER | User-level hooks (chained under managed) | Backwards-compat with non-managed contexts; redundant in enforced mode but harmless |
| `<project>/.context/enterprise.yml` | SUDO_USER, mode `0644` | API key + base_url + frameworks + govern.mode | Cortex itself reads this for non-Claude-specific things (telemetry, policy) |
| `<project>/.context/govern.local.json` | SUDO_USER, mode `0644` | Per-CLI install record (path, version, frameworks, mode, installed_at) | Read by `cortex enterprise status` and the daemon's sync timer |

## Hooks installed (managed scope)

| Event | Command | What blocks/audits |
|---|---|---|
| `PreToolUse` | `cortex hook pre-tool-use` | Returns `deny` if the tool call violates an active deny-rule; `allow` otherwise. Daemon-down + enterprise → fail-closed (deny). |
| `UserPromptSubmit` | `cortex hook user-prompt-submit` | Audits prompt length only (not contents) for the session timeline. |
| `SessionStart` | `cortex hook session-start` | **Reads `.context/.cortex-tamper.lock`.** In `enforced` mode + lock present → exits 2 → harness blocks the session. Also sends Tier-2 heartbeat. |
| `SessionEnd` | `cortex hook session-end` | Final telemetry flush + last heartbeat. Lets the tracker mark the session ended cleanly (not a tamper candidate). |
| `Stop` | `cortex hook stop` | Per-turn telemetry flush. |
| `PreCompact` | `cortex hook pre-compact` | Audit-only. |

`allowManagedHooksOnly: true` means user-level hooks in `~/.claude/settings.json` cannot replace these. Project-level hooks in `<project>/.claude/settings.json` similarly can't override.

## Deny rules (deduplicated across active frameworks)

The defaults seeded for ISO 27001 / ISO 42001 / SOC 2 (and merged with GDPR/AI Act/NIS 2 if `eu_addons: true`):

```
Bash(cortex hooks *)
Bash(cortex enterprise *)
Bash(cortex govern *)                  # legacy command, still denied to be safe
Edit(/Library/Application Support/ClaudeCode/**)
Write(/Library/Application Support/ClaudeCode/**)
Edit(/etc/claude-code/**)
Write(/etc/claude-code/**)
Edit(~/.claude/settings.json)
Edit(~/.claude/settings.local.json)
Write(~/.claude/settings.json)
Write(~/.claude/settings.local.json)
```

These are the AI's **prevent-self-tampering** rules. Each is tagged with the framework that contributed it; the snapshot export (`?format=json`) carries the attribution under `body.events[*].source_frameworks`.

## What the AI cannot do

- Run `cortex hooks uninstall` or `cortex enterprise uninstall` — `Bash(cortex hooks *)` and `Bash(cortex enterprise *)` are denied.
- Edit `~/.claude/settings.json` to remove the hook entries — `Edit(~/.claude/settings.json)` is denied.
- Run with `--dangerously-skip-permissions` style modes — `disableBypassPermissionsMode: "disable"` in managed settings forbids the harness from honouring it.
- Install user-level hooks that override managed ones — `allowManagedHooksOnly: true` blocks user/project hook loading entirely.

## What the AI **can** still do (and why we accept this)

- **Bash subprocess writes via `cat > ~/.claude/settings.json`.** The Edit-deny only applies to the Edit tool. We mitigate via:
  - `Bash` patterns that explicitly cover `~/.claude/`-affecting commands;
  - the daemon's tamper-tracker (silence in hooks → tamper-lock → next session blocked);
  - Tier 3 process detection (running unwrapped CLIs is logged + SIGTERMed in enforced mode);
  - sandboxing (`sandbox.enabled: true` plus `denyWrite` paths) — recommended for production but not currently auto-enabled.
- **Environment-variable injection that hijacks hook URLs.** Claude Code does not document this attack surface; we treat it as a known residual risk (PLAN.govern-mode.md §7 risk #5).
- **Running Claude Code from outside this project.** `~/.claude/settings.json` only governs the user. Other users on the host need their own `cortex enterprise <key>` install.

## Verifying after install

```sh
sudo cortex enterprise status --verbose
```

Look for the `claude` block:
```
[claude]
  path:           /Library/Application Support/ClaudeCode/managed-settings.json
  kind:           managed-settings.json
  file:           present (1832 bytes)
  version:        abc123def4...
  mode:           enforced
  installed_at:   2026-05-01T...
  frameworks:     iso27001@0.1.0-seed, iso42001@0.1.0-seed, soc2@0.1.0-seed
  deny_rules:     11
```

Verify the file is root-owned:
```sh
ls -la /Library/Application\ Support/ClaudeCode/managed-settings.json
# -rw-r--r--  1 root  wheel  1832 May  1 12:00 ...
```

If the AI can `Edit` the path while in advisory mode, this is operating as designed (advisory = audit only, no block). If the AI can `Edit` the path while in enforced mode, **that's a govern violation** — file an issue with the cortex repo + the Claude Code build version.
