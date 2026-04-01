# Plan: `cortex dashboard` - Live TUI med Före/Efter-jämförelse

## Context

Cortex saknar en visuell överblick som visar **värdet det tillför**. Nytt kommando `cortex dashboard` startar en live terminal-dashboard (htop-stil) med:
- **Före/efter-jämförelse**: "Without Cortex" (rå filer) vs "With Cortex" (entiteter, relationer, regler)
- **Tokenräkning**: Visar kontexteffektiviteten (rå dump vs Cortex-sökning)
- **Relation breakdown**: Visuella bars per relationstyp
- **Health/freshness**: Synk-status och embedding-status
- **Top connected noder**: Mest kopplade entiteter i grafen

Inga nya npm-dependencies. Enbart Node.js built-ins + ANSI escape codes.

---

## Files to Create

### 1. `scripts/dashboard.mjs` (~400-450 rader)

#### Modulstruktur

```javascript
// === IMPORTS (Node built-ins only) ===
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

// === CONSTANTS ===
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTEXT_DIR = path.join(REPO_ROOT, ".context");
const CACHE_DIR = path.join(CONTEXT_DIR, "cache");

// Återanvänd exakt samma lista som ingest.mjs (scripts/ingest.mjs rad 16-53)
const SUPPORTED_TEXT_EXTENSIONS = new Set([".md",".mdx",".txt",".yaml",".yml",
  ".json",".toml",".ts",".tsx",".js",".jsx",".mjs",".cjs",".py",".go",
  ".java",".cs",".rb",".rs",".php",".swift",".kt",".sql",".sh",".bash",
  ".c",".h",".cpp",".hpp",".cc",".hh"]);

// Samma som ingest.mjs rad 55-66
const SKIP_DIRECTORIES = new Set([".git",".idea",".vscode","node_modules",
  "dist","build","coverage",".next",".cache",".context"]);

const MAX_FILE_BYTES = 1024 * 1024; // 1MB, samma som ingest.mjs rad 68

// ANSI escape codes
const ESC = "\x1b";
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_SCREEN = `${ESC}[2J${ESC}[H`;
const colors = {
  white: `${ESC}[37m`,
  gray: `${ESC}[38;5;245m`,
  green: `${ESC}[38;5;34m`,
  blue: `${ESC}[38;5;33m`,
  orange: `${ESC}[38;5;208m`,
  cyan: `${ESC}[38;5;37m`,
  red: `${ESC}[38;5;196m`,
  yellow: `${ESC}[38;5;220m`,
  purple: `${ESC}[38;5;135m`,
};
```

#### Datafunktioner

```javascript
// --- parseSourcePaths(configText) ---
// Kopiera logiken från ingest.mjs rad 187-210
// Returnerar string[] med source_paths från config.yaml

// --- walkDirectory(dirPath, files) ---
// Kopiera logiken från ingest.mjs rad 267-284
// Rekursiv walk, skippar SKIP_DIRECTORIES

// --- scanBaseline() ---
// Returnerar: { files: number, lines: number, chars: number, tokens: number }
// 1. Läs .context/config.yaml → parseSourcePaths()
// 2. För varje source_path: walkDirectory() → samla alla filer
// 3. Filtrera: SUPPORTED_TEXT_EXTENSIONS && size <= MAX_FILE_BYTES
// 4. Räkna: filer, rader (split('\n').length), tecken (content.length)
// 5. tokens = Math.round(chars / 4)  (grov uppskattning, 1 token ≈ 4 tecken)
// OBS: Cachea resultatet i modulvariabel, uppdatera bara vid 'r' (manuell refresh)

// --- readJsonlSafe(filePath) ---
// Läs JSONL-fil, returnera array av parsed objects
// Om filen inte finns eller är tom → returnera []
// Samma mönster som i loadGraph.ts

// --- readManifests() ---
// Returnerar: { ingest, graph, embed }
// Läser:
//   .context/cache/manifest.json        → ingest metadata (generated_at, counts, source_paths)
//   .context/cache/graph-manifest.json  → graph counts (files, rules, chunks, relations)  
//   .context/embeddings/manifest.json   → embedding status (model, counts)
// Returnerar null för saknade filer

// --- computeFreshness() ---
// Kopiera logiken från status.sh rad 60-170:
//   1. git status --porcelain → räkna ändrade filer i source_paths
//   2. freshness = (baseline - pending) / baseline
//   3. Returnera: { percent, pending, changed, deleted }

// --- computeDegrees() ---
// Läs alla relations.*.jsonl filer
// Bygg Map<entityId, number> med totalt antal edges per entity
// Returnera top N (5) sorterade efter degree
// Används för "TOP CONNECTED" sektionen

// --- estimateCortexSearchTokens() ---
// Läs entities.file.jsonl → summera excerpt-fältens tecken
// avgExcerptChars = totalExcerptChars / entityCount
// searchTokens = top_k (5) * avgExcerptChars / 4 + 200 (metadata overhead)
// Returnera: { searchTokens, avgExcerptTokens }

// --- gatherData() ---
// Orkestrera alla ovanstående och returnera ett enda data-objekt:
// {
//   baseline: { files, lines, chars, tokens },
//   cortex: { 
//     files, chunks, rules, adrs,
//     relations: { calls, defines, constrains, implements, imports, supersedes, total },
//     trustedEntities: number (alla med trust_level > 0),
//   },
//   tokens: {
//     raw: number,        // baseline.tokens
//     cortexSearch: number, // estimerad sökning
//     ratio: number,      // raw / cortexSearch
//     reduction: number,  // 1 - (cortexSearch / raw), som procent
//   },
//   embeddings: { model, count, dimensions } | null,
//   freshness: { percent, pending, changed, deleted },
//   topConnected: [{ id, label, degree }],  // top 5
//   timestamps: { lastIngest, lastGraph, lastEmbed },
// }
```

#### Renderfunktioner

```javascript
// --- formatNumber(n) ---
// 1234 → "1.2K", 1234567 → "1.2M", under 1000 → rå siffra

// --- bar(value, max, width=16) ---
// Returnerar sträng med █ (fyllda) och ░ (tomma)
// Exempel: bar(225, 225, 16) → "████████████████"
// Exempel: bar(77, 225, 16) → "██████░░░░░░░░░░"

// --- padRight(str, len) ---
// Padda med mellanslag till exakt len tecken (för kolumnjustering)

// --- colorize(text, color) ---
// Returnerar `${color}${text}${RESET}`

// --- renderHeader(width) ---
// "┌─ cortex dashboard ─────────────────── HH:MM ─┐"
// Dynamisk bredd baserat på terminalstorlek

// --- renderComparison(data, width) ---
// WITHOUT CORTEX vs WITH CORTEX kolumner (se layout nedan)

// --- renderTokens(data, width) ---
// Token-sektionen med reduction bar

// --- renderCortexAdds(data, width) ---
// Delta-siffror (+170 chunks, +569 relations, etc.)

// --- renderRelationBreakdown(data, width) ---
// Bars per relationstyp

// --- renderHealth(data, width) ---
// Freshness bar, embeddings, timestamps

// --- renderTopConnected(data, width) ---
// Top 5 mest kopplade entiteter med degree

// --- renderFooter(width, interval) ---
// "└── q quit  r refresh ─────────── Xs auto ────┘"

// --- render(data) ---
// Sammansätt alla sektioner, skriv till stdout
// Anpassa till process.stdout.columns / process.stdout.rows
// Om innehåll > rows: stöd scroll med scrollOffset variabel
```

#### Dashboard-layout (exakt)

```
┌─ cortex dashboard ─────────────────────────────────── 20:53 ─┐
│                                                               │
│  WITHOUT CORTEX              WITH CORTEX                      │
│  ───────────────              ────────────────                │
│   9 raw files                 9 files + 170 chunks           │
│   0 relationships           569 mapped relations              │
│   0 architectural rules       5 enforced rules                │
│   0 trust signals            208 trust-scored entities        │
│   0 semantic vectors         280 embedded vectors             │
│  flat file list              ranked hybrid search             │
│                                                               │
│  TOKENS                                                       │
│  Raw dump:     ~125.0K tokens                                 │
│  Cortex search:   ~2.0K tokens (top 5 results)               │
│  Efficiency:  62x reduction                                   │
│  ████████████████████████████████████████░  98% less tokens   │
│                                                               │
│  CORTEX ADDS                                                  │
│  +170 chunks   +569 relations   +5 rules   +280 embeddings   │
│  Semantic search  •  Graph traversal  •  Impact analysis     │
│                                                               │
│  RELATIONS                                                    │
│  CALLS      ████████████████  225                             │
│  DEFINES    ████████████████  170                             │
│  CONSTRAINS ██████░░░░░░░░░░   77                            │
│  IMPLEMENTS █████░░░░░░░░░░░   65                            │
│  IMPORTS    ██░░░░░░░░░░░░░░   32                            │
│  SUPERSEDES ░░░░░░░░░░░░░░░░    0                            │
│                                                               │
│  HEALTH                                                       │
│  Freshness [████████░░] 80%  Last sync: 2m ago               │
│  Embeddings: 280/280 ✓       Model: all-MiniLM-L6-v2        │
│                                                               │
│  TOP CONNECTED                                                │
│  server.ts ─── 24    search.ts ─── 18    loadGraph.ts ─── 15 │
│  embed.ts ──── 12    types.ts ──── 10                         │
│                                                               │
└── q quit  r refresh ──────────────────────── 2s auto ────────┘
```

#### TUI-loop och interaktion

```javascript
// --- main() ---
// 1. Parsa CLI-args: --interval <seconds> (default 2)
// 2. Kolla process.stdout.isTTY
//    - Om false → gatherData() + render() + exit (engångsutskrift utan ANSI)
//    - Om true → starta live loop
// 3. Live loop:
//    a. process.stdin.setRawMode(true)
//    b. process.stdin.resume()
//    c. process.stdout.write(HIDE_CURSOR)
//    d. let scrollOffset = 0
//    e. let baselineCache = null  // cachea baseline, uppdateras vid 'r'
//    f. renderLoop = async () => {
//         const data = await gatherData(baselineCache);
//         process.stdout.write(CLEAR_SCREEN);
//         render(data);
//       }
//    g. renderLoop()  // initial render
//    h. const timer = setInterval(renderLoop, interval * 1000)
//    i. process.stdin.on('data', (key) => {
//         if (key === 'q' || key === '\x03') cleanup();  // q eller Ctrl+C
//         if (key === 'r') { baselineCache = null; renderLoop(); }
//         if (key === '\x1b[A') { scrollOffset = Math.max(0, scrollOffset - 1); renderLoop(); }  // ↑
//         if (key === '\x1b[B') { scrollOffset += 1; renderLoop(); }  // ↓
//       })
// 4. cleanup():
//    a. clearInterval(timer)
//    b. process.stdout.write(SHOW_CURSOR + RESET)
//    c. process.stdin.setRawMode(false)
//    d. process.exit(0)
// 5. process.on('SIGINT', cleanup)
// 6. process.on('SIGTERM', cleanup)
// 7. process.stdout.on('resize', renderLoop)  // terminal resize
```

#### Färgschema (detaljerat)

| Element | Färg | ANSI-kod |
|---------|------|----------|
| Header/border | dim grå | `\x1b[38;5;245m` |
| "WITHOUT CORTEX" text | dim grå | `\x1b[2m\x1b[37m` |
| "WITHOUT CORTEX" siffror | dim grå | `\x1b[38;5;245m` |
| "WITH CORTEX" text | bold grön | `\x1b[1m\x1b[38;5;34m` |
| "WITH CORTEX" siffror | ljusgrön | `\x1b[38;5;34m` |
| Delta-siffror (+N) | grön | `\x1b[38;5;34m` |
| Sektions-headers | bold vit | `\x1b[1m\x1b[37m` |
| Bar fylld | cyan | `\x1b[38;5;37m` █ |
| Bar tom | dim | `\x1b[38;5;239m` ░ |
| Token reduction bar | grön | `\x1b[38;5;34m` █ |
| Freshness ≥ 70% | grön | `\x1b[38;5;34m` |
| Freshness 40-69% | gul | `\x1b[38;5;220m` |
| Freshness < 40% | röd | `\x1b[38;5;196m` |
| Klockan (HH:MM) | dim | `\x1b[38;5;245m` |
| Keybinds footer | dim | `\x1b[38;5;245m` |

---

### 2. `scripts/dashboard.sh` (~20 rader)

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$REPO_ROOT/.context/cache/manifest.json"

if [[ ! -f "$MANIFEST" ]]; then
  echo "[dashboard] No context data found."
  echo "[dashboard] Run: cortex bootstrap"
  exit 0
fi

exec node "$SCRIPT_DIR/dashboard.mjs" "$@"
```

---

## Files to Modify

### 3. `bin/cortex.mjs` — rad 644

Lägg till `"dashboard"` i passthrough Set:

```javascript
// BEFORE (rad 644-656):
const passthrough = new Set([
  "bootstrap", "update", "status", "ingest", "embed",
  "graph-load", "watch", "note", "plan", "todo", "refresh"
]);

// AFTER:
const passthrough = new Set([
  "bootstrap", "update", "status", "ingest", "embed",
  "graph-load", "dashboard", "watch", "note", "plan", "todo", "refresh"
]);
```

### 4. `scripts/context.sh`

**print_help()** — lägg till mellan `status` och `help` (rad 23-24):

```
  dashboard [--interval <sec>]     Live TUI showing what Cortex adds to your repo
```

**case-sats** — lägg till före `status)` (rad 91):

```bash
  dashboard)
    "$SCRIPT_DIR/dashboard.sh" "$@"
    TRACK_EVENT="dashboard"
    ;;
```

### 5. Scaffold-distribution

Kopiera nya filer:
- `scripts/dashboard.mjs` → `scaffold/scripts/dashboard.mjs`
- `scripts/dashboard.sh` → `scaffold/scripts/dashboard.sh`

Uppdatera `scaffold/scripts/context.sh`:
- Samma `dashboard)` case och help-text som ovan

---

## Data Flow

```
cortex dashboard [--interval 5]
  → bin/cortex.mjs (passthrough match: "dashboard")
    → runContextCommand(cwd, ["dashboard", ...args])
      → scripts/context.sh dashboard [--interval 5]
        → scripts/dashboard.sh --interval 5
          → node scripts/dashboard.mjs --interval 5
            
            STARTUP:
            1. Parsa --interval arg (default: 2)
            2. Kolla process.stdout.isTTY
            
            DATA GATHER (gatherData):
            3. Läs .context/config.yaml → source_paths
            4. Walk filesystem → räkna filer/rader/tecken → estimera tokens (baseline)
            5. Läs .context/cache/graph-manifest.json → entity/relation counts
            6. Läs .context/cache/manifest.json → ingest metadata
            7. Läs .context/embeddings/manifest.json → embedding status  
            8. Läs relations.*.jsonl → beräkna degree per entity
            9. Läs entities.file.jsonl → excerpt-storlekar → estimera Cortex search tokens
            10. git status --porcelain → freshness-beräkning
            
            RENDER:
            11. Bygg render-buffer med ANSI
            12. Skriv till stdout med CLEAR_SCREEN prefix
            
            LOOP:
            13. setInterval(gatherData + render, interval * 1000)
            14. Lyssna på stdin: q=quit, r=refresh, ↑↓=scroll
            15. Lyssna på stdout resize → re-render
```

---

## Existing Code to Reuse

| Vad | Varifrån | Rader | Användning |
|-----|----------|-------|------------|
| `SUPPORTED_TEXT_EXTENSIONS` | `scripts/ingest.mjs` | 16-53 | Filtrera filer vid baseline-skanning |
| `SKIP_DIRECTORIES` | `scripts/ingest.mjs` | 55-66 | Skippa dirs vid walk |
| `walkDirectory()` | `scripts/ingest.mjs` | 267-284 | Rekursiv filwalk |
| `parseSourcePaths()` | `scripts/ingest.mjs` | 187-210 | Parsa config.yaml |
| `createBar()` | `scripts/status.sh` | 124-128 | Freshness-bar mönster |
| `computeFreshness` | `scripts/status.sh` | 130-170 | Freshness-beräkning (git status) |
| `hasSourcePrefix()` | `scripts/ingest.mjs` | 286-291 | Matcha filer mot source_paths |
| Cache-sökvägar | `mcp/src/paths.ts` | 13-26 | Kanoniska filer att läsa |
| `readJsonlSafe()` | `mcp/src/loadGraph.ts` | (mönster) | Parsning av JSONL-filer |

---

## Edge Cases

| Scenario | Hantering |
|----------|-----------|
| Ingen cache (ej bootstrappad) | `dashboard.sh` fångar detta och visar "Run: cortex bootstrap" |
| Tomma JSONL-filer (0 bytes) | `readJsonlSafe()` returnerar `[]` → räknare visar 0 |
| Saknat graph-manifest | Visa "Graph not loaded" i health-sektionen |
| Saknat embed-manifest | Visa "No embeddings" med ✗ markering |
| Icke-TTY (pipe/redirect) | Engångsutskrift utan ANSI-koder, utan interaktivitet |
| Liten terminal (< 60 cols) | Fallback: komprimerad layout utan kolumner, bars kortare |
| Stor terminal (> 120 cols) | Centrera innehåll, max inner-width ~80 tecken |
| git inte tillgängligt | `computeFreshness()` catch → freshness "unavailable" |
| Ctrl+C under körning | `SIGINT` handler → cleanup (visa cursor, reset terminal) |
| Inga filer i source_paths | Visa "0 files" i båda kolumnerna |

---

## Verification

1. **Grundläggande**: `cortex bootstrap` → `cortex dashboard` → TUI startar med data
2. **Baseline-korrekthet**: Verifiera filantal matchar `find src docs -type f | wc -l`
3. **Cortex-korrekthet**: Verifiera relation-counts matchar `graph-manifest.json`
4. **Token-beräkning**: Verifiera tokens ≈ `wc -c src/**/*.ts | tail -1` / 4
5. **Interaktion**: `r` refreshar, `q` avslutar rent, `↑↓` scrollar
6. **Clean exit**: Terminal återställd (cursor synlig, färger reset)
7. **Interval-flag**: `cortex dashboard --interval 5` → uppdateras var 5:e sekund
8. **Pipe-fallback**: `cortex dashboard | cat` → engångsutskrift utan ANSI
9. **Resize**: Ändra terminalstorlek → layout anpassas dynamiskt
10. **Saknad data**: Ta bort `graph-manifest.json` → relevant sektion visar "not loaded"
