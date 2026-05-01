# Govern Dashboard — Design Specification

> Cortex is in control. Calm, intelligent, always monitoring.

This document defines the visual language and component contract for the
**Govern dashboard** at `cortex-web/src/app/dashboard/govern/page.tsx`. It
exists so a future implementation pass can apply the design without re-deriving
intent. It does **not** describe data fetching, snapshot semantics, or API
shape — those live in the `cortex-web/src/lib/govern/` and
`cortex-web/src/app/api/v1/govern/` modules.

The dashboard is a **single-screen status surface** for governance. It is read
mostly, scrolled rarely. It must feel like the bridge of a calm ship: nothing
flashing, everything legible at a glance, deep details one click away.

---

## 1 — Brand language

| Trait | Resolution |
| --- | --- |
| Mood | GitHub CLI meets cyberpunk compliance system |
| Surface | Dark, deep slate. Neon gradient accents (purple → indigo → blue → cyan) |
| Lines | Thin (`1px`). Rounded but never soft (`rounded-xl`, not `rounded-3xl`) |
| Density | Modular cards, generous spacing, no clutter |
| Motion | Pulse on live indicators; fade-in on stream entries; **never** bounce/fly |
| Confidence | One sentence per state. Sharp. System voice, not friendly chatbot. |

### Avoid
- Cartoonish mascots, illustrations, emoji decorations
- Loud animations (bouncing, sliding, big scale changes)
- Overloaded layouts; multi-axis scrolling; nested modals
- Corporate blandness (white-on-white cards, generic stock icons)

---

## 2 — Color tokens

### CSS variables (drop into `cortex-web/src/app/globals.css` under `@layer base`)

```css
:root {
  /* Cortex neon palette */
  --cortex-purple: 256 84% 64%;   /* #7B5CFF */
  --cortex-indigo: 244 78% 60%;   /* #5B5BF0 */
  --cortex-blue:   220 92% 60%;   /* #3D7BFF */
  --cortex-cyan:   190 95% 55%;   /* #1ED1F0 */

  /* Surfaces */
  --cortex-bg:        222 32% 6%;    /* near-black slate */
  --cortex-surface:   222 24% 9%;    /* card body */
  --cortex-surface-2: 222 22% 12%;   /* card hover / inner panel */
  --cortex-border:    222 18% 18%;
  --cortex-border-2:  222 18% 26%;

  /* Text */
  --cortex-fg:        210 20% 96%;
  --cortex-fg-muted:  220 12% 64%;
  --cortex-fg-faint:  220 10% 44%;

  /* Semantic state */
  --cortex-running:   158 78% 50%;   /* live green */
  --cortex-ok:        158 70% 46%;
  --cortex-warn:       38 96% 58%;   /* amber */
  --cortex-alert:     352 90% 58%;   /* red */
  --cortex-info:      var(--cortex-cyan);
}

/* Gradient utility */
.cortex-gradient-bg {
  background: linear-gradient(
    135deg,
    hsl(var(--cortex-purple)) 0%,
    hsl(var(--cortex-indigo)) 33%,
    hsl(var(--cortex-blue)) 66%,
    hsl(var(--cortex-cyan)) 100%
  );
}

.cortex-gradient-text {
  background: linear-gradient(
    90deg,
    hsl(var(--cortex-purple)),
    hsl(var(--cortex-cyan))
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.cortex-card {
  background: hsl(var(--cortex-surface));
  border: 1px solid hsl(var(--cortex-border));
  border-radius: 0.75rem; /* matches rounded-xl */
}

.cortex-card-glow {
  box-shadow:
    0 0 0 1px hsl(var(--cortex-border)),
    0 0 24px -8px hsl(var(--cortex-cyan) / 0.18);
}
```

### Tailwind class strings (use these in JSX)

| Purpose | Class string |
| --- | --- |
| Page background | `bg-[hsl(var(--cortex-bg))] text-[hsl(var(--cortex-fg))]` |
| Card | `cortex-card cortex-card-glow p-6` |
| Card title | `text-sm font-medium tracking-wide text-[hsl(var(--cortex-fg-muted))] uppercase` |
| Card metric (large) | `text-3xl font-semibold text-[hsl(var(--cortex-fg))]` |
| Body text | `text-sm text-[hsl(var(--cortex-fg))]` |
| Muted text | `text-sm text-[hsl(var(--cortex-fg-muted))]` |
| Faint text (timestamps) | `text-xs text-[hsl(var(--cortex-fg-faint))]` |
| Running pill | `bg-[hsl(var(--cortex-running))/0.12] text-[hsl(var(--cortex-running))] border border-[hsl(var(--cortex-running))/0.35]` |
| Alert pill | `bg-[hsl(var(--cortex-alert))/0.12] text-[hsl(var(--cortex-alert))] border border-[hsl(var(--cortex-alert))/0.35]` |
| Warn pill | `bg-[hsl(var(--cortex-warn))/0.12] text-[hsl(var(--cortex-warn))] border border-[hsl(var(--cortex-warn))/0.35]` |
| Section divider | `border-t border-[hsl(var(--cortex-border))]` |
| Gradient title (hero only) | `cortex-gradient-text font-semibold tracking-tight` |

> Use the gradient sparingly — the hero "Cortex is running." line and brand
> wordmark only. Everywhere else: solid foreground.

---

## 3 — Layout grid

The dashboard is a **12-column responsive grid** at `lg`, collapsing to 1
column on mobile.

```
container: max-w-[1280px] mx-auto px-6 lg:px-10
grid:       grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8
section:    space-y-8
```

Card spans:

| Section | Mobile | `md` | `lg` |
| --- | --- | --- | --- |
| 1. SystemStatusHero | full | full | `col-span-12` |
| 2. ActivityMonitor | full | `col-span-2` of 2 | `col-span-7` |
| 3. PolicyEngine | full | `col-span-1` of 2 | `col-span-5` |
| 4. AlertsPanel | full | full | `col-span-7` |
| 5. CompliancePanel | full | full | `col-span-5` |
| 6. AuditTrail | full | full | `col-span-12` |
| 7. MetricsRoi | full | full | `col-span-12` (3 cards inside) |

Vertical rhythm: `space-y-8` between section bands, `gap-6` inside a band.

Padding inside cards: `p-6` (default), `p-8` (hero only).

---

## 4 — Section specs

### 4.1 — SystemStatusHero (top, full-width)

The hero answers the question "Is Cortex doing its job right now?" in one
glance.

Layout: horizontal flex, three slots — `[livePulse] [headline+subtext]
[ctaButtons]`.

Live state copy:

| State | Headline | Subtext | Pulse color |
| --- | --- | --- | --- |
| running (default) | `Cortex is running.` | `Monitoring AI activity. No violations detected.` | `--cortex-running` |
| running with active scan | `Cortex is running.` | `Agents connected. Policies armed.` | `--cortex-running` |
| alert | `Tamper-lock engaged.` | `<n> violations in the last 24h. Review required.` | `--cortex-alert` |
| degraded | `Cortex is reduced.` | `Audit pipeline disconnected. Retrying.` | `--cortex-warn` |
| paused / break-glass | `Cortex is paused.` | `Break-glass active by <user> · "<reason>"` | `--cortex-warn` |
| unconfigured | `Cortex is idle.` | `No license loaded. Run cortex enterprise <api-key>.` | `--cortex-fg-faint` |

Headline: `text-3xl lg:text-4xl font-semibold` with the gradient utility on the
running state only. Other states: solid foreground in their state color.

Subtext: `text-sm text-[hsl(var(--cortex-fg-muted))]`.

CTA slot (right-aligned): two buttons max — typically
"View activity" (link to `#activity`) and "Run sync" (kebab menu for actions).
Buttons: thin border, transparent fill, gradient text on hover.

Live pulse: `<LivePulse state="running" />` (see component contract). 14px dot
on a 28px halo, halo softly pulses 2s linear infinite.

### 4.2 — ActivityMonitor

Real-time event feed. Streamed log of agent activity (Claude, Codex, Copilot
events).

Structure:
- Card title: `Activity` · subtitle `Live feed`.
- Right-aligned filter chips: `All · Claude · Codex · Copilot`.
- Body: virtualized list, max 12 rows visible, fade-out gradient at bottom.
- Each row: `[icon] [agent] [action] [target] [duration] [timestamp]`.

Row variants:
- `ok`: cyan dot icon. Plain text.
- `anomaly`: amber dot icon. Background tint
  `bg-[hsl(var(--cortex-warn))/0.06]`, left border `border-l-2`
  `border-[hsl(var(--cortex-warn))]`. Brief one-word reason badge
  (e.g. `unusual-write`).
- `violation`: red dot, similar emphasis with alert color.

Empty state copy: `No recent activity. Cortex is monitoring.`
(Never "No data".)

New-row animation: 180ms `ease-out`, `opacity 0→1`, no Y translate. Subtle.

### 4.3 — PolicyEngine

Compact card. Three rows:

```
Active rules        ⟶  <bigNumber>     status pill: armed
Violations (24h)    ⟶  <bigNumber>     status pill: ok | warn | alert
Enforcement         ⟶  enforced | advisory | off    state pill
```

Big number: `text-3xl font-semibold` aligned right. Label left.

Below: a thin progress strip (`h-1`) representing rule coverage by framework
(stacked horizontal segments tinted with each framework's brand-neutral hue).
Hover tooltip: `<framework>: <n> rules`.

Footer link: `Manage policies →` (muted, hover gradient).

### 4.4 — AlertsPanel

Structured card listing the most recent **unresolved** alerts. State by row,
not by panel — even a green panel still shows the last 3 events for context.

Each alert row:
```
[severity glyph]  <RULE_ID>           <action_taken>
                  <file_path>         <timestamp>
                  <one-line reason>
```
- Severity glyphs: `●` red (alert), `▲` amber (warn), `✓` green (resolved).
- File path is `font-mono text-xs`.
- Action taken is a small pill: `blocked`, `warned`, `logged`, `sigterm`.
- Hover: row inset background `bg-[hsl(var(--cortex-surface-2))]`.

Empty state: large green check + `No violations detected.`

Footer: `View all in audit trail →`.

### 4.5 — CompliancePanel (important)

Grid of framework cards — one card per framework. Use `grid grid-cols-2 gap-3`
inside the section card.

Frameworks (in this order):
1. ISO 27001 — Information security management
2. ISO 42001 — AI management system
3. SOC 2 — Trust services criteria
4. GDPR — EU data protection
5. AI Act — EU AI regulation
6. NIS 2 — Network and information security

Each framework cell:
```
┌────────────────────────────┐
│ ISO 27001            ✓     │
│ Information security mgmt  │
│ ─────────────────────────  │
│ 14 rules · 0 violations    │
│ Status: covered            │
└────────────────────────────┘
```

Cell shell: `cortex-card p-4 flex flex-col gap-2`.
Status badge (top-right): `covered` (green pill) | `partial` (amber) |
`uncovered` (faint grey, never red — uncovered is a configuration choice, not
a failure).

Title: `text-sm font-medium`. Subtitle: muted. Stats row: `text-xs text-muted`.
Status footer: small pill aligned left.

Hover: subtle gradient outline (`box-shadow: 0 0 0 1px hsl(var(--cortex-cyan)
/ 0.4)`). No scale change.

### 4.6 — AuditTrail

Wide card. Full-width below alerts/compliance.

- Title: `Audit Trail` · subtitle `Immutable · who · what · when`.
- Toolbar: search input (left), date-range picker, `Export CSV` button (right).
- Table columns: `Time | Actor | Action | Target | Result | Hash`.
- `Hash` is a 7-char monospace prefix; click to copy full hash. Tiny clipboard
  glyph appears on hover.
- Rows alternate background subtly: even rows `bg-transparent`, odd rows
  `bg-[hsl(var(--cortex-surface-2))/0.5]`.
- Footer: pagination controls (`← Newer | Older →`) + total count.

Empty state: `No audit events yet. Run an action to start the trail.`

### 4.7 — MetricsRoi

Three small KPI cards in a row at the bottom (`grid grid-cols-1 md:grid-cols-3
gap-6`).

| Card | Metric | Sub-label |
| --- | --- | --- |
| Tokens saved | `<n>k` | `vs. ungoverned baseline · last 30d` |
| Violations prevented | `<n>` | `Blocked or warned · last 30d` |
| Agent activity volume | `<n>` | `Events processed · last 30d` |

Each card: big number gradient-text on hover; 7-day sparkline below the metric
in cyan; subtle border. No bar charts, no axes, no legends.

---

## 5 — Animation specs

All animations are **subtle**. Total motion budget per page: ≤ 3 simultaneous
animations.

### Pulse (live indicator)

```css
@keyframes cortex-pulse {
  0%, 100% { opacity: 0.55; transform: scale(1); }
  50%      { opacity: 1;    transform: scale(1.08); }
}

.cortex-pulse {
  animation: cortex-pulse 2s ease-in-out infinite;
}

.cortex-pulse-halo {
  animation: cortex-pulse 2s ease-in-out infinite;
  filter: blur(6px);
  opacity: 0.4;
}
```

Uses: hero state dot, AlertsPanel red severity glyph (only when severity =
critical).

### Soft glow (active card)

```css
@keyframes cortex-glow {
  0%, 100% { box-shadow: 0 0 0 1px hsl(var(--cortex-border)); }
  50%      { box-shadow: 0 0 0 1px hsl(var(--cortex-cyan) / 0.45),
                         0 0 22px -6px hsl(var(--cortex-cyan) / 0.35); }
}
.cortex-glow-active { animation: cortex-glow 4s ease-in-out infinite; }
```

Use only on the SystemStatusHero card when state = `running`. Disable when
state ≠ `running`.

### Entry fade (new feed row, new alert)

framer-motion or plain CSS:
```ts
{
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18, ease: "easeOut" } },
  exit:    { opacity: 0, transition: { duration: 0.12, ease: "easeIn" } }
}
```
No `y` or `x` translation. No `scale`.

### Reduced motion

Always honor `@media (prefers-reduced-motion: reduce)` — collapse all of the
above to no-op (`animation: none`, `transition: none`).

---

## 6 — Copy deck

Approved hero / panel lines (use these or close variants):

| Slot | Copy |
| --- | --- |
| Hero running | `Cortex is running.` |
| Hero subtext (calm) | `Monitoring AI activity. No violations detected.` |
| Hero subtext (active) | `Agents connected. Policies armed.` |
| Hero subtext (all-clear) | `All systems within policy. You can keep building.` |
| Activity empty state | `No recent activity. Cortex is monitoring.` |
| Alerts empty state | `No violations detected.` |
| Audit empty state | `No audit events yet. Run an action to start the trail.` |
| Compliance covered | `Covered.` (one word inside the pill) |
| Compliance partial | `Partial coverage.` |
| Compliance uncovered | `Not in scope.` |
| Tamper-lock active | `Chaos contained. Tamper-lock engaged.` |
| Break-glass active | `Cortex paused by <user> — "<reason>".` |
| Sync running | `Re-arming policies…` |
| Sync done | `Policies armed.` |

### Voice rules
- One sentence per state. Period. No exclamation points.
- Use the present tense. Cortex *is* doing things, not *will* or *has*.
- Use system language: `armed`, `engaged`, `connected`, `contained`.
- Never apologize. Never use "oops", "uh-oh", "looks like".
- Numbers come before words. `14 rules · 0 violations`, not `Rules: 14`.

---

## 7 — Component contracts

These are the React component names and prop signatures the implementation
should use. Do not write the JSX here — derive it from the section specs above.

```ts
// src/components/govern/LivePulse.tsx
export type LivePulseState = "running" | "alert" | "warn" | "idle";
export interface LivePulseProps {
  state: LivePulseState;
  size?: "sm" | "md" | "lg"; // default md
  ariaLabel?: string;
}

// src/components/govern/SystemStatusHero.tsx
export type SystemState =
  | "running"
  | "running-active"
  | "alert"
  | "degraded"
  | "paused"
  | "unconfigured";
export interface SystemStatusHeroProps {
  state: SystemState;
  headline?: string;          // override default copy
  subtext?: string;           // override default copy
  breakGlass?: { user: string; reason: string };
  violations24h?: number;
  ctas?: Array<{ label: string; href?: string; onClick?: () => void; variant?: "ghost" | "primary" }>;
}

// src/components/govern/ActivityMonitor.tsx
export interface ActivityRow {
  id: string;
  ts: string;            // ISO
  agent: "claude" | "codex" | "copilot" | "other";
  action: string;        // "edit", "write", "bash"…
  target?: string;       // file path or command
  durationMs?: number;
  status: "ok" | "anomaly" | "violation";
  reason?: string;       // present when status != ok
}
export interface ActivityMonitorProps {
  rows: ActivityRow[];
  filter?: "all" | "claude" | "codex" | "copilot";
  onFilterChange?: (next: ActivityMonitorProps["filter"]) => void;
}

// src/components/govern/PolicyEngineCard.tsx
export interface PolicyEngineCardProps {
  activeRules: number;
  violations24h: number;
  enforcement: "enforced" | "advisory" | "off";
  coverageByFramework: Array<{ id: string; rules: number }>;
}

// src/components/govern/AlertsPanel.tsx
export type AlertSeverity = "critical" | "warn" | "ok";
export interface AlertEntry {
  id: string;
  severity: AlertSeverity;
  ruleId: string;
  filePath?: string;
  reason: string;
  action: "blocked" | "warned" | "logged" | "sigterm";
  ts: string; // ISO
}
export interface AlertsPanelProps {
  alerts: AlertEntry[];
  onResolve?: (id: string) => void;
}

// src/components/govern/CompliancePanel.tsx
export type FrameworkId = "iso27001" | "iso42001" | "soc2" | "gdpr" | "ai-act" | "nis2";
export type FrameworkStatus = "covered" | "partial" | "not-in-scope";
export interface FrameworkCell {
  id: FrameworkId;
  name: string;
  subtitle: string;
  rules: number;
  violations: number;
  status: FrameworkStatus;
}
export interface CompliancePanelProps {
  frameworks: FrameworkCell[];
}

// src/components/govern/AuditTrail.tsx
export interface AuditEvent {
  ts: string;
  actor: string;
  action: string;
  target: string;
  result: "ok" | "blocked" | "warned" | "error";
  hash: string;
}
export interface AuditTrailProps {
  events: AuditEvent[];
  total: number;
  page: number;
  onPageChange: (next: number) => void;
  onSearch?: (query: string) => void;
  onExport?: () => void;
}

// src/components/govern/MetricsRoi.tsx
export interface MetricsRoiProps {
  tokensSaved: { value: number; spark: number[] };
  violationsPrevented: { value: number; spark: number[] };
  activityVolume: { value: number; spark: number[] };
}
```

### Page composition (informational — do not implement here)

```
<DashboardShell>
  <SystemStatusHero ... />          {/* full-width band */}

  <Grid lg:grid-cols-12 gap-8>
    <ActivityMonitor className="col-span-7" ... />
    <PolicyEngineCard className="col-span-5" ... />

    <AlertsPanel className="col-span-7" ... />
    <CompliancePanel className="col-span-5" ... />

    <AuditTrail className="col-span-12" ... />
    <MetricsRoi className="col-span-12" ... />
  </Grid>
</DashboardShell>
```

---

## 8 — Accessibility

- Min contrast: 4.5:1 for body text, 3:1 for large text. Verify the muted
  foreground (`--cortex-fg-muted`) meets this against the surface (`--cortex-surface`).
- All status pills must carry text *and* a non-color signal (icon or label).
  A red pill alone is not enough.
- Live regions: SystemStatusHero headline lives in `aria-live="polite"` so
  screen readers announce state transitions (running → alert) without
  interrupting active speech.
- All animations honor `prefers-reduced-motion`.
- The pulse halo is decorative — wrap with `aria-hidden="true"`.

---

## 9 — Don't list (repeat for clarity)

- No mascots, illustrated robots, or stock cyber imagery.
- No bouncing, sliding, or scaling animations.
- No emoji decorations in headlines or buttons.
- No nested cards (a card inside a card inside a card).
- No multi-axis scroll inside a card.
- No "Loading…" placeholders — use brand language: `Re-arming policies…`,
  `Reading audit trail…`.
- No friendly chatbot tone. Cortex doesn't apologize and doesn't joke.
- No gradient on more than two surfaces per screen (typically: hero headline +
  one accent line). Everywhere else: solid color.

---

*End of design specification. Implementation can proceed by creating each
component in `cortex-web/src/components/govern/` against the prop signatures
above, then wiring them into `cortex-web/src/app/dashboard/govern/page.tsx`.*
