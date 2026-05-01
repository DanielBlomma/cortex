# Compliance mapping — Cortex Govern Mode → framework controls

For revisorer + procurement teams. Each row maps a Cortex Govern mechanism to the control(s) it satisfies in the named framework.

> **This is not legal advice.** Cortex Govern Mode provides mechanisms that *materially help* with the cited controls. Whether your specific deployment satisfies a control in the eyes of an auditor depends on your organisation's overall control environment, your scoping decisions, and your audit firm's interpretation. Always pair this mapping with your own jurist/CISO review.

## How to read this table

- **Mechanism** — the Cortex Govern feature (Tier 1 managed-settings, Tier 2 sandbox, Tier 3 detection, Hook tamper-detect, Audit trail, Snapshot export).
- **Evidence** — the audit trail / artefact that demonstrates the control is in effect (e.g. `cortex enterprise status --json`, signed snapshot export, `host-events-*.jsonl`).
- **Caveat** — known limitations or scope boundaries.

## ISO/IEC 27001:2022

| Control (Annex A) | Cortex mechanism | Evidence | Caveat |
|---|---|---|---|
| **A.5.15 Access control** | Tier 1 deny-rules block AI from editing `~/.claude/settings.json`, `/etc/codex/requirements.toml`, `/Library/Application Support/ClaudeCode/*` | Snapshot `body.hosts[].config_version` + signed JSON; managed-settings-audit table | Bash subprocess writes are residual risk — see install-claude.md |
| **A.5.16 Identity management** | Hosts identified via `host_id` (hostname); enforcement scoped per-organisation via `enterprise.api_key` | `host_enrollment` table; `cortex enterprise status` host_id | host_id collision risk in homogeneous environments |
| **A.5.17 Authentication information** | Single `enterprise.api_key`; HMAC signing for snapshot artefacts | `enterprise.yml` (api_key); signed JSON `signature_algorithm: HMAC-SHA256` | Key rotation has no key_id field yet — Fas 8 reviewer M1, address before GA |
| **A.5.20 Addressing infosec in supplier agreements** | Cortex-web is the supplier touchpoint; bundles cryptographically versioned via ETag | `govern_config_version` table; `If-None-Match` request header logs | — |
| **A.8.16 Monitoring activities** | Tier 3 process detection scans every 60s for AI binaries running outside cortex orchestration | `ungoverned_session_event` table; `host-events-*.jsonl` | Cross-user processes audit-only (no SIGTERM without root) |
| **A.8.20 Networks security** | (When egress-proxy lands — Fas 4 task 19) Cortex egress-proxy logs SNI + destination per AI session | TBD | Currently deferred — flag this control as "in progress" for v2.x audits |
| **A.8.23 Web filtering** | Same as A.8.20 | TBD | Same |
| **A.8.32 Change management** | Govern config bundles versioned via ETag; daemon detects new versions and writes notification; operator-driven re-apply | `govern_config_unchanged` / `_available` / `_sync_failed` events | Daemon does NOT auto-re-apply (requires sudo) — design intent, document for auditors |

## ISO/IEC 42001:2023 (AI management system)

| Control | Cortex mechanism | Evidence | Caveat |
|---|---|---|---|
| **8.2 AI system impact assessment** | Cortex's tier model explicitly classifies each AI CLI's enforcement strength (Tier 1 / 2 / 3); operator runs `cortex enterprise status --json` for current posture | Signed snapshot export | Tier classifications are based on cortex's internal research (PLAN.govern-mode.md §4.0) — auditor should validate the underlying assumptions |
| **8.3 AI system development life cycle** | Govern bundles are versioned and signed; bundle changes flow through cortex-web framework_bundle table with semver | `framework_bundle` table; ETag headers | Currently bundle changes ship via cortex-web admin without semver discipline — track as roadmap |
| **9.3 Performance evaluation: monitoring** | Daemon emits `govern_config_unchanged` heartbeat every hour; Tier 3 detector runs every 60s; tamper detector checks every 60s | `host-events-*.jsonl`; cortex-web event tables | — |
| **A.6.2 Continual evaluation of AI use** | The dashboard at `/dashboard/govern` shows org-wide compliance posture in real time | Dashboard URL, snapshot export | Pure read; doesn't drive remediation directly |
| **A.7.4 Human oversight** | All blocking decisions are mechanism-driven (deny-rules, sandbox, hook exit codes) — not AI-driven | PreToolUse hook source: `hooks/pre-tool-use.ts` | Aligned with the framework's "human in the loop" intent: humans set the rules, the AI cannot self-modify them |

## SOC 2 (Trust Services Criteria)

| Criterion | Cortex mechanism | Evidence | Caveat |
|---|---|---|---|
| **CC6.1 Logical access controls** | Tier 1 deny-rules; Tier 2 sandbox writes-deny | Same as ISO 27001 A.5.15 | Same |
| **CC6.6 Implementation of logical access** | `disableBypassPermissionsMode: "disable"` in managed-settings prevents Claude Code's bypass-mode | managed-settings.json content (stored as audit attachment if needed) | Codex equivalent is `allowed_sandbox_modes` excluding `danger-full-access` — slightly weaker on paper |
| **CC7.2 System monitoring (anomalies)** | Tier 3 ungoverned-session detection | `ungoverned_session_event` table | — |
| **CC7.3 System monitoring (incident response)** | Tamper-lock + `cortex enterprise repair` flow with required `--reason` | `tamper_repaired` audit events; `hook_tamper_event` table | break-glass reason is operator-supplied free text; auditor may want stronger structure |
| **CC8.1 Change management** | Same as ISO 27001 A.8.32 | Same | Same |

## EU GDPR (relevant articles only — only ON if `eu_addons: true`)

| Article | Cortex mechanism | Evidence | Caveat |
|---|---|---|---|
| **Art 5(1)(f) Integrity and confidentiality** | Privacy boundary v3 prohibits sending source code, prompts, or tool args to cortex-web | `boundary.ts` source; outbound payloads only contain repo-name + instance-id + session-id | Auditor may request DPA covering what IS sent (host_id, OS, AI CLIs detected) |
| **Art 30 Records of processing activities** | All audit events tied to org_id, host_id, optional session_id; signed snapshot export gives a tamper-evident record | Signed JSON snapshot | host_id is not directly identifiable but combined with host_enrollment.firstSeen + lastSeen could be |
| **Art 32 Security of processing** | Same as ISO 27001 A.8.16 + A.5.15 | Same | — |

## EU AI Act (relevant articles only — only ON if `eu_addons: true`)

| Article | Cortex mechanism | Evidence | Caveat |
|---|---|---|---|
| **Art 14 Human oversight (high-risk AI)** | Same as ISO 42001 A.7.4 | Same | If your AI usage is high-risk, the mechanism is necessary but not sufficient — full documentation of human review processes is your responsibility |
| **Art 17 Quality management system** | Cortex Govern is itself documented (this docs/govern/ tree); changes ship via versioned bundles | This document | — |
| **Art 19 Automatically generated logs** | Audit trail per session; events retained per `audit.retention_days` (default 90) | `auditLog` table; cortex-web `/dashboard/audit` | 90 days may be insufficient depending on your AI Act risk classification — extend `audit.retention_days` if needed |

## EU NIS 2 (relevant articles only — only ON if `eu_addons: true`)

| Article | Cortex mechanism | Evidence | Caveat |
|---|---|---|---|
| **Art 21 Cybersecurity risk-management measures** | Tier 1+2+3 enforcement; tamper-detect; ungoverned-detect; signed snapshot for incident response | All of the above | NIS 2 has specific incident-reporting timelines that cortex doesn't directly satisfy — pair with your SIEM |
| **Art 23 Reporting obligations** | Audit events have stable schema and include enough metadata (host, cli, action_taken, detected_at) to be ingested by an external SIEM | Snapshot export → SIEM ingestion | We don't ship a SIEM connector — operator's responsibility |

## Frameworks NOT covered by default

The seed bundles ship structure for the six frameworks above (default + `eu_addons`). Cortex Govern Mode does **not** auto-cover:

- HIPAA (US healthcare) — out of scope; bundle could be authored on cortex-web for healthcare orgs
- PCI DSS — same
- FedRAMP — same
- Financial-sector specific (SOX, NYDFS-23) — same

If your organisation needs one of these, the bundle structure (`managed_settings`, `deny_rules`, `tamper_config`) accommodates additional framework_id values — talk to cortex sales about authoring a custom bundle.

## Auditor checklist

For a revisor preparing a SOC 2 / ISO 27001 / 42001 audit covering Cortex Govern Mode:

1. Confirm `cortex enterprise status --json` output matches the host inventory.
2. Pull a signed JSON snapshot. Verify the HMAC signature with the `CORTEX_SNAPSHOT_SIGNING_KEY` (operator provides — separate channel).
3. Inspect the seven managed config files (per-host, per-CLI). Confirm they are root-owned with `0644` permissions.
4. Sample 10 hosts. For each, verify `host_enrollment.last_seen` is within the last 24h.
5. Sample 10 sessions across the audit period. For each, confirm both a `SessionStart` and `SessionEnd` event exist in `auditLog`.
6. Pull `hook_tamper_event` and `ungoverned_session_event` for the audit period. For each non-zero row, confirm there's an operator response within your SLA (typically 7-30 days depending on framework).
7. Pull `managed_settings_audit`. Confirm every `success: false` row has a documented operator follow-up.
8. Inspect the `framework_bundle` table for the active versions. Confirm bundle versions match what's documented in your SOC 2 report.
9. Test the tamper detection: edit `/Library/Application Support/ClaudeCode/managed-settings.json` on a sample host (with operator consent). Confirm `cortex enterprise status` shows `⚠ TAMPER LOCK ACTIVE` within `tamper_config.missing_threshold_seconds + 60s`.
10. Test the recovery: run `sudo cortex enterprise repair`. Confirm `tamper_repaired` event is generated and `host_events-*.jsonl` records the repair.
