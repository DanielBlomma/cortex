# Copilot CLI — what `sudo cortex enterprise <key>` installs

**Tier 2 (Wrap).** GitHub Copilot CLI does NOT ship a managed-config layer that user/project settings cannot override. The cortex Govern Mode mitigates this with an OS-level sandbox plus a PATH-shim that re-execs all `copilot` invocations through `cortex run copilot`. This is a **practically-non-bypassable** model — strong against drift and AI-driven self-modification, but **not theoretically equivalent** to Claude Code's managed-settings + Codex's `requirements.toml`. See PLAN.govern-mode.md §4.0 Tier-modell + §7 risk #1 for the gap analysis.

## Files written

| Path | Owner | What it is | Why |
|---|---|---|---|
| `/usr/local/bin/copilot` | `root:wheel` (or `root:root`), mode `0755` | Shell shim with `# cortex-shim-v1` marker, embedded comment recording the real binary path captured at install time | Re-execs `cortex run copilot "$@"`. PATH-precedes most user installs of Copilot CLI |

The real Copilot binary is **not moved or modified**. We capture its path and embed it in the shim as a comment. `findRealBinary` walks PATH and skips any entry containing the shim marker, so even after the shim is in place, the real binary is still discoverable.

If `/usr/local/bin/copilot` already exists and is **not** a cortex shim, install **refuses to overwrite** — operator must move/rename the existing file first.

## What `cortex run copilot` does

When the user (or the shim) invokes `cortex run copilot ...`:

1. `findRealBinary("copilot", excludePaths=[shim_path])` resolves to the real Copilot binary in PATH.
2. On macOS: `sandbox-exec -f /tmp/cortex-copilot-<uuid>.sb <real_copilot> ...` with a profile that:
   - Allows default I/O (Copilot keeps working).
   - Denies `file-write*` to `~/.copilot/`, `~/.copilot.local/`, `/etc/copilot*`.
3. On Linux: `bwrap --die-with-parent --ro-bind / / --tmpfs ~/.copilot --tmpfs ~/.copilot.local <real_copilot> ...`.
4. The sandbox profile is generated per-invocation, used, then deleted.
5. Exit code propagates correctly (signal handling: SIGINT/etc on the wrapper kills the wrapped process via `--die-with-parent`).

## What the AI cannot do

- **Edit `~/.copilot/config.json` directly.** OS sandbox denies the write, regardless of which tool the AI used (Edit, Write, or shell `echo > ...`).
- **Reconfigure Copilot to use a different model provider via `~/.copilot/.env`.** Same deny path.
- **Drop a malicious agent file at `~/.copilot/agents/`.** Same.

## What the AI **can** still do (and how we catch it)

- **Run `copilot ...` directly via the real binary path** (e.g. by reading the shim's embedded comment). The Tier 2 protection is gone for that invocation — but the cortex daemon's Tier 3 process scanner sees the unwrapped `copilot` process within ~60 seconds, audits it, and in `enforced` mode SIGTERMs it (same-user only).
- **Spawn `copilot` from a non-PATH location** (e.g. `/opt/some/path/copilot`). Same Tier 3 mitigation.
- **Use `--allow-all` / `--yolo` to skip Copilot's per-tool prompts.** GitHub does NOT expose an admin-level disable for these flags — this is the fundamental limitation of Copilot CLI that motivated Tier 2 in the first place. Audit-only.

## Egress proxy (Phase 4 task 19)

When the cortex daemon is running, it also listens on `127.0.0.1:18888` (configurable via `CORTEX_EGRESS_PROXY_PORT`) as a passive HTTP proxy. `cortex run copilot` automatically sets `HTTPS_PROXY`/`HTTP_PROXY` env vars when spawning the wrapped Copilot binary, so all of Copilot's outbound traffic transits the proxy.

The proxy:

- **Does NOT terminate TLS.** Bytes are piped through transparently. Cortex never sees the request body, response body, or any prompt content.
- **Inspects only the TLS ClientHello SNI** — the destination hostname Copilot is contacting. Logged as `egress_connection` events to `.context/audit/host-events-*.jsonl` with `{ destination: { host, port }, sni, protocol, bytes_client_to_server, bytes_server_to_client, duration_ms, host_id }`.
- **For HTTP (non-CONNECT) requests**, logs the `Host` header in place of SNI.
- **Survives daemon restarts** — the daemon re-binds the port on next start; in-flight connections fail and Copilot retries.

The events flow to cortex-web via the host-events pusher (Fas 7) and surface in `/dashboard/govern` recent activity. A revisor sees per-session destinations (`api.githubcopilot.com`, `api.github.com`, etc) without ever seeing the prompt text — the privacy boundary v3 holds end-to-end.

To disable the proxy entirely (e.g. on a host without internet egress restrictions): set `CORTEX_DISABLE_EGRESS_PROXY=1` in the daemon's environment. To pick a different port: `CORTEX_EGRESS_PROXY_PORT=18889`.

If a developer bypasses `cortex run copilot` and invokes the real Copilot binary directly, their HTTPS_PROXY is unset and the egress is invisible to cortex. Tier 3 detection still catches the unwrapped invocation within ~60s, so the gap is bounded; pair with an OS-level firewall rule that blocks Copilot CLI's outbound traffic except via the proxy if your threat model requires it.

## Effective security posture

For a non-malicious AI, Tier 2 + Tier 3 is fully effective: the AI follows the PATH-shim, runs sandboxed, can't write its own config, and any drift from `cortex run` is caught by the daemon. For a malicious AI determined to bypass:

- Tier 2 alone is bypassable by reading shim → calling real binary directly.
- Tier 2 + Tier 3 + same-user SIGTERM in enforced mode catches the bypass within seconds.
- The audit trail records the bypass attempt (host_id, pid, user, parent_pid, action_taken).

For an AI running as a different user than the cortex daemon, SIGTERM is skipped (cross-user requires root, which the daemon doesn't have). Audit-only in that case.

**Recommendation:** in production, pair Tier 2 with the dev-machine-level egress firewall (block `api.githubcopilot.com` traffic that doesn't go through `HTTPS_PROXY=http://localhost:<cortex-egress-port>`). The egress proxy itself is Phase 4 task 19 and lands as a separate work item.

## Verifying after install

```sh
sudo cortex enterprise status --verbose
```

Look for the `copilot` block:
```
[copilot]
  path:           /usr/local/bin/copilot
  kind:           shim
  file:           present (294 bytes)
  version:        shim-v1
  mode:           enforced
  installed_at:   2026-05-01T...
  shim → real:    /Users/dev/.npm-global/bin/copilot
```

Manually inspect the shim:
```sh
cat /usr/local/bin/copilot
# #!/bin/sh
# # cortex-shim-v1
# # Cortex Tier 2 wrap shim — re-execs through 'cortex run copilot'.
# # Real binary captured at install time: /Users/dev/.npm-global/bin/copilot
# CORTEX="${CORTEX_BIN:-cortex}"
# exec "$CORTEX" run copilot "$@"
```

Test that `copilot` works (it should pass through the wrapper without functional change):
```sh
copilot --help
```

Test that the sandbox denies `~/.copilot/` writes:
```sh
copilot config set ai.model gpt-5  # or whatever Copilot's config command is
# expected: write fails or Copilot reports config-write error
```

If Copilot writes succeed despite the sandbox profile, your macOS version may have a `sandbox-exec` regression — fall back to the manual `chmod -w ~/.copilot` approach until cortex/cortex-mcp rolls out a fix.

## Uninstalling

```sh
sudo cortex enterprise uninstall
```

Removes the shim (after verifying it's still our cortex shim — refuses if it's been replaced by a real binary, e.g. by a `npm install -g @github/copilot-cli` run that landed on `/usr/local/bin/copilot`). The real Copilot binary in its original location is untouched throughout install/uninstall.
