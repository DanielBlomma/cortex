# Migrering till Cortex v2.0.0

Cortex v2.0.0 konsoliderar tre paket (`@danielblomma/cortex-mcp`,
`@danielblomma/cortex-core`, `@danielblomma/cortex-enterprise`) till ett
enda paket: `@danielblomma/cortex-mcp@2.0.0`. Det löser versionsdrift
mellan paketen och introducerar Claude Code lifecycle-hooks som
non-bypassable governance-lager.

## Vad ändras

| Område | v1.x | v2.0.0 |
|---|---|---|
| Paket att installera | `cortex-mcp` + (transitivt) `cortex-core` + `cortex-enterprise` | Bara `cortex-mcp` |
| Versionsmatris | Flera paket måste matcha | En version |
| Enterprise activation | Dynamic import beroende av version-pinning | Direktanrop, license-validation |
| Telemetri-flush vid shutdown | Best-effort i mcp-processen | Garanterat via Claude Code Stop-hook |
| Onboarding | Manuell `.context/enterprise.yml`-redigering | `cortex enterprise <api-key>` |
| Node | `>=18` | `>=20` |

## Migrera (slutanvändare)

### 1. Bumpa global install
```bash
npm i -g @danielblomma/cortex-mcp@latest
```

Du behöver inte längre installera `@danielblomma/cortex-enterprise`
separat — det är inbyggt och aktiveras av din license key.

### 2. Verifiera Node-version
```bash
node --version    # ska vara v20.x.x eller senare
```

Om du använder nvm: `nvm use` plockar upp nya `.nvmrc` automatiskt.

### 3. Sätt upp enterprise (ersätter manuell config)
```bash
cortex enterprise ctx_din_api_key_här
```

Detta validerar nyckeln, skriver `.context/enterprise.yml`,
installerar Claude Code-hooks och startar daemonen i ett steg.

För custom-deployment: `cortex enterprise ctx_xxx --endpoint https://din-cortex.exempel.se`

### 4. Verifiera pipelinen
```bash
cortex telemetry test
```

Om allt är grönt syns en syntetisk telemetri-event i din dashboard
inom 60 sekunder.

## Nya CLI-kommandon

| Kommando | Funktion |
|---|---|
| `cortex enterprise <api-key>` | Onboarding one-liner |
| `cortex daemon [start\|stop\|status]` | Hantera långkörande daemon |
| `cortex hooks [install\|uninstall\|status] [--project]` | Hantera Claude Code-hooks |
| `cortex telemetry test` | Smoke-test push-pipelinen |

## Lifecycle-hooks (governance)

v2.0.0 installerar 6 Claude Code-hooks som ger non-bypassable governance:

| Hook | Effekt |
|---|---|
| `PreToolUse` | Policy-check innan Edit/Write/Bash. Split fail-mode: community fail-open, enterprise fail-closed |
| `Stop` | Garanterad telemetri-flush vid svarsslut (löser shutdown-buggen) |
| `SessionStart` | Audit-logg av sessionstart |
| `SessionEnd` | Final telemetri + audit |
| `UserPromptSubmit` | Audit av prompt-event (bara längd, inte innehåll) |
| `PreCompact` | Snapshot innan Claude komprimerar context |

Hooks kör fristående från MCP-processen, så de tappar inte data om
mcp:n dör abrupt.

## Failure modes

### Daemon nere
- **Community-mode** (ingen api_key): hooks fail-open. Claude jobbar
  som vanligt. Stderr-warning per hook-anrop.
- **Enterprise-mode** (giltig license): PreToolUse fail-closed (exit 2).
  Edit/Write/Bash blockas tills daemonen startas. Andra hooks
  (Stop, audit, telemetri) påverkar inte din körning.

### License endpoint nere
- 24h cache: ingen påverkan
- 24h-7d gammal cache: använd cache (grace period), warning i stderr
- >7d gammal cache eller ingen cache: degradera till community-mode

### API-nyckel ogiltig
- Endpoint returnerar 200 + `valid: false`
- Klienten degraderar omedelbart till community-mode
- Inga edits blockas (det är inte säkerhetsboundary, det är gating)

## Deprecated paket

Dessa fortsätter vara installerbara från npm men markeras `deprecated`
och tar inga uppdateringar efter 2026-10-30 (6 månader):

| Paket | Sista version | Innehåll |
|---|---|---|
| `@danielblomma/cortex-core@1.0.0` | re-export från `cortex-mcp@2` | Konstanter, types |
| `@danielblomma/cortex-enterprise@0.99.0` | re-export från `cortex-mcp@2` | Hooks, plugin shape |

Kod som importerade `@danielblomma/cortex-core/config` etc fortsätter
fungera under fönstret, men du bör flytta direktimporten till
`@danielblomma/cortex-mcp` innan oktober 2026.

## Breaking changes

1. **Node 18 stöds inte längre** — uppgradera till Node 20+.
2. **`@danielblomma/cortex-enterprise` är inte längre en separat install** —
   den är inbyggd i `cortex-mcp@2`. Om du explicit installerade enterprise
   i din `package.json`, ta bort den efter uppgradering.
3. **Plugin-loaderns dynamic import är borttagen** — om du byggt
   3:e-parts-plugin som importerar enterprise via `@danielblomma/cortex-enterprise`
   måste du flytta till direktimport från `cortex-mcp`.
4. **`globalThis.__cortexContextToolHook` är borttagen** — ingen extern
   konsument bör ha använt denna interna bro, men var en del av v0.5.x
   API:n.

## Frågor / problem

Öppna ett ärende på https://github.com/DanielBlomma/cortex/issues
med taggen `v2-migration`.
