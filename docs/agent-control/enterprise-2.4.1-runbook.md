# Enterprise 2.4.1 Security Rollout Runbook

## Policy

- Forward-fix first. Never roll back to 2.4.0 because doing so restores the
  remote skill traversal and unsafe deletion behavior.
- Cortex supports one Enterprise endpoint identity per OS user. An explicit
  stdin install may rotate the API key for that endpoint; another endpoint
  requires another OS user boundary.

## Pre-rollout

1. Record the current package version and `cortex daemon status`.
2. Back up `.context/enterprise.yml` (or `.yaml`) while preserving its owner
   and mode. Never print or copy the API key into a shell argument or log.
3. Record the file owner and verify the backup is not group/world readable.
4. Check `~/.cortex/skills.local.json`. If it contains legacy skill records
   without `credential_id`, review every validated `claude:<slug>` and
   `codex:<slug>` entry, then move its matching directory out of
   `~/.claude/skills/` or `~/.codex/skills/` into a private backup. Do not
   delete it and do not automate from an unreviewed path field. Move the
   legacy state file into the same backup after all listed directories are
   accounted for. This prevents pre-marker organization skills from being
   mistaken for personal skills or retained across enrollment.

## Rollout

1. Update `@danielblomma/cortex-mcp`.
2. Run `cortex init --force`. This preserves the Enterprise config contents
   and repairs the mode to `0600`.
3. Run `cortex bootstrap`. This rebuilds the project runtime and, when a
   daemon is running, verifies it through the Cortex socket, requests a clean
   shutdown, waits for exit, and starts the rebuilt daemon.
4. Explicitly enroll the trusted package runtime, even when upgrading an
   existing Enterprise installation:

   ```bash
   printf '%s\n' "$CORTEX_API_KEY" |
     sudo cortex enterprise install --api-key-stdin
   ```

   This creates the user-owned host-identity marker before any host-global
   policy write. It is intentionally never inferred from repository config.
5. Run `cortex update`.

An npm update by itself does not replace an already-running daemon.

## Verification

1. Confirm `cortex daemon status` reports a verified PID.
2. Run `cortex enterprise status --json` and confirm
   `enterprise.host_identity_bound` is `true`, with the expected endpoint and
   enforcement mode.
3. Confirm the Enterprise config owner is the project user and its mode is
   `0600`.
4. Run an organization sync canary and verify an unmanaged skill directory
   with the same name is refused and remains byte-for-byte unchanged.
5. Confirm a project configured with another endpoint/key is rejected by the
   user daemon and cannot change the first identity's organization artifacts.
6. Confirm ungoverned-process findings are written only to the mode-`0600`
   user-global queue under `~/.cortex/host-events/`, not any project's
   `.context/audit`.

For a same-endpoint API-key rotation, rerun the stdin install. Cortex safely
purges marker-owned organization skills and invalidates credential-bound
caches before replacing the identity marker; it then refetches under the new
key. If any legacy or ambiguous skill cannot be proven Cortex-owned, rotation
fails closed and the operator must back it up and reconcile it manually.

## Emergency containment

1. Run `cortex daemon stop`. The CLI will only stop a process whose socket
   handshake and PID agree; it refuses an unrelated live PID.
2. Stop Enterprise AI sessions. Enforced hooks fail closed while the daemon is
   unavailable.
3. Preserve daemon, audit, and sync-state logs for diagnosis.
4. Ship a forward fix, repeat rollout verification, then resume sessions.

## Config restore

Restore only the preserved configuration for the same project and identity.
Reapply the recorded owner and `chmod 600` before starting Cortex. If identity
or ownership cannot be established, keep the daemon stopped and re-enroll
instead of guessing.
