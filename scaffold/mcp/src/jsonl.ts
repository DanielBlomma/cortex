import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { JsonObject, JsonValue } from "./types.js";

function parseJsonlLine(line: string): JsonObject | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as JsonObject;
  } catch {
    return null;
  }
}

export function* readJsonlRecords(filePath: string): Generator<JsonObject> {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const fd = fs.openSync(filePath, "r");
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let carry = "";

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }

      carry += decoder.write(buffer.subarray(0, bytesRead));
      let lineStart = 0;
      let newlineIndex = carry.indexOf("\n", lineStart);
      while (newlineIndex !== -1) {
        const parsed = parseJsonlLine(carry.slice(lineStart, newlineIndex));
        if (parsed) {
          yield parsed;
        }
        lineStart = newlineIndex + 1;
        newlineIndex = carry.indexOf("\n", lineStart);
      }
      carry = carry.slice(lineStart);
    }

    carry += decoder.end();
    const parsed = parseJsonlLine(carry);
    if (parsed) {
      yield parsed;
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function readJsonl(filePath: string): JsonObject[] {
  return Array.from(readJsonlRecords(filePath));
}

export function writeJsonlRecords(filePath: string, records: Iterable<unknown>): number {
  const fd = fs.openSync(filePath, "w");
  let count = 0;

  try {
    for (const record of records) {
      fs.writeSync(fd, `${JSON.stringify(record)}\n`, undefined, "utf8");
      count += 1;
    }
  } finally {
    fs.closeSync(fd);
  }

  return count;
}

export function asString(value: JsonValue | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(value: JsonValue | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asBoolean(value: JsonValue | undefined, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}
