# Bootstrapbench runtime image.
#
# Installs cortex from the LOCAL source tree (packed into .build/cortex-local.tgz
# by run.mjs, never from the npm registry) and pre-warms the per-project caches
# bootstrap needs (.context/mcp node_modules, parser node_modules, the default
# embedding model) by bootstrapping a tiny sample project at build time.
#
# Build (from benchmark/bootstrapbench/):
#   docker build -f docker/Dockerfile -t cortex-bootstrapbench:local .
#
# Base image constraints: ryugraph's x86_64 prebuilt needs glibc >= 2.38
# (trixie ships 2.41; bookworm's 2.36 is too old). The published linux-arm64
# prebuilt actually contains x86_64 code, so on arm64 we force ryugraph to
# compile from its bundled source during the warmup npm install — a one-time
# image-build cost that buys native-speed (non-Rosetta) eval runs on Apple
# Silicon hosts. cmake is required only for that arm64 source build.
FROM node:22-trixie-slim

ARG TARGETARCH

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ cmake \
  && rm -rf /var/lib/apt/lists/*

# (arm64 only) Compile ryugraph natively in an isolated install: the published
# linux-arm64 prebuilt contains x86_64 code. The env var is scoped to this
# single npm invocation so no other native dependency (e.g. sharp) is forced
# into a source build. One-time cost, cached as an image layer — kept BEFORE
# the cortex tarball COPY so cortex source changes never invalidate it.
RUN if [ "$TARGETARCH" = "arm64" ]; then \
      mkdir -p /opt/ryu-prebuild && cd /opt/ryu-prebuild \
      && npm init -y >/dev/null 2>&1 \
      && npm_config_build_from_source=true npm install ryugraph@25.9.1 --no-fund --loglevel=warn \
      && node -e "require('ryugraph'); console.log('native ryugraph OK')"; \
    fi

# Install cortex CLI from local source.
COPY .build/cortex-local.tgz /opt/cortex/cortex-local.tgz
RUN npm install -g /opt/cortex/cortex-local.tgz \
  && cortex version

# Warm per-project caches: bootstrap a minimal sample project, then keep the
# reusable artifacts (npm deps, built MCP server, default embedding model).
# On arm64 the first bootstrap pass is allowed to fail at the graph-load step
# (broken prebuilt); we then overlay the natively compiled binary and re-run
# bootstrap, which reuses deps/ingest/embeddings and must fully succeed.
COPY docker/warmup /opt/cortex/warmup-src
RUN cp -R /opt/cortex/warmup-src /tmp/warmup \
  && { cortex init /tmp/warmup --bootstrap --no-connect --no-watch || [ "$TARGETARCH" = "arm64" ]; } \
  && if [ "$TARGETARCH" = "arm64" ]; then \
       cp /opt/ryu-prebuild/node_modules/ryugraph/ryujs.node /tmp/warmup/.context/mcp/node_modules/ryugraph/ryujs.node \
       && cd /tmp/warmup && cortex bootstrap; \
     fi \
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
