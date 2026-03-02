import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(__dirname, "..", "scripts", "plan-state-engine.cjs");
const TMP_STATE = path.join(__dirname, ".tmp-test-state.json");

function run(action, arg = "") {
  const cmd = `node "${ENGINE}" "${TMP_STATE}" ${action} ${arg}`.trim();
  return execSync(cmd, { encoding: "utf-8" });
}

function cleanup() {
  try { fs.unlinkSync(TMP_STATE); } catch {}
}

function readState() {
  return JSON.parse(fs.readFileSync(TMP_STATE, "utf-8"));
}

let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}

console.log("plan-state-engine tests\n");

// 1. Default state
cleanup();
console.log("1. Default state creation");
run("show");
assert("creates state file", fs.existsSync(TMP_STATE));
const s1 = readState();
assert("has steps", s1.steps.length > 0);
assert("all steps pending", s1.steps.every(s => s.status === "pending"));

// 2. Event tracking
console.log("\n2. Event tracking");
run("event", "init");
const s2 = readState();
assert("records history", s2.history.length >= 1);
const initStep = s2.steps.find(s => s.id === "initialize");
assert("marks initialize done", initStep && (initStep.status === "done" || initStep.status === "completed"));

// 3. Todo add
console.log("\n3. TODO add");
run("todo-add", '"Write integration tests"');
const s3 = readState();
assert("adds todo", s3.todos.length === 1);
assert("todo is open", s3.todos[0].status === "open");

// 4. Todo done
console.log("\n4. TODO done");
const todoId = s3.todos[0].id;
run("todo-done", todoId);
const s4 = readState();
assert("marks done", s4.todos[0].status === "done");

// 5. Todo reopen
console.log("\n5. TODO reopen");
run("todo-reopen", todoId);
const s5 = readState();
assert("reopens", s5.todos[0].status === "open");

// 6. Todo remove
console.log("\n6. TODO remove");
run("todo-remove", todoId);
const s6 = readState();
assert("removes todo", s6.todos.length === 0);

// 7. Reset
console.log("\n7. Reset");
run("reset");
const s7 = readState();
assert("resets steps", s7.steps.every(s => s.status === "pending"));
assert("clears history", s7.history.length === 0);

cleanup();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
