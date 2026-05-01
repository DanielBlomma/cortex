# Migration guide — pre-Fas-1 enterprise → consolidated govern

For organisations that adopted the original `cortex enterprise <api-key>` flow before the Fas 1-8 govern work landed (i.e. running cortex-mcp ≤ v1.7.x with the three-keys `enterprise.yml`).

The user-facing command stays the same:

```sh
sudo cortex enterprise <api-key>
```

But what it writes, and what it requires, changed substantially. This guide enumerates the breaking changes in order of how they affect day-to-day operations.

## TL;DR

| Pre-Fas-1 | Now |
|---|---|
| Three identical `api_key` lines (enterprise/telemetry/policy) in `enterprise.yml` | One `api_key` under `enterprise:`. Loader still reads the legacy fields during migration. |
| Three `endpoint:` lines (one per service) | One `enterprise.base_url`. Per-service paths derived; explicit override via `enterprise.endpoint_<service>` if needed. |
| `cortex enterprise <key>` ran as your user, wrote `.context/enterprise.yml` and `~/.claude/settings.json` | `cortex enterprise <key>` now hard-fails without sudo; with sudo it also writes `/Library/Application Support/ClaudeCode/managed-settings.json` (or `/etc/claude-code/managed-settings.json` on Linux), `/Library/Application Support/Codex/requirements.toml` (or `/etc/codex/requirements.toml`), and `/usr/local/bin/copilot` (PATH-shim). After system writes finish, privileges drop to SUDO_USER for the user-scope hooks + daemon spawn. |
| No tamper detection | Daemon heartbeat-tracker writes `.context/.cortex-tamper.lock` if a session that had hook activity goes silent past `tamper_config.missing_threshold_seconds` (default 300s). In enforced mode, next SessionStart is blocked until `sudo cortex enterprise repair` clears the lock. |
| No process-tree detection | Daemon scans the host process tree every minute. AI binaries (claude / codex / copilot / gemini-cli / aider / cursor) running outside cortex orchestration are logged to `host-events-*.jsonl` and pushed to cortex-web. In enforced mode + same-user, the process is SIGTERMed. |
| Telemetry only | Telemetry + policy + audit + govern config sync + ungoverned + tamper events. All under one API key. |

## Step-by-step migration

Assuming you already have a working pre-Fas-1 enterprise install on a host:

### 1. Back up the old config

```sh
cp .context/enterprise.yml .context/enterprise.yml.pre-govern
```

The new loader reads both old + new schema (legacy fields like `telemetry.endpoint` continue to work). You can keep the old file untouched during the transition; it'll just be re-written when you run the new `cortex enterprise <key>` flow.

### 2. Install the new cortex-mcp

```sh
npm install -g @danielblomma/cortex-mcp@latest
cortex --version  # expect 2.x
```

### 3. Re-run with sudo

```sh
sudo cortex enterprise <your-existing-api-key>
```

What changes between the old run and the new run, in the same project root:

- `.context/enterprise.yml` is rewritten in the new schema (single `api_key`, `base_url`, `compliance.frameworks`, `govern.mode`).
- `/Library/Application Support/ClaudeCode/managed-settings.json` (macOS) appears for the first time. Verify it's owned by `root` with mode `0644`.
- `/Library/Application Support/Codex/requirements.toml` likewise (only if Codex CLI is installed).
- `/usr/local/bin/copilot` becomes a cortex shim (only if Copilot CLI is installed and Copilot CLI is itself elsewhere in PATH).
- `~/.claude/settings.json` still gets the user-scope hooks; ownership stays as your user (privilege drop after system writes).
- `cortex daemon` is now started under your user, not under root.

### 4. Verify

```sh
cortex enterprise status            # compact view
cortex enterprise status --verbose  # full per-CLI detail
```

Look for:
- `Mode: advisory` (default) or `Mode: enforced` (if you opted in).
- One row per AI CLI present on the host. Each row should show `✓ <cli>`, `Tier 1 (Prevent)` or `Tier 2 (Wrap)`, `<n> deny rules`, `mode=...`.
- `Recent activity (last 24h):` — should show `0` for ungoverned and tamper if everything is healthy. `govern_config_unchanged` count grows by 1 per hour as the daemon does its periodic version-check.

### 5. (Optional) Move to enforced mode

`enforced` is opt-in per organisation. To turn it on for a host, edit `.context/enterprise.yml`:

```yaml
govern:
  mode: enforced
```

Then re-apply:

```sh
sudo cortex enterprise sync
```

In enforced mode, **a tamper-lock blocks all subsequent Claude Code sessions on this project until cleared**. Make sure your team is ready to use `cortex enterprise repair` (or has an admin runbook).

## What you must communicate to your developers

Two operational changes affect every developer on a host running govern:

1. **Direct `copilot ...` invocations are now wrapped.** Functionality is unchanged — Copilot's filesystem access to its own config dirs is just denied. If a developer was relying on Copilot to write to `~/.copilot/`, they need to use `--out-dir <somewhere-else>` (or whatever the equivalent is in their workflow). The shim is at `/usr/local/bin/copilot`; the real binary is captured at install time and embedded in the shim's comments. To run Copilot un-wrapped explicitly (for debugging), call the path the shim records.

2. **AI CLIs running outside cortex are detected.** This includes test scripts that invoke `claude --prompt ...` from CI, or local `gemini` invocations. In `advisory` mode it's just logged. In `enforced` mode, the daemon will SIGTERM any same-user AI process not launched via `cortex run` or `cortex enterprise`. Test your CI pipelines before flipping to `enforced`.

## Rollback procedure

If you need to remove the new govern enforcement (e.g. to debug an issue):

```sh
sudo cortex enterprise uninstall --break-glass --reason "rollback to debug X"
```

This:
- removes `/Library/.../managed-settings.json`, `/etc/codex/requirements.toml`, `/usr/local/bin/copilot` shim;
- emits a `tamper_repaired` audit event tagged with the operator's reason;
- leaves `.context/enterprise.yml` untouched (telemetry + policy continue to work).

To fully revert to pre-Fas-1 behaviour, you also need to downgrade cortex-mcp to v1.7.x. Note that the schema is still compatible — the new schema is a superset of the old.
