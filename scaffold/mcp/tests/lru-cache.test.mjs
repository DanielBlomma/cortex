import test from "node:test";
import assert from "node:assert/strict";

import { LruCache } from "../dist/lruCache.js";

test("LruCache: stores and retrieves values", () => {
  const cache = new LruCache(2);
  cache.set("a", 1);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("missing"), undefined);
});

test("LruCache: evicts the least recently used entry at capacity", () => {
  const cache = new LruCache(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a"); // refresh a; b becomes LRU
  cache.set("c", 3);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("c"), 3);
  assert.equal(cache.size, 2);
});

test("LruCache: overwriting a key refreshes it without growing", () => {
  const cache = new LruCache(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("a", 9);
  cache.set("c", 3); // evicts b, not a
  assert.equal(cache.get("a"), 9);
  assert.equal(cache.get("b"), undefined);
});

test("LruCache: rejects invalid capacity", () => {
  assert.throws(() => new LruCache(0), /positive integer/);
});
