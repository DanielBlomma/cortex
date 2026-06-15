/**
 * Test-only ingest worker that simulates abnormal termination.
 *
 * Used by tests/ingest-worker-crash.test.mjs to exercise parseFilesInWorkers'
 * handling of a worker that exits mid-task without posting a result and
 * without emitting an 'error' event (the OOM / native-abort / process.exit
 * failure mode). For a task whose filePath contains "CRASH" it calls
 * process.exit() immediately; otherwise it returns an empty parse result.
 */
import { parentPort } from "node:worker_threads";

if (!parentPort) {
  throw new Error("ingest-crash-worker.mjs must run as a worker thread");
}

parentPort.on("message", (message) => {
  if (message && message.type === "shutdown") {
    process.exit(0);
  }
  const { taskId, filePath } = message;
  if (typeof filePath === "string" && filePath.includes("CRASH")) {
    // Exit without posting a message and without throwing: only the 'exit'
    // event fires, which is exactly the case that used to hang the pool.
    process.exit(1);
  }
  parentPort.postMessage({ taskId, ok: true, result: { chunks: [], errors: [] } });
});
