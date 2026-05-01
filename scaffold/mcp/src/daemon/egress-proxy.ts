import { createServer, connect, type Server, type Socket } from "node:net";
import { hostname } from "node:os";
import { writeHostAuditEvent } from "./ungoverned-scanner.js";

/**
 * Phase 4 task 19 — cortex egress proxy.
 *
 * Listens on a local TCP port for HTTP CONNECT (https-proxy) requests.
 * Pipes bytes through transparently; does NOT terminate TLS. Inspects
 * only:
 *   - the CONNECT line for the destination host:port
 *   - the first client chunk for the TLS ClientHello SNI extension
 *
 * Per privacy boundary v3 we never send payload bytes to cortex-web —
 * only SNI + destination + bytes-transferred counters. The audit lands
 * in .context/audit/host-events-YYYY-MM-DD.jsonl as event_type =
 * "egress_connection". The host-events pusher (Fas 7) then forwards
 * those to cortex-web on the periodic timer.
 *
 * Plain HTTP (non-CONNECT) is also supported but logged with the Host
 * header in place of SNI.
 */

const CONNECT_RE = /^CONNECT\s+([^\s:]+):(\d+)\s+HTTP\/1\.[01]/i;
const HTTP_RE = /^([A-Z]+)\s+(http:\/\/[^\s]+)\s+HTTP\/1\.[01]/i;

export type EgressEvent = {
  event_type: "egress_connection";
  timestamp: string;
  host_id: string;
  source_port: number | null;
  destination: { host: string; port: number };
  protocol: "https" | "http";
  sni: string | null;
  bytes_client_to_server: number;
  bytes_server_to_client: number;
  duration_ms: number;
  closed_by: "client" | "server" | "error";
  error: string | null;
};

/**
 * Parse SNI from a TLS ClientHello buffer. Returns null if not found
 * or buffer is malformed. Does not mutate the buffer.
 */
export function parseSni(buf: Buffer): string | null {
  if (buf.length < 11) return null;
  if (buf[0] !== 0x16) return null;
  if (buf[1] !== 0x03) return null;

  const recordLen = buf.readUInt16BE(3);
  const recordEnd = 5 + recordLen;
  if (buf.length < recordEnd) return null;

  if (buf[5] !== 0x01) return null;
  const handshakeLen = (buf[6] << 16) | (buf[7] << 8) | buf[8];
  const handshakeEnd = 9 + handshakeLen;
  if (buf.length < Math.min(handshakeEnd, recordEnd)) return null;

  let p = 9 + 2 + 32;
  if (p + 1 > recordEnd) return null;
  const sessionIdLen = buf[p];
  p += 1 + sessionIdLen;
  if (p + 2 > recordEnd) return null;
  const cipherSuitesLen = buf.readUInt16BE(p);
  p += 2 + cipherSuitesLen;
  if (p + 1 > recordEnd) return null;
  const compMethodsLen = buf[p];
  p += 1 + compMethodsLen;
  if (p + 2 > recordEnd) return null;
  const extensionsLen = buf.readUInt16BE(p);
  p += 2;
  const extensionsEnd = p + extensionsLen;
  if (extensionsEnd > recordEnd) return null;

  while (p + 4 <= extensionsEnd) {
    const extType = buf.readUInt16BE(p);
    const extLen = buf.readUInt16BE(p + 2);
    const extEnd = p + 4 + extLen;
    if (extEnd > extensionsEnd) return null;
    if (extType === 0x0000) {
      let q = p + 4;
      if (q + 2 > extEnd) return null;
      const listLen = buf.readUInt16BE(q);
      q += 2;
      const listEnd = q + listLen;
      if (listEnd > extEnd) return null;
      while (q + 3 <= listEnd) {
        const nameType = buf[q];
        const nameLen = buf.readUInt16BE(q + 1);
        q += 3;
        if (q + nameLen > listEnd) return null;
        if (nameType === 0x00) {
          return buf.subarray(q, q + nameLen).toString("ascii");
        }
        q += nameLen;
      }
      return null;
    }
    p = extEnd;
  }
  return null;
}

export type ProxyOptions = {
  cwd: string;
  port?: number;
  hostId?: string;
};

export type ProxyHandle = {
  port: number;
  stop(): Promise<void>;
  isRunning(): boolean;
};

const HTTP_OK = "HTTP/1.1 200 Connection Established\r\nProxy-Agent: cortex-egress\r\n\r\n";
const HTTP_BAD = "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n";
const HTTP_BAD_GATEWAY = "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n";

function emit(cwd: string, evt: EgressEvent): void {
  void writeHostAuditEvent(cwd, evt as unknown as Record<string, unknown>).catch((err) => {
    process.stderr.write(
      `[cortex-egress] audit emit failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  });
}

function newEvent(host: string, port: number, protocol: "https" | "http", hostId: string, sourcePort: number | null): EgressEvent {
  return {
    event_type: "egress_connection",
    timestamp: new Date().toISOString(),
    host_id: hostId,
    source_port: sourcePort,
    destination: { host, port },
    protocol,
    sni: null,
    bytes_client_to_server: 0,
    bytes_server_to_client: 0,
    duration_ms: 0,
    closed_by: "client",
    error: null,
  };
}

function pipeWithCounting(
  client: Socket,
  upstream: Socket,
  evt: EgressEvent,
  cwd: string,
  start: number,
): void {
  let firstClientChunk = true;
  client.on("data", (chunk) => {
    evt.bytes_client_to_server += chunk.length;
    if (firstClientChunk && evt.protocol === "https") {
      firstClientChunk = false;
      const sni = parseSni(chunk);
      if (sni) evt.sni = sni;
    }
    upstream.write(chunk);
  });
  upstream.on("data", (chunk) => {
    evt.bytes_server_to_client += chunk.length;
    client.write(chunk);
  });

  const finalize = (closer: "client" | "server" | "error", error: string | null = null) => {
    if (evt.duration_ms > 0) return;
    evt.duration_ms = Date.now() - start;
    evt.closed_by = closer;
    evt.error = error;
    emit(cwd, evt);
    try {
      client.destroy();
    } catch {
      // ignore
    }
    try {
      upstream.destroy();
    } catch {
      // ignore
    }
  };

  client.on("end", () => finalize("client"));
  upstream.on("end", () => finalize("server"));
  client.on("error", (err) => finalize("error", err.message));
  upstream.on("error", (err) => finalize("error", err.message));
}

function handleConnect(
  client: Socket,
  host: string,
  port: number,
  cwd: string,
  hostId: string,
): void {
  const evt = newEvent(host, port, "https", hostId, client.remotePort ?? null);
  const start = Date.now();
  const upstream = connect({ host, port }, () => {
    client.write(HTTP_OK);
    pipeWithCounting(client, upstream, evt, cwd, start);
  });
  upstream.on("error", (err) => {
    evt.duration_ms = Date.now() - start;
    evt.closed_by = "error";
    evt.error = `upstream connect: ${err.message}`;
    emit(cwd, evt);
    try {
      client.write(HTTP_BAD_GATEWAY);
      client.destroy();
    } catch {
      // ignore
    }
  });
}

function handleHttp(
  client: Socket,
  url: URL,
  initialChunk: Buffer,
  cwd: string,
  hostId: string,
): void {
  const port = url.port ? parseInt(url.port, 10) : 80;
  const evt = newEvent(url.hostname, port, "http", hostId, client.remotePort ?? null);
  evt.sni = url.hostname;
  const start = Date.now();
  const upstream = connect({ host: url.hostname, port }, () => {
    upstream.write(initialChunk);
    pipeWithCounting(client, upstream, evt, cwd, start);
  });
  upstream.on("error", (err) => {
    evt.duration_ms = Date.now() - start;
    evt.closed_by = "error";
    evt.error = `upstream connect: ${err.message}`;
    emit(cwd, evt);
    try {
      client.write(HTTP_BAD_GATEWAY);
      client.destroy();
    } catch {
      // ignore
    }
  });
}

function handleConnection(client: Socket, cwd: string, hostId: string): void {
  let buffer = Buffer.alloc(0);

  const onFirstChunk = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      if (buffer.length > 8192) {
        client.write(HTTP_BAD);
        client.destroy();
        return;
      }
      client.once("data", onFirstChunk);
      return;
    }
    const headers = buffer.subarray(0, headerEnd).toString("ascii");
    const remainder = buffer.subarray(headerEnd + 4);
    const firstLine = headers.split(/\r?\n/, 1)[0] ?? "";

    const connectMatch = firstLine.match(CONNECT_RE);
    if (connectMatch) {
      const host = connectMatch[1];
      const port = parseInt(connectMatch[2], 10);
      handleConnect(client, host, port, cwd, hostId);
      return;
    }

    const httpMatch = firstLine.match(HTTP_RE);
    if (httpMatch) {
      let url: URL;
      try {
        url = new URL(httpMatch[2]);
      } catch {
        client.write(HTTP_BAD);
        client.destroy();
        return;
      }
      const path = url.pathname + url.search;
      const rebuilt = `${httpMatch[1]} ${path} HTTP/1.1\r\n${headers.split(/\r?\n/).slice(1).join("\r\n")}\r\n\r\n`;
      const initial = Buffer.concat([Buffer.from(rebuilt, "ascii"), remainder]);
      handleHttp(client, url, initial, cwd, hostId);
      return;
    }

    client.write(HTTP_BAD);
    client.destroy();
  };

  client.once("data", onFirstChunk);
  client.on("error", () => {
    try {
      client.destroy();
    } catch {
      // ignore
    }
  });
}

export function startEgressProxy(options: ProxyOptions): Promise<ProxyHandle> {
  const port = options.port ?? 18888;
  const hostId = options.hostId ?? hostname();
  const cwd = options.cwd;

  return new Promise((resolve, reject) => {
    const server: Server = createServer((client) => handleConnection(client, cwd, hostId));
    server.once("error", (err) => {
      reject(err);
    });
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      let running = true;
      resolve({
        port: actualPort,
        async stop(): Promise<void> {
          if (!running) return;
          running = false;
          await new Promise<void>((res) => server.close(() => res()));
        },
        isRunning: () => running,
      });
    });
  });
}
