import os from "node:os";
import { Worker } from "node:worker_threads";
import {
  createWorkerProtocolError,
  workerPolicyErrorFromMessage
} from "./filesystem-boundary.mjs";

function resolveIngestWorkerCount(taskCount) {
  const raw = process.env.CORTEX_INGEST_WORKERS;
  const configured = raw !== undefined ? Number.parseInt(raw, 10) : Number.NaN;
  const cpuBudget = Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1);
  const defaultWorkerLimit = taskCount >= 1000 ? 4 : 8;
  const desired =
    Number.isFinite(configured) && configured >= 0
      ? configured
      : Math.min(cpuBudget, defaultWorkerLimit);
  if (desired <= 1) return 1;
  // Worker spin-up plus per-worker WASM grammar init dominates on small or
  // incremental runs; stay sequential until there is enough work to amortize.
  if (taskCount < 50) return 1;
  return Math.min(desired, taskCount);
}

function createEmptyWorkerParseStream(tasks, workerCount) {
  const stats = () => ({
    worker_tasks: tasks.length,
    worker_count: Number.isFinite(workerCount) ? workerCount : 0,
    worker_tasks_assigned: 0,
    worker_tasks_settled: 0,
    worker_tasks_unsettled_fallback: tasks.length,
    worker_results: 0,
    worker_results_consumed: 0,
    worker_results_retained: 0,
    worker_results_retained_peak: 0,
    worker_results_pending: 0,
    worker_results_missing: tasks.length,
    worker_waiters: 0
  });
  return {
    hasTask: () => false,
    stats,
    take: async () => undefined,
    drain: async () => stats()
  };
}

function startWorkerParseStream(tasks, { workerCount, verbose, workerUrl } = {}) {
  if (tasks.length === 0) {
    return createEmptyWorkerParseStream(tasks, workerCount);
  }

  const resolvedWorkerUrl = workerUrl ?? new URL("../../ingest-worker.mjs", import.meta.url);
  const poolSize = Math.min(workerCount, tasks.length);
  // Defensive: an undefined/0/negative/NaN workerCount yields poolSize < 1, in
  // which case no workers are ever spawned and the pool would never resolve.
  // Return empty so the caller parses everything inline. (Math.min(undefined, n)
  // is NaN, which is why this is `!(>= 1)` rather than `< 1`.)
  if (!(poolSize >= 1)) {
    return createEmptyWorkerParseStream(tasks, workerCount);
  }

  const taskIds = new Set(tasks.map((task) => task.id));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const results = new Map();
  const missingResults = new Set();
  const waiters = new Map();
  const workers = [];
  const inflight = new Map(); // worker -> taskId being parsed, or null when idle
  let nextTask = 0;
  let alive = poolSize;
  let finished = false;
  let fatalError = null;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const state = {
    assigned: 0,
    settled: 0,
    successful: 0,
    consumed: 0,
    retainedPeak: 0
  };

  const stats = () => ({
    worker_tasks: tasks.length,
    worker_count: poolSize,
    worker_tasks_assigned: state.assigned,
    worker_tasks_settled: state.settled,
    worker_tasks_unsettled_fallback: finished ? Math.max(0, tasks.length - state.settled) : 0,
    worker_results: state.successful,
    worker_results_consumed: state.consumed,
    worker_results_retained: results.size,
    worker_results_retained_peak: state.retainedPeak,
    worker_results_pending: finished ? 0 : Math.max(0, tasks.length - state.settled),
    worker_results_missing: tasks.length - state.successful,
    worker_waiters: waiters.size
  });

  const finish = () => {
    if (finished) return;
    finished = true;
    for (const waiter of waiters.values()) {
      if (fatalError) waiter.reject(fatalError);
      else waiter.resolve(undefined);
    }
    waiters.clear();
    resolveDone();
  };

  // A task is "settled" once it has a result, was skipped, or its worker
  // died holding it. Finish when every task is settled, or when no worker is
  // left alive to make progress (any still-queued tasks then parse inline).
  const maybeFinish = () => {
    if (state.settled >= tasks.length || alive <= 0) {
      finish();
    }
  };

  const resolveWaiter = (taskId, result) => {
    const waiter = waiters.get(taskId);
    if (!waiter) {
      return false;
    }
    waiters.delete(taskId);
    if (result !== undefined) {
      state.consumed += 1;
    }
    waiter.resolve(result);
    return true;
  };

  const settleTask = (taskId, result) => {
    state.settled += 1;
    if (result !== undefined) {
      state.successful += 1;
      if (!resolveWaiter(taskId, result)) {
        results.set(taskId, result);
        state.retainedPeak = Math.max(state.retainedPeak, results.size);
      }
    } else {
      missingResults.add(taskId);
      resolveWaiter(taskId, undefined);
    }
    maybeFinish();
  };

  const assign = (worker) => {
    if (nextTask >= tasks.length) {
      inflight.set(worker, null);
      worker.postMessage({ type: "shutdown" });
      return;
    }
    const task = tasks[nextTask++];
    state.assigned += 1;
    inflight.set(worker, task.id);
    worker.postMessage({
      taskId: task.id,
      ext: task.ext,
      contentLimit: task.contentLimit,
      filePath: task.path,
      projectAnchor: task.projectAnchor
    });
  };

  const onMessage = (worker, message) => {
    if (finished) return;
    const taskId = inflight.get(worker);
    if (message?.type === "policy_error") {
      const task = taskById.get(taskId);
      fatalError = workerPolicyErrorFromMessage(message, task?.path ?? "<worker-task>");
      inflight.set(worker, null);
      finish();
      return;
    }
    const task = taskById.get(taskId);
    const messageKeys = message && typeof message === "object" && !Array.isArray(message)
      ? Object.keys(message).sort()
      : [];
    const validSuccess =
      message?.ok === true &&
      message.taskId === taskId &&
      message.result &&
      typeof message.result === "object" &&
      messageKeys.join(",") === "ok,result,taskId";
    const validSkip =
      message?.ok === false &&
      message.taskId === taskId &&
      typeof message.reason === "string" &&
      messageKeys.join(",") === "ok,reason,taskId";
    if (!validSuccess && !validSkip) {
      fatalError = createWorkerProtocolError(task?.path ?? "<worker-task>");
      inflight.set(worker, null);
      finish();
      return;
    }
    inflight.set(worker, null);
    if (validSuccess) {
      settleTask(message.taskId, message.result);
    } else {
      if (verbose) {
        console.log(`[ingest] worker skipped ${message.taskId}: ${message.reason}`);
      }
      settleTask(message.taskId, undefined);
    }
    if (!finished) {
      assign(worker);
    }
  };

  const onExit = (worker) => {
    if (finished) return;
    alive -= 1;
    const taskId = inflight.get(worker);
    if (taskId != null) {
      // Worker exited mid-parse without posting a result (OOM, native abort,
      // process.exit) and without an 'error' event. Count its in-flight task
      // as settled so it falls back to inline parsing rather than leaving the
      // pool waiting on a dead worker forever.
      if (verbose) {
        console.log(`[ingest] worker exited mid-task ${taskId}; will parse inline`);
      }
      inflight.set(worker, null);
      settleTask(taskId, undefined);
      return;
    }
    maybeFinish();
  };

  for (let i = 0; i < poolSize; i += 1) {
    const worker = new Worker(resolvedWorkerUrl);
    workers.push(worker);
    worker.on("message", (message) => onMessage(worker, message));
    worker.on("error", (error) => {
      // Uncaught exception in the worker. The 'exit' event that always
      // follows does the task accounting (idempotent via inflight), so we
      // only log here to avoid double-counting.
      if (verbose) {
        console.log(`[ingest] worker error: ${error.message}`);
      }
    });
    worker.on("exit", () => onExit(worker));
  }

  for (const worker of workers) {
    assign(worker);
  }

  return {
    hasTask(taskId) {
      return taskIds.has(taskId);
    },
    stats,
    async take(taskId) {
      if (fatalError) throw fatalError;
      if (!taskIds.has(taskId)) {
        return undefined;
      }
      if (results.has(taskId)) {
        const result = results.get(taskId);
        results.delete(taskId);
        state.consumed += 1;
        return result;
      }
      if (missingResults.has(taskId) || finished) {
        return undefined;
      }
      return new Promise((resolve, reject) => {
        waiters.set(taskId, { resolve, reject });
      });
    },
    async drain() {
      await done;
      await Promise.all(workers.map((worker) => worker.terminate().catch(() => {})));
      if (fatalError) throw fatalError;
      return stats();
    }
  };
}

// Compatibility helper for direct worker-pool tests. The ingest pipeline
// consumes the stream in sorted file-record order and does not retain this map.
async function parseFilesInWorkers(tasks, options = {}) {
  const stream = startWorkerParseStream(tasks, options);
  const results = new Map();
  try {
    for (const task of tasks) {
      const result = await stream.take(task.id);
      if (result) {
        results.set(task.id, result);
      }
    }
  } finally {
    await stream.drain();
  }
  return results;
}

export {
  parseFilesInWorkers,
  resolveIngestWorkerCount,
  startWorkerParseStream
};
