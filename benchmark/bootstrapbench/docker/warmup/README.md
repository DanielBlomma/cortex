# Bootstrapbench warmup project

Tiny throwaway project bootstrapped during the Docker image build so the image
ships with warm caches: `.context/mcp` npm dependencies, parser dependencies,
the compiled MCP server, and the default embedding model. Eval containers copy
these into each cloned repo before running `cortex bootstrap`, keeping per-repo
runs fast and independent of registry availability.
