# Bootstrapbench runtime image.
#
# Installs cortex from the LOCAL source tree (packed into .build/cortex-local.tgz
# by run.mjs, never from the npm registry) and pre-warms the per-project caches
# bootstrap needs (.context/mcp node_modules, parser node_modules, the default
# embedding model) by bootstrapping a tiny sample project at build time.
#
# Build (from benchmark/bootstrapbench/):
#   docker build --platform linux/amd64 -f docker/Dockerfile -t cortex-bootstrapbench:local .
#
# Base image constraints: ryugraph's prebuilt needs glibc >= 2.38 (trixie has
# 2.41; bookworm's 2.36 is too old) and only its x86_64 binary is usable —
# the published linux-arm64 prebuilt mislabels x86_64 code — hence the
# linux/amd64 platform pin in run.mjs.
FROM node:22-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install cortex CLI from local source.
COPY .build/cortex-local.tgz /opt/cortex/cortex-local.tgz
RUN npm install -g /opt/cortex/cortex-local.tgz \
  && cortex version

# Warm per-project caches: bootstrap a minimal sample project, then keep the
# reusable artifacts (npm deps, built MCP server, default embedding model).
COPY docker/warmup /opt/cortex/warmup-src
RUN cp -R /opt/cortex/warmup-src /tmp/warmup \
  && cortex init /tmp/warmup --bootstrap --no-connect --no-watch \
  && mkdir -p /opt/cortex/warm-context/mcp \
  && cp -R /tmp/warmup/.context/mcp/node_modules /opt/cortex/warm-context/mcp/node_modules \
  && { [ -d /tmp/warmup/.context/mcp/dist ] && cp -R /tmp/warmup/.context/mcp/dist /opt/cortex/warm-context/mcp/dist || true; } \
  && cp -R /tmp/warmup/.context/scripts/parsers/node_modules /opt/cortex/warm-context/parsers-node_modules \
  && cp -R /tmp/warmup/.context/embeddings/models /opt/cortex/warm-context/embeddings-models \
  && rm -rf /tmp/warmup

# Harness scripts (same relative layout as in the repo so imports resolve).
COPY lib.mjs stats.mjs extract-stats.mjs /opt/bootstrapbench/
COPY docker/run-bootstrap.mjs docker/container-run.sh /opt/bootstrapbench/docker/
RUN chmod +x /opt/bootstrapbench/docker/container-run.sh

WORKDIR /workspace
ENTRYPOINT ["/opt/bootstrapbench/docker/container-run.sh"]
