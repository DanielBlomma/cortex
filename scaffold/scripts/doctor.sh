#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTEXT_DIR="$REPO_ROOT/.context"
MCP_DIR="$REPO_ROOT/mcp"

PASS=0
FAIL=0
WARN=0

pass() { echo "    ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "    ✗ $1"; FAIL=$((FAIL + 1)); }
warn() { echo "    ! $1"; WARN=$((WARN + 1)); }
info() { echo "    - $1"; }

echo ""
echo "[cortex] Doctor — checking your setup"

# ── Config ──────────────────────────────────────────────

echo ""
echo "  Config"

if [[ -f "$CONTEXT_DIR/config.yaml" ]]; then
  pass ".context/config.yaml found"
  # Show source_paths
  PATHS=$(node -e '
    const fs = require("node:fs");
    const raw = fs.readFileSync(process.argv[1], "utf8");
    const paths = [];
    let inSection = false;
    for (const line of raw.split("\n")) {
      if (/^source_paths:\s*$/.test(line.trim())) { inSection = true; continue; }
      if (!inSection) continue;
      const m = line.match(/^\s*-\s*(.+?)\s*$/);
      if (m) { paths.push(m[1].replace(/^["\x27]|["\x27]$/g, "")); continue; }
      if (line.trim() !== "" && !/^\s/.test(line)) break;
    }
    console.log(paths.join(", ") || "(none)");
  ' "$CONTEXT_DIR/config.yaml" 2>/dev/null || echo "(parse error)")
  info "source_paths: $PATHS"
else
  fail ".context/config.yaml not found — run: cortex init"
fi

# Enterprise config
ENTERPRISE_CONFIG=""
if [[ -f "$CONTEXT_DIR/enterprise.yml" ]]; then
  ENTERPRISE_CONFIG="$CONTEXT_DIR/enterprise.yml"
elif [[ -f "$CONTEXT_DIR/enterprise.yaml" ]]; then
  ENTERPRISE_CONFIG="$CONTEXT_DIR/enterprise.yaml"
fi

if [[ -n "$ENTERPRISE_CONFIG" ]]; then
  pass "enterprise config found: $(basename "$ENTERPRISE_CONFIG")"
else
  info "no enterprise config (community mode)"
fi

# ── Index ───────────────────────────────────────────────

echo ""
echo "  Index"

INGEST_MANIFEST="$CONTEXT_DIR/cache/manifest.json"
if [[ -f "$INGEST_MANIFEST" ]]; then
  INGEST_INFO=$(node -e '
    const fs = require("node:fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const c = d.counts || {};
    const age = Math.round((Date.now() - new Date(d.generated_at).getTime()) / 60000);
    const ageStr = age < 60 ? age + " min ago" : Math.round(age / 60) + "h ago";
    console.log(`${c.files ?? 0} files, ${c.rules ?? 0} rules (${ageStr})`);
  ' "$INGEST_MANIFEST" 2>/dev/null || echo "parse error")
  pass "Ingest: $INGEST_INFO"
else
  warn "Ingest manifest missing — run: cortex bootstrap"
fi

GRAPH_MANIFEST="$CONTEXT_DIR/cache/graph-manifest.json"
if [[ -f "$GRAPH_MANIFEST" ]]; then
  GRAPH_INFO=$(node -e '
    const fs = require("node:fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const c = d.counts || {};
    const age = Math.round((Date.now() - new Date(d.generated_at).getTime()) / 60000);
    const ageStr = age < 60 ? age + " min ago" : Math.round(age / 60) + "h ago";
    console.log(`${c.files ?? 0} files, ${c.constrains ?? 0} constrains, ${c.calls ?? 0} calls (${ageStr})`);
  ' "$GRAPH_MANIFEST" 2>/dev/null || echo "parse error")
  pass "Graph: $GRAPH_INFO"
else
  warn "Graph manifest missing — run: cortex bootstrap"
fi

EMBED_MANIFEST="$CONTEXT_DIR/embeddings/manifest.json"
if [[ -f "$EMBED_MANIFEST" ]]; then
  EMBED_INFO=$(node -e '
    const fs = require("node:fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const c = d.counts || {};
    console.log(`${c.entities ?? 0} entities, model ${d.model || "unknown"}`);
  ' "$EMBED_MANIFEST" 2>/dev/null || echo "parse error")
  pass "Embeddings: $EMBED_INFO"
else
  warn "Embeddings missing — run: cortex bootstrap"
fi

# Freshness
if [[ -f "$INGEST_MANIFEST" ]] && command -v git &>/dev/null && git -C "$REPO_ROOT" rev-parse --git-dir &>/dev/null; then
  FRESHNESS=$(node -e '
    const fs = require("node:fs");
    const { execSync } = require("node:child_process");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const sp = Array.isArray(d.source_paths) ? d.source_paths : [];
    const files = Number(d.counts?.files ?? 0);
    let changed = 0;
    try {
      const out = execSync("git status --porcelain", { cwd: process.argv[2], encoding: "utf8", timeout: 3000 });
      for (const line of out.split("\n")) {
        if (!line || line.length < 4) continue;
        const p = line.slice(3).trim().split(" -> ").pop();
        if (p.startsWith(".context/")) continue;
        if (sp.length === 0 || sp.some(s => p === s || p.startsWith(s + "/"))) changed++;
      }
    } catch {}
    const base = Math.max(files, changed, 1);
    const pct = Math.round(Math.max(0, (base - changed) / base) * 100);
    console.log(pct);
  ' "$INGEST_MANIFEST" "$REPO_ROOT" 2>/dev/null || echo "-1")
  if [[ "$FRESHNESS" != "-1" ]]; then
    if [[ "$FRESHNESS" -ge 90 ]]; then
      pass "Freshness: ${FRESHNESS}%"
    elif [[ "$FRESHNESS" -ge 50 ]]; then
      warn "Freshness: ${FRESHNESS}% — run: cortex update"
    else
      fail "Freshness: ${FRESHNESS}% — run: cortex update"
    fi
  fi
fi

# ── MCP Server ──────────────────────────────────────────

echo ""
echo "  MCP Server"

if [[ -f "$MCP_DIR/dist/server.js" ]]; then
  pass "mcp/dist/server.js exists"
else
  fail "mcp/dist/server.js missing — run: cd mcp && npm run build"
fi

if [[ -d "$MCP_DIR/node_modules" ]]; then
  pass "mcp/node_modules present"
else
  fail "mcp/node_modules missing — run: cd mcp && npm install"
fi

# Quick MCP import check
if [[ -f "$MCP_DIR/dist/server.js" ]] && [[ -d "$MCP_DIR/node_modules" ]]; then
  MCP_CHECK=$(cd "$REPO_ROOT" && timeout 10 node -e '
    const start = Date.now();
    try {
      require("./mcp/dist/graph.js");
      console.log("ok " + (Date.now() - start));
    } catch(e) {
      console.log("fail " + e.message);
    }
  ' 2>/dev/null || echo "fail timeout")
  if [[ "$MCP_CHECK" == ok* ]]; then
    MS="${MCP_CHECK#ok }"
    pass "Graph module loads (${MS}ms)"
  else
    warn "Graph module failed to load: ${MCP_CHECK#fail }"
  fi
fi

# ── Enterprise ──────────────────────────────────────────

if [[ -n "$ENTERPRISE_CONFIG" ]]; then
  echo ""
  echo "  Enterprise"

  # Plugin installed?
  ENTERPRISE_PKG="$MCP_DIR/node_modules/@danielblomma/cortex-enterprise/package.json"
  if [[ -f "$ENTERPRISE_PKG" ]]; then
    ENT_VERSION=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version)' "$ENTERPRISE_PKG" 2>/dev/null || echo "unknown")
    pass "Plugin installed: v${ENT_VERSION}"
  else
    fail "Plugin not installed — run: cortex bootstrap"
  fi

  # Parse enterprise config for checks
  TELEMETRY_ENDPOINT=$(node -e '
    const fs = require("node:fs");
    const raw = fs.readFileSync(process.argv[1], "utf8");
    let section = "", fields = {};
    for (const line of raw.split("\n")) {
      const t = line.trimEnd();
      if (!t || t.startsWith("#")) continue;
      const sm = t.match(/^(\w+):\s*$/);
      if (sm) { section = sm[1]; continue; }
      const kv = t.match(/^\s+(\w+):\s*(.+?)\s*$/);
      if (kv && section) fields[section + "." + kv[1]] = kv[2].replace(/^["\x27]|["\x27]$/g, "");
    }
    console.log(fields["telemetry.endpoint"] || "");
  ' "$ENTERPRISE_CONFIG" 2>/dev/null || echo "")

  POLICY_ENDPOINT=$(node -e '
    const fs = require("node:fs");
    const raw = fs.readFileSync(process.argv[1], "utf8");
    let section = "", fields = {};
    for (const line of raw.split("\n")) {
      const t = line.trimEnd();
      if (!t || t.startsWith("#")) continue;
      const sm = t.match(/^(\w+):\s*$/);
      if (sm) { section = sm[1]; continue; }
      const kv = t.match(/^\s+(\w+):\s*(.+?)\s*$/);
      if (kv && section) fields[section + "." + kv[1]] = kv[2].replace(/^["\x27]|["\x27]$/g, "");
    }
    console.log(fields["policy.endpoint"] || "");
  ' "$ENTERPRISE_CONFIG" 2>/dev/null || echo "")

  TELEMETRY_API_KEY=$(node -e '
    const fs = require("node:fs");
    const raw = fs.readFileSync(process.argv[1], "utf8");
    let section = "", fields = {};
    for (const line of raw.split("\n")) {
      const t = line.trimEnd();
      if (!t || t.startsWith("#")) continue;
      const sm = t.match(/^(\w+):\s*$/);
      if (sm) { section = sm[1]; continue; }
      const kv = t.match(/^\s+(\w+):\s*(.+?)\s*$/);
      if (kv && section) fields[section + "." + kv[1]] = kv[2].replace(/^["\x27]|["\x27]$/g, "");
    }
    console.log(fields["telemetry.api_key"] || "");
  ' "$ENTERPRISE_CONFIG" 2>/dev/null || echo "")

  POLICY_API_KEY=$(node -e '
    const fs = require("node:fs");
    const raw = fs.readFileSync(process.argv[1], "utf8");
    let section = "", fields = {};
    for (const line of raw.split("\n")) {
      const t = line.trimEnd();
      if (!t || t.startsWith("#")) continue;
      const sm = t.match(/^(\w+):\s*$/);
      if (sm) { section = sm[1]; continue; }
      const kv = t.match(/^\s+(\w+):\s*(.+?)\s*$/);
      if (kv && section) fields[section + "." + kv[1]] = kv[2].replace(/^["\x27]|["\x27]$/g, "");
    }
    console.log(fields["policy.api_key"] || "");
  ' "$ENTERPRISE_CONFIG" 2>/dev/null || echo "")

  # Telemetry
  if [[ -n "$TELEMETRY_ENDPOINT" ]]; then
    pass "Telemetry: endpoint configured"
    TELEMETRY_CURL_ARGS=(-so /dev/null -w '%{http_code}' --max-time 5 -X POST \
      -H "Content-Type: application/json" -d '{}')
    if [[ -n "$TELEMETRY_API_KEY" ]]; then
      TELEMETRY_CURL_ARGS+=(-H "Authorization: Bearer ${TELEMETRY_API_KEY}")
    fi
    HTTP_CODE=$(curl "${TELEMETRY_CURL_ARGS[@]}" "$TELEMETRY_ENDPOINT" 2>/dev/null | tail -c 3 || echo "000")
    if [[ "$HTTP_CODE" == "000" ]]; then
      fail "Telemetry: endpoint not reachable (timeout/DNS)"
    elif [[ "$HTTP_CODE" =~ ^[23] ]]; then
      if [[ -n "$TELEMETRY_API_KEY" ]]; then
        pass "Telemetry: endpoint authenticated (HTTP ${HTTP_CODE})"
      else
        pass "Telemetry: endpoint reachable (HTTP ${HTTP_CODE})"
      fi
    elif [[ "$HTTP_CODE" == "401" || "$HTTP_CODE" == "403" ]]; then
      if [[ -n "$TELEMETRY_API_KEY" ]]; then
        fail "Telemetry: auth rejected (HTTP ${HTTP_CODE}) — check telemetry.api_key in enterprise.yaml"
      else
        pass "Telemetry: endpoint reachable (auth required — expected)"
      fi
    else
      warn "Telemetry: endpoint returned HTTP ${HTTP_CODE}"
    fi
  else
    warn "Telemetry: no endpoint configured"
  fi

  # Policy
  POLICY_COUNT=0
  if [[ -f "$CONTEXT_DIR/rules.yaml" ]]; then
    LOCAL_RULES=$(grep -c "^  - id:" "$CONTEXT_DIR/rules.yaml" 2>/dev/null || echo "0")
    POLICY_COUNT=$((POLICY_COUNT + LOCAL_RULES))
  fi
  if [[ -f "$CONTEXT_DIR/policies/org-rules.yaml" ]]; then
    ORG_RULES=$(grep -c "^  - id:" "$CONTEXT_DIR/policies/org-rules.yaml" 2>/dev/null || echo "0")
    POLICY_COUNT=$((POLICY_COUNT + ORG_RULES))
  fi
  if [[ "$POLICY_COUNT" -gt 0 ]]; then
    pass "Policies: ${POLICY_COUNT} loaded"
  else
    info "Policies: none loaded"
  fi

  if [[ -n "$POLICY_ENDPOINT" ]]; then
    POLICY_CURL_ARGS=(-so /dev/null -w '%{http_code}' --max-time 5)
    if [[ -n "$POLICY_API_KEY" ]]; then
      POLICY_CURL_ARGS+=(-H "Authorization: Bearer ${POLICY_API_KEY}")
    fi
    POLICY_HTTP=$(curl "${POLICY_CURL_ARGS[@]}" "$POLICY_ENDPOINT" 2>/dev/null | tail -c 3 || echo "000")
    if [[ "$POLICY_HTTP" == "000" ]]; then
      fail "Policy: endpoint not reachable (timeout/DNS)"
    elif [[ "$POLICY_HTTP" =~ ^[23] ]]; then
      if [[ -n "$POLICY_API_KEY" ]]; then
        pass "Policy: endpoint authenticated (HTTP ${POLICY_HTTP})"
      else
        pass "Policy: endpoint reachable (HTTP ${POLICY_HTTP})"
      fi
    elif [[ "$POLICY_HTTP" == "401" || "$POLICY_HTTP" == "403" ]]; then
      if [[ -n "$POLICY_API_KEY" ]]; then
        fail "Policy: auth rejected (HTTP ${POLICY_HTTP}) — check policy.api_key in enterprise.yaml"
      else
        pass "Policy: endpoint reachable (auth required — expected)"
      fi
    else
      warn "Policy: endpoint returned HTTP ${POLICY_HTTP}"
    fi
  fi

  # Audit
  LATEST_AUDIT=$(ls -t "$CONTEXT_DIR/audit/"*.jsonl 2>/dev/null | head -1 || echo "")
  if [[ -n "$LATEST_AUDIT" ]]; then
    AUDIT_AGE=$(node -e '
      const fs = require("node:fs");
      const stat = fs.statSync(process.argv[1]);
      const mins = Math.round((Date.now() - stat.mtimeMs) / 60000);
      if (mins < 60) console.log(mins + " min ago");
      else console.log(Math.round(mins / 60) + "h ago");
    ' "$LATEST_AUDIT" 2>/dev/null || echo "unknown")
    pass "Audit: last entry ${AUDIT_AGE}"
  else
    info "Audit: no entries yet"
  fi
fi

# ── Summary ─────────────────────────────────────────────

echo ""
TOTAL=$((PASS + FAIL + WARN))
if [[ "$FAIL" -eq 0 ]]; then
  echo "[cortex] ${PASS}/${TOTAL} checks passed"
else
  echo "[cortex] ${PASS}/${TOTAL} checks passed, ${FAIL} failed, ${WARN} warnings"
fi
echo ""

exit "$FAIL"
