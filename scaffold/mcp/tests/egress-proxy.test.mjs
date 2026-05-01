import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

import { parseSni, startEgressProxy } from "../dist/daemon/egress-proxy.js";

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-egress-"));
  fs.mkdirSync(path.join(root, ".context"), { recursive: true });
  return root;
}

/**
 * Hand-craft a minimal TLS 1.2 ClientHello with a server_name extension
 * for the given hostname. Enough for the SNI parser to find it.
 */
function buildClientHello(serverName) {
  const nameBuf = Buffer.from(serverName, "ascii");
  const sniListInner = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from([(nameBuf.length >> 8) & 0xff, nameBuf.length & 0xff]),
    nameBuf,
  ]);
  const sniList = Buffer.concat([
    Buffer.from([(sniListInner.length >> 8) & 0xff, sniListInner.length & 0xff]),
    sniListInner,
  ]);
  const sniExt = Buffer.concat([
    Buffer.from([0x00, 0x00]),
    Buffer.from([(sniList.length >> 8) & 0xff, sniList.length & 0xff]),
    sniList,
  ]);
  const extensions = Buffer.concat([
    Buffer.from([(sniExt.length >> 8) & 0xff, sniExt.length & 0xff]),
    sniExt,
  ]);

  const random = Buffer.alloc(32);
  const sessionId = Buffer.from([0x00]);
  const cipherSuites = Buffer.from([0x00, 0x02, 0xc0, 0x2f]);
  const compMethods = Buffer.from([0x01, 0x00]);

  const clientHelloBody = Buffer.concat([
    Buffer.from([0x03, 0x03]),
    random,
    sessionId,
    cipherSuites,
    compMethods,
    extensions,
  ]);
  const handshake = Buffer.concat([
    Buffer.from([0x01, (clientHelloBody.length >> 16) & 0xff, (clientHelloBody.length >> 8) & 0xff, clientHelloBody.length & 0xff]),
    clientHelloBody,
  ]);
  const record = Buffer.concat([
    Buffer.from([0x16, 0x03, 0x01, (handshake.length >> 8) & 0xff, handshake.length & 0xff]),
    handshake,
  ]);
  return record;
}

test("parseSni: extracts hostname from a well-formed ClientHello", () => {
  const buf = buildClientHello("api.githubcopilot.com");
  assert.equal(parseSni(buf), "api.githubcopilot.com");
});

test("parseSni: returns null for too-short buffer", () => {
  assert.equal(parseSni(Buffer.from([0x16, 0x03])), null);
});

test("parseSni: returns null for non-TLS bytes", () => {
  assert.equal(parseSni(Buffer.from("GET / HTTP/1.1\r\n\r\n", "ascii")), null);
});

test("parseSni: returns null when no SNI extension is present", () => {
  // ClientHello without extensions at all (extensions_length = 0).
  const random = Buffer.alloc(32);
  const sessionId = Buffer.from([0x00]);
  const cipherSuites = Buffer.from([0x00, 0x02, 0xc0, 0x2f]);
  const compMethods = Buffer.from([0x01, 0x00]);
  const extensions = Buffer.from([0x00, 0x00]);
  const body = Buffer.concat([
    Buffer.from([0x03, 0x03]),
    random,
    sessionId,
    cipherSuites,
    compMethods,
    extensions,
  ]);
  const handshake = Buffer.concat([
    Buffer.from([0x01, 0x00, (body.length >> 8) & 0xff, body.length & 0xff]),
    body,
  ]);
  const record = Buffer.concat([
    Buffer.from([0x16, 0x03, 0x01, (handshake.length >> 8) & 0xff, handshake.length & 0xff]),
    handshake,
  ]);
  assert.equal(parseSni(record), null);
});

function startEchoServer() {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      sock.on("data", (chunk) => sock.write(chunk));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

test("egress proxy: CONNECT establishes tunnel and emits event with destination + SNI", async () => {
  const echo = await startEchoServer();
  const cwd = makeProject();
  const proxy = await startEgressProxy({ cwd, port: 0, hostId: "test-host" });
  try {
    await new Promise((resolve, reject) => {
      const client = net.connect(proxy.port, "127.0.0.1", () => {
        client.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: 127.0.0.1:${echo.port}\r\n\r\n`);
      });
      let phase = "wait-200";
      let pending = "";
      client.on("data", (chunk) => {
        if (phase === "wait-200") {
          pending += chunk.toString();
          if (pending.includes("\r\n\r\n")) {
            assert.match(pending, /HTTP\/1\.1 200/);
            phase = "tls";
            client.write(buildClientHello("api.githubcopilot.com"));
            return;
          }
        }
        if (phase === "tls") {
          client.end();
          resolve();
        }
      });
      client.on("error", reject);
    });

    // Give the proxy a moment to flush the audit event.
    await new Promise((r) => setTimeout(r, 100));

    const date = new Date().toISOString().slice(0, 10);
    const auditFile = path.join(cwd, ".context", "audit", `host-events-${date}.jsonl`);
    assert.equal(fs.existsSync(auditFile), true, "audit file should exist");
    const events = fs
      .readFileSync(auditFile, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const egress = events.find((e) => e.event_type === "egress_connection");
    assert.ok(egress, "egress_connection event should be emitted");
    assert.equal(egress.protocol, "https");
    assert.equal(egress.destination.host, "127.0.0.1");
    assert.equal(egress.destination.port, echo.port);
    assert.equal(egress.sni, "api.githubcopilot.com");
    assert.ok(egress.bytes_client_to_server > 0);
    assert.ok(egress.bytes_server_to_client > 0);
  } finally {
    await proxy.stop();
    await new Promise((r) => echo.server.close(r));
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("egress proxy: HTTP request also logs destination", async () => {
  const echo = await startEchoServer();
  const cwd = makeProject();
  const proxy = await startEgressProxy({ cwd, port: 0, hostId: "test-host" });
  try {
    await new Promise((resolve, reject) => {
      const client = net.connect(proxy.port, "127.0.0.1", () => {
        client.write(
          `GET http://127.0.0.1:${echo.port}/health HTTP/1.1\r\nHost: 127.0.0.1:${echo.port}\r\n\r\n`,
        );
      });
      client.on("data", () => {
        client.end();
        resolve();
      });
      client.on("error", reject);
    });

    await new Promise((r) => setTimeout(r, 100));

    const date = new Date().toISOString().slice(0, 10);
    const auditFile = path.join(cwd, ".context", "audit", `host-events-${date}.jsonl`);
    const events = fs
      .readFileSync(auditFile, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const egress = events.find((e) => e.event_type === "egress_connection");
    assert.ok(egress);
    assert.equal(egress.protocol, "http");
    assert.equal(egress.destination.host, "127.0.0.1");
    assert.equal(egress.destination.port, echo.port);
    assert.equal(egress.sni, "127.0.0.1");
  } finally {
    await proxy.stop();
    await new Promise((r) => echo.server.close(r));
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("egress proxy: malformed first line returns 400 and closes", async () => {
  const cwd = makeProject();
  const proxy = await startEgressProxy({ cwd, port: 0, hostId: "test-host" });
  try {
    const got = await new Promise((resolve) => {
      const client = net.connect(proxy.port, "127.0.0.1", () => {
        client.write("garbage line\r\n\r\n");
      });
      let buf = "";
      client.on("data", (chunk) => {
        buf += chunk.toString();
      });
      client.on("close", () => resolve(buf));
    });
    assert.match(got, /400/);
  } finally {
    await proxy.stop();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("egress proxy: stop() closes the server", async () => {
  const cwd = makeProject();
  const proxy = await startEgressProxy({ cwd, port: 0, hostId: "test-host" });
  assert.equal(proxy.isRunning(), true);
  await proxy.stop();
  assert.equal(proxy.isRunning(), false);
  fs.rmSync(cwd, { recursive: true, force: true });
});
