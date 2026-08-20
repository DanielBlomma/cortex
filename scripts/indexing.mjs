#!/usr/bin/env node
import { runIndexingCommand } from "../scaffold/scripts/indexing.mjs";

runIndexingCommand().catch((error) => {
  process.stderr.write(`[indexing] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
