import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import { pushHostEvents } from "../dist/daemon/host-events-pusher.js";

function startMockServer(handlers) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const handler = handlers[`${req.method} ${u.pathname}`];
    if (!handler) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => handler(req, res, u, body));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function makeProject({ baseUrl, apiKey = "ent_test_key_12345678" }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-pusher-"));
  const ctx = path.join(root, ".context");
  fs.mkdirSync(ctx, { recursive: true });
  fs.writeFileSync(
    path.join(ctx, "enterprise.yml"),
    [
      "enterprise:",
      `  api_key: ${apiKey}`,
      `  base_url: ${baseUrl}`,
      "compliance:",
      "  frameworks: [iso27001]",
      "",
    ].join("\n"),
  );
  return { root, ctx };
}

function writeHostEvents(ctx, lines) {
  const dir = path.join(ctx, "audit");
  fs.mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `host-events-${date}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

test("pushHostEvents: pushes ungoverned + tamper events in one tick", async () => {
  let receivedUngov = null;
  let receivedTamper = null;
  const { server, baseUrl } = await startMockServer({
    "POST /api/v1/govern/ungoverned": (req, res, u, body) => {
      receivedUngov = JSON.parse(body);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, ingested: receivedUngov.events.length }));
    },
    "POST /api/v1/govern/tamper": (req, res, u, body) => {
      receivedTamper = JSON.parse(body);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, ingested: receivedTamper.events.length }));
    },
  });

  const { root, ctx } = makeProject({ baseUrl });
  try {
    writeHostEvents(ctx, [
      {
        event_type: "ungoverned_ai_session_detected",
        timestamp: "2026-05-01T10:00:00.000Z",
        host_id: "h",
        cli: "claude",
        binary: "/usr/local/bin/claude",
        pid: 100,
        ppid: 1,
        user: "alice",
        args: "claude --prompt hi",
        action: "logged",
      },
      {
        event_type: "hook_tamper_detected",
        timestamp: "2026-05-01T10:01:00.000Z",
        host_id: "h",
        cli: "claude",
        hook_name: "any",
        session_id: "s1",
        last_seen: "2026-05-01T09:55:00.000Z",
        missing_seconds: 360,
      },
    ]);

    const outcome = await pushHostEvents(root);
    assert.equal(outcome.errors.length, 0, outcome.errors.join(", "));
    assert.equal(outcome.ungoverned_pushed, 1);
    assert.equal(outcome.tamper_pushed, 1);
    assert.equal(receivedUngov.events.length, 1);
    assert.equal(receivedUngov.events[0].cli, "claude");
    assert.equal(receivedUngov.events[0].binary_path, "/usr/local/bin/claude");
    assert.equal(receivedTamper.events.length, 1);
    assert.equal(receivedTamper.events[0].missing_seconds, 360);

    // Cursor written so re-running pushes nothing new
    const cursorPath = path.join(ctx, ".cortex-host-events-cursor.json");
    assert.equal(fs.existsSync(cursorPath), true);

    receivedUngov = null;
    receivedTamper = null;
    const second = await pushHostEvents(root);
    assert.equal(second.ungoverned_pushed, 0);
    assert.equal(second.tamper_pushed, 0);
    assert.equal(receivedUngov, null);
    assert.equal(receivedTamper, null);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pushHostEvents: errors when enterprise.yml is missing api_key", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-pusher-bare-"));
  fs.mkdirSync(path.join(root, ".context"), { recursive: true });
  try {
    const outcome = await pushHostEvents(root);
    assert.ok(outcome.errors.length > 0);
    assert.match(outcome.errors[0], /enterprise not configured/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pushHostEvents: only events newer than cursor are pushed", async () => {
  let received = null;
  const { server, baseUrl } = await startMockServer({
    "POST /api/v1/govern/ungoverned": (req, res, u, body) => {
      received = JSON.parse(body);
      res.end(JSON.stringify({ ok: true, ingested: received.events.length }));
    },
  });
  const { root, ctx } = makeProject({ baseUrl });
  try {
    fs.writeFileSync(
      path.join(ctx, ".cortex-host-events-cursor.json"),
      JSON.stringify({ ungoverned_last_ts: "2026-05-01T10:30:00.000Z" }),
    );
    writeHostEvents(ctx, [
      {
        event_type: "ungoverned_ai_session_detected",
        timestamp: "2026-05-01T10:00:00.000Z",
        host_id: "h",
        cli: "claude",
        binary: "/c",
        action: "logged",
      },
      {
        event_type: "ungoverned_ai_session_detected",
        timestamp: "2026-05-01T11:00:00.000Z",
        host_id: "h",
        cli: "claude",
        binary: "/c2",
        action: "logged",
      },
    ]);
    const outcome = await pushHostEvents(root);
    assert.equal(outcome.errors.length, 0);
    assert.equal(outcome.ungoverned_pushed, 1, "only the post-cursor event");
    assert.equal(received.events.length, 1);
    assert.equal(received.events[0].binary_path, "/c2");
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pushHostEvents: cursor advances to max timestamp when events arrive out of order", async () => {
  let receivedBatches = [];
  const { server, baseUrl } = await startMockServer({
    "POST /api/v1/govern/ungoverned": (req, res, u, body) => {
      receivedBatches.push(JSON.parse(body));
      res.end(JSON.stringify({ ok: true, ingested: 3 }));
    },
  });
  const { root, ctx } = makeProject({ baseUrl });
  try {
    // Intentionally out-of-order on disk: T+5min, T+1min, T+3min.
    writeHostEvents(ctx, [
      {
        event_type: "ungoverned_ai_session_detected",
        timestamp: "2026-05-01T10:05:00.000Z",
        host_id: "h",
        cli: "claude",
        binary: "/c5",
        pid: 105,
        action: "logged",
      },
      {
        event_type: "ungoverned_ai_session_detected",
        timestamp: "2026-05-01T10:01:00.000Z",
        host_id: "h",
        cli: "claude",
        binary: "/c1",
        pid: 101,
        action: "logged",
      },
      {
        event_type: "ungoverned_ai_session_detected",
        timestamp: "2026-05-01T10:03:00.000Z",
        host_id: "h",
        cli: "claude",
        binary: "/c3",
        pid: 103,
        action: "logged",
      },
    ]);
    const first = await pushHostEvents(root);
    assert.equal(first.errors.length, 0, first.errors.join(", "));
    assert.equal(first.ungoverned_pushed, 3);

    // Cursor must encode the latest timestamp (T+5min), not the last
    // element in array order (T+3min). Otherwise the next tick would
    // re-push the T+5min event.
    const cursor = JSON.parse(
      fs.readFileSync(path.join(ctx, ".cortex-host-events-cursor.json"), "utf8"),
    );
    assert.match(cursor.ungoverned_last_ts, /^2026-05-01T10:05:00\.000Z#/);

    receivedBatches = [];
    const second = await pushHostEvents(root);
    assert.equal(second.errors.length, 0);
    assert.equal(second.ungoverned_pushed, 0);
    assert.equal(receivedBatches.length, 0);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pushHostEvents: composite cursor breaks same-millisecond ties", async () => {
  let received = [];
  const { server, baseUrl } = await startMockServer({
    "POST /api/v1/govern/ungoverned": (req, res, u, body) => {
      received.push(JSON.parse(body));
      res.end(JSON.stringify({ ok: true, ingested: 1 }));
    },
  });
  const { root, ctx } = makeProject({ baseUrl });
  try {
    const sameTs = "2026-05-01T10:00:00.000Z";
    // Two events at the exact same ms with different pids; cursor on
    // disk says we already covered both (composite includes the larger pid).
    writeHostEvents(ctx, [
      {
        event_type: "ungoverned_ai_session_detected",
        timestamp: sameTs,
        host_id: "h",
        cli: "claude",
        binary: "/c100",
        pid: 100,
        action: "logged",
      },
      {
        event_type: "ungoverned_ai_session_detected",
        timestamp: sameTs,
        host_id: "h",
        cli: "claude",
        binary: "/c200",
        pid: 200,
        action: "logged",
      },
    ]);
    fs.writeFileSync(
      path.join(ctx, ".cortex-host-events-cursor.json"),
      JSON.stringify({ ungoverned_last_ts: `${sameTs}#200` }),
    );

    received = [];
    const noop = await pushHostEvents(root);
    assert.equal(noop.errors.length, 0);
    assert.equal(noop.ungoverned_pushed, 0, "both pid=100 and pid=200 already covered");
    assert.equal(received.length, 0);

    // Append a third event with the SAME timestamp but a higher pid;
    // the composite cursor must let it through.
    const dir = path.join(ctx, "audit");
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(dir, `host-events-${date}.jsonl`);
    fs.appendFileSync(
      file,
      JSON.stringify({
        event_type: "ungoverned_ai_session_detected",
        timestamp: sameTs,
        host_id: "h",
        cli: "claude",
        binary: "/c300",
        pid: 300,
        action: "logged",
      }) + "\n",
    );
    received = [];
    const third = await pushHostEvents(root);
    assert.equal(third.errors.length, 0);
    assert.equal(third.ungoverned_pushed, 1, "pid=300 > cursor pid=200 at same ts");
    assert.equal(received.length, 1);
    assert.equal(received[0].events[0].binary_path, "/c300");
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pushHostEvents: server error preserves cursor (so events retry next tick)", async () => {
  const { server, baseUrl } = await startMockServer({
    "POST /api/v1/govern/ungoverned": (req, res) => {
      res.statusCode = 500;
      res.end("boom");
    },
  });
  const { root, ctx } = makeProject({ baseUrl });
  try {
    writeHostEvents(ctx, [
      {
        event_type: "ungoverned_ai_session_detected",
        timestamp: "2026-05-01T10:00:00.000Z",
        host_id: "h",
        cli: "claude",
        binary: "/c",
        action: "logged",
      },
    ]);
    const outcome = await pushHostEvents(root);
    assert.equal(outcome.ungoverned_pushed, 0);
    assert.ok(outcome.errors.length > 0);
    // Cursor file should not have been written
    const cursorPath = path.join(ctx, ".cortex-host-events-cursor.json");
    assert.equal(fs.existsSync(cursorPath), false);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
