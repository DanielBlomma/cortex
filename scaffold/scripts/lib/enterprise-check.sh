#!/usr/bin/env bash
# Shared enterprise plugin detection and installation.
# Sourced by both scripts/bootstrap.sh and scaffold/scripts/bootstrap.sh.
#
# Expects: REPO_ROOT, MCP_DIR, step(), info() to be defined by the caller.

step "Checking for enterprise plugin"
ENTERPRISE_CONFIG="$REPO_ROOT/.context/enterprise.yml"
if [[ ! -f "$ENTERPRISE_CONFIG" ]]; then
  ENTERPRISE_CONFIG="$REPO_ROOT/.context/enterprise.yaml"
fi
if [[ -f "$ENTERPRISE_CONFIG" ]]; then
  info "detected enterprise config; installing @danielblomma/cortex-enterprise"
  if NPM_CONFIG_CACHE="$MCP_DIR/.npm-cache" npm --prefix "$MCP_DIR" install --no-fund --no-update-notifier --loglevel=warn "@danielblomma/cortex-enterprise@latest"; then
    info "enterprise plugin installed"
  else
    info "warning: failed to install enterprise plugin; continuing in community mode"
  fi
else
  info "no enterprise config found; community mode"
fi
