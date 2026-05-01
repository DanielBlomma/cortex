# Codex CLI — what `sudo cortex enterprise <key>` installs

Tier 1 (Prevent). OpenAI Codex CLI documents `requirements.toml` as an admin-enforced upper-bounds layer that user `~/.codex/config.toml` cannot weaken.

## Files written

| Path | Owner | What it is | Why |
|---|---|---|---|
| `/Library/Application Support/Codex/requirements.toml` (macOS) | `root:wheel`, mode `0644` | `allowed_sandbox_modes`, `allowed_approval_policies`, `permissions.filesystem.deny_read`, `[features].codex_hooks` | Codex enforces these as caps on top of user config |
| `/etc/codex/requirements.toml` (Linux) | `root:root`, mode `0644` | Same as above | Same |

A managed-hooks directory (`hooks.managed_dir`) is **not** auto-populated yet — Codex CLI's hook protocol differs from Claude Code's enough that the cortex hook scripts need a separate adapter. Tracked as a Fas 6 follow-up; in the meantime, Codex enforcement is sandbox + permissions + approval-policy clamping, not tool-call hooks.

## What goes into `requirements.toml`

```toml
# Cortex govern — codex requirements (Phase 3 of PLAN.govern-mode.md).
# Admin-enforced upper bounds. Users cannot weaken these via ~/.codex/config.toml.

allowed_sandbox_modes = ["read-only", "workspace-write"]
allowed_approval_policies = ["untrusted", "on-request"]

[permissions.filesystem]
deny_read = ["~/.codex/config.toml", "~/.codex/hooks.json", "/etc/codex/requirements.toml", ...]

[features]
codex_hooks = true
```

The `deny_read` list is derived from the merged framework bundle. Patterns from `Edit(...)` and `Write(...)` deny rules are projected to filesystem paths (the prefix is stripped, the path inside the parens is kept). Only filesystem-affecting deny-rules contribute; `Bash(...)` rules don't apply to Codex's filesystem layer.

## What the AI cannot do

- **Run with `--dangerously-bypass-approvals-and-sandbox`.** Codex docs do not explicitly say `requirements.toml` blocks this flag — what blocks it functionally is `allowed_sandbox_modes` excluding `danger-full-access` and `allowed_approval_policies` excluding `never`. With both excluded, the flag silently demotes to the strictest combination, which is `workspace-write` + `untrusted`.
- **Edit `~/.codex/config.toml`.** Listed in `deny_read` (which Codex enforces against ALL tool executions including the shell tool, per Codex docs).
- **Edit `/etc/codex/requirements.toml`.** Same.
- **Set arbitrary env vars to influence hook URLs.** Codex respects `shell_environment_policy` if set in `requirements.toml`; we set the conservative default (allow_login_shell = false implicitly via inheriting Codex defaults).

## What the AI **can** still do (residual risk)

- **`--remote ws://...` to bypass local sandbox.** Codex CLI supports connecting to a remote app server; admin controls there are undocumented as of this writing. Cortex Govern Mode treats this as an open gap (§7 risk #2) — recommended mitigation is a network egress proxy or DNS block on non-cortex remote endpoints.
- **`mcp_servers.*` to spawn arbitrary commands via MCP.** If `requirements.toml` doesn't restrict which MCP servers can spawn, a user could launch a permissive MCP. Cortex doesn't currently constrain this in the seed bundle; track and lock down per-customer in the cortex-web framework_bundle if needed.
- **Project-level `.codex/config.toml` if the user marks the project trusted.** This is an opt-in escape hatch by the user; Codex's `trust_level = "trusted"` requires the user to actively flip it. Operator policy: discourage `trusted` projects.

## What's NOT enforced (defer to Tier 3 detection)

Codex hook fail-mode: Codex CLI hooks (when used) are HTTP-fail-open per their docs. We don't rely on Codex hooks for blocking — we rely on the sandbox and deny-read clamps. The cortex daemon's Tier 3 detector still catches Codex sessions running outside `cortex run codex`, even if the user bypassed the wrapping.

## Verifying after install

```sh
sudo cortex enterprise status --verbose
```

Look for the `codex` block:
```
[codex]
  path:           /Library/Application Support/Codex/requirements.toml
  kind:           requirements.toml
  file:           present (412 bytes)
  version:        codex_v1...
  mode:           enforced
  installed_at:   2026-05-01T...
  frameworks:     iso27001@0.1.0-seed, ...
  deny_rules:     6
```

Verify ownership:
```sh
ls -la /Library/Application\ Support/Codex/requirements.toml
```

Read the file's effective state via Codex itself:
```sh
codex requirements show     # if this command exists in your Codex CLI version
```

If it shows your local `~/.codex/config.toml` overriding values that should be capped by `requirements.toml`, that's a Codex CLI version skew — file an issue with the Codex team and consider rolling back to the previous Codex version while it's investigated.

## Known limitation: Windows path

Codex CLI's docs reference `hooks.windows_managed_dir` but don't quote a default for the requirements.toml path on Windows. Cortex Govern Mode's Phase 3 supports macOS and Linux only; Windows lands in a follow-up after we either (a) confirm the Codex Windows path empirically or (b) ask the OpenAI team for the canonical location.
