/**
 * Ingest worker thread.
 *
 * Runs the pure, parallel-safe parse step (tree-sitter / acorn / regex
 * parsers) for one file at a time off the main thread. It does nothing
 * stateful: no id allocation, windowing, checksums, or relation building —
 * all of that stays on the main thread in deterministic order. The worker
 * only turns (ext, file path) into a parse result.
 *
 * Parsers initialize lazily on first use and cache per module instance, so a
 * long-lived worker pays each grammar's WASM init once.
 */
import fs from "node:fs";
import { parentPort } from "node:worker_threads";
import { loadParsers, parseFileContent } from "./ingest-parsers.mjs";

if (!parentPort) {
  throw new Error("ingest-worker.mjs must be run as a worker thread");
}

const ready = loadParsers();

parentPort.on("message", async (message) => {
  if (message && message.type === "shutdown") {
    process.exit(0);
  }

  const { taskId, ext, filePath } = message;
  try {
    await ready;
    let content = typeof message.content === "string" ? message.content : null;
    if (content === null) {
      const limit = Number.isFinite(message.contentLimit) ? Math.max(0, Math.floor(message.contentLimit)) : null;
      content = fs.readFileSync(message.absolutePath, "utf8");
      if (limit !== null) {
        content = content.slice(0, limit);
      }
    }
    const parsed = await parseFileContent(ext, content, filePath);
    if (!parsed) {
      parentPort.postMessage({ taskId, ok: false, reason: "no parser available" });
      return;
    }
    parentPort.postMessage({ taskId, ok: true, result: parsed.result });
  } catch (error) {
    parentPort.postMessage({
      taskId,
      ok: false,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
});
