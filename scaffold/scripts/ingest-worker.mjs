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
import { parentPort } from "node:worker_threads";
import {
  loadParsers,
  parseFileContent,
  parseFileContentWithDialectObservations
} from "./lib/ingest/parser-registry.mjs";
import { validateDialectObservationTransport } from "./lib/dialect-observation-contract.mjs";
import {
  createFilesystemBoundaryFromAnchor,
  createWorkerProtocolError,
  isFilesystemPolicyError,
  policyErrorEnvelope
} from "./lib/ingest/filesystem-boundary.mjs";

if (!parentPort) {
  throw new Error("ingest-worker.mjs must be run as a worker thread");
}

const ready = loadParsers();

parentPort.on("message", async (message) => {
  if (
    message &&
    typeof message === "object" &&
    !Array.isArray(message) &&
    message.type === "shutdown" &&
    Object.keys(message).length === 1
  ) {
    process.exit(0);
  }

  const filePath = typeof message?.filePath === "string" ? message.filePath : "<repository-path>";
  const taskId = typeof message?.taskId === "string" ? message.taskId : undefined;
  try {
    const keys = message && typeof message === "object" && !Array.isArray(message)
      ? Object.keys(message).sort()
      : [];
    const validEnvelope =
      keys.join(",") === "contentLimit,dialect,ext,filePath,projectAnchor,taskId" &&
      typeof message.taskId === "string" &&
      typeof message.ext === "string" &&
      typeof message.filePath === "string" &&
      typeof message.dialect === "boolean" &&
      Number.isInteger(message.contentLimit) &&
      message.contentLimit >= 0;
    if (!validEnvelope) throw createWorkerProtocolError(filePath);
    const { ext, contentLimit, dialect, projectAnchor } = message;
    await ready;
    const protocolError = createWorkerProtocolError(filePath);
    const failureDetails = {
      code: "CORTEX_FS_SOURCE",
      phase: "worker_read",
      subject_kind: "repository_path",
      subject: protocolError.subject,
      reason: "path_replaced"
    };
    const boundary = createFilesystemBoundaryFromAnchor(projectAnchor, failureDetails);
    const content = boundary.readRepositoryFile(filePath, "worker_read", "utf8").slice(0, contentLimit);
    const parsed = dialect
      ? await parseFileContentWithDialectObservations(ext, content, filePath)
      : await parseFileContent(ext, content, filePath);
    if (!parsed) {
      parentPort.postMessage({ taskId, ok: false, reason: "no parser available" });
      return;
    }
    let result = parsed.result;
    if (dialect) {
      try {
        result = validateDialectObservationTransport(result);
      } catch {
        throw createWorkerProtocolError(filePath);
      }
    }
    parentPort.postMessage({ taskId, ok: true, result });
  } catch (error) {
    if (isFilesystemPolicyError(error)) {
      parentPort.postMessage(policyErrorEnvelope(error));
      return;
    }
    parentPort.postMessage({
      taskId,
      ok: false,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
});
