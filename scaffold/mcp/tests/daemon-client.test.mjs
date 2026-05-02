import test from "node:test";
import assert from "node:assert/strict";

import { isProcessAlive } from "../dist/daemon/client.js";

test("isProcessAlive: treats EPERM from signal 0 as alive", () => {
  const originalKill = process.kill;
  process.kill = () => {
    const err = new Error("operation not permitted");
    err.code = "EPERM";
    throw err;
  };
  try {
    assert.equal(isProcessAlive(12345), true);
  } finally {
    process.kill = originalKill;
  }
});

test("isProcessAlive: returns false for ESRCH", () => {
  const originalKill = process.kill;
  process.kill = () => {
    const err = new Error("no such process");
    err.code = "ESRCH";
    throw err;
  };
  try {
    assert.equal(isProcessAlive(12345), false);
  } finally {
    process.kill = originalKill;
  }
});
