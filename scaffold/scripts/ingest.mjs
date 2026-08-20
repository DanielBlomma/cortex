#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./lib/ingest/main.mjs";
import {
  isFilesystemPolicyError,
  renderFilesystemPolicyError
} from "./lib/ingest/filesystem-boundary.mjs";

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  main().catch((error) => {
    console.error(
      isFilesystemPolicyError(error)
        ? renderFilesystemPolicyError(error)
        : error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  });
}

export * from "./lib/ingest/main.mjs";
