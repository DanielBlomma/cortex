const fs = require("node:fs");
const path = require("node:path");

const statePath = process.argv[2];
const action = process.argv[3] || "show";
const arg = process.argv[4] || "";

const STEP_DEFS = [
  {
    id: "initialize",
    title: "Initialize repository context",
    command: "cortex init --bootstrap"
  },
  {
    id: "connect",
    title: "Connect MCP clients (Codex/Claude)",
    command: "cortex connect"
  },
  {
    id: "update",
    title: "Refresh context while coding",
    command: "cortex update"
  },
  {
    id: "note",
    title: "Capture decisions and TODOs",
    command: "cortex note \"title\" \"details\""
  }
];

const COMMAND_STEP_MAP = {
  init: ["initialize"],
  bootstrap: ["initialize", "update"],
  connect: ["connect"],
  update: ["update"],
  refresh: ["update"],
  ingest: ["update"],
  embed: ["update"],
  "graph-load": ["update"],
  note: ["note"]
};

function nowIso() {
  return new Date().toISOString();
}

function createDefaultState(now) {
  return {
    version: 1,
    created_at: now,
    updated_at: now,
    last_command: null,
    current_step: STEP_DEFS[0].title,
    next_command: STEP_DEFS[0].command,
    steps: STEP_DEFS.map((step) => ({
      id: step.id,
      title: step.title,
      command: step.command,
      status: "pending",
      updated_at: null
    })),
    history: [],
    next_todo_id: 1,
    todos: []
  };
}

function loadState() {
  if (!fs.existsSync(statePath)) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (!Array.isArray(parsed.steps)) {
    throw new Error("Invalid plan state: steps is missing");
  }

  if (!Array.isArray(parsed.history)) {
    parsed.history = [];
  }

  if (!Array.isArray(parsed.todos)) {
    parsed.todos = [];
  }

  if (!Number.isInteger(parsed.next_todo_id) || parsed.next_todo_id < 1) {
    parsed.next_todo_id = parsed.todos.reduce((max, todo) => Math.max(max, Number(todo.id) || 0), 0) + 1;
  }

  for (const def of STEP_DEFS) {
    if (!parsed.steps.find((step) => step.id === def.id)) {
      parsed.steps.push({
        id: def.id,
        title: def.title,
        command: def.command,
        status: "pending",
        updated_at: null
      });
    }
  }

  return parsed;
}

function saveState(state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function updateDerivedFields(state) {
  const nextStep = state.steps.find((step) => step.status !== "completed");
  if (nextStep) {
    state.current_step = nextStep.title;
    state.next_command = nextStep.command;
    return;
  }

  state.current_step = "Keep context fresh and capture decisions/TODOs";
  state.next_command = "cortex update";
}

function appendHistory(state, command, at) {
  state.last_command = {
    name: command,
    at
  };
  state.history.unshift({ command, at });
  state.history = state.history.slice(0, 100);
}

function markStepCompleted(state, stepId, at) {
  const step = state.steps.find((item) => item.id === stepId);
  if (!step) {
    return;
  }
  step.status = "completed";
  step.updated_at = at;
}

function ensureState() {
  const existing = loadState();
  if (existing) {
    return existing;
  }
  const now = nowIso();
  const created = createDefaultState(now);
  saveState(created);
  return created;
}

function parseTodoId(raw) {
  const cleaned = String(raw || "").trim().replace(/^#/, "");
  const parsed = Number(cleaned);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function printSummary(state) {
  const openTodos = state.todos.filter((todo) => todo.status === "open");
  const doneTodos = state.todos.filter((todo) => todo.status === "done");
  const stepState = state.steps.map((step) => `${step.id}=${step.status}`).join(" ");

  console.log(`[plan] current_step=${state.current_step}`);
  console.log(`[plan] next_command=${state.next_command}`);
  console.log(`[plan] steps ${stepState}`);

  if (state.last_command && state.last_command.name) {
    console.log(`[plan] last_command=${state.last_command.name} at=${state.last_command.at}`);
  }

  console.log(`[todo] open=${openTodos.length} done=${doneTodos.length}`);
  if (openTodos.length > 0) {
    console.log(`[todo] next=#${openTodos[0].id} ${openTodos[0].text}`);
  }
}

try {
  if (action === "ensure") {
    ensureState();
    process.exit(0);
  }

  if (action === "reset") {
    const now = nowIso();
    const reset = createDefaultState(now);
    saveState(reset);
    console.log(`[plan] reset ${statePath}`);
    process.exit(0);
  }

  const state = ensureState();
  const now = nowIso();

  if (action === "event") {
    const commandName = arg.trim();
    if (!commandName) {
      throw new Error("Usage: plan-state.sh event <command>");
    }

    const stepsToMark = COMMAND_STEP_MAP[commandName] || [];
    for (const stepId of stepsToMark) {
      markStepCompleted(state, stepId, now);
    }

    appendHistory(state, commandName, now);
    state.updated_at = now;
    updateDerivedFields(state);
    saveState(state);
    process.exit(0);
  }

  if (action === "show") {
    updateDerivedFields(state);
    printSummary(state);
    process.exit(0);
  }

  if (action === "todo-add") {
    const text = arg.trim();
    if (!text) {
      throw new Error('Usage: plan-state.sh todo add "<text>"');
    }

    const todo = {
      id: state.next_todo_id,
      text,
      status: "open",
      created_at: now,
      updated_at: now,
      completed_at: null
    };

    state.todos.push(todo);
    state.next_todo_id += 1;
    markStepCompleted(state, "note", now);
    appendHistory(state, "todo:add", now);
    state.updated_at = now;
    updateDerivedFields(state);
    saveState(state);
    console.log(`[todo] added #${todo.id} ${todo.text}`);
    process.exit(0);
  }

  if (action === "todo-list") {
    const openTodos = state.todos.filter((todo) => todo.status === "open");
    const doneTodos = state.todos.filter((todo) => todo.status === "done");

    if (openTodos.length === 0 && doneTodos.length === 0) {
      console.log("[todo] no todos");
      process.exit(0);
    }

    for (const todo of openTodos) {
      console.log(`[todo] [open] #${todo.id} ${todo.text}`);
    }
    for (const todo of doneTodos) {
      console.log(`[todo] [done] #${todo.id} ${todo.text}`);
    }
    process.exit(0);
  }

  if (action === "todo-done" || action === "todo-reopen" || action === "todo-remove") {
    const todoId = parseTodoId(arg);
    if (!todoId) {
      throw new Error("Usage: plan-state.sh todo <done|reopen|remove> <id>");
    }

    const index = state.todos.findIndex((todo) => Number(todo.id) === todoId);
    if (index === -1) {
      throw new Error(`TODO #${todoId} not found`);
    }

    const todo = state.todos[index];
    if (action === "todo-remove") {
      state.todos.splice(index, 1);
      appendHistory(state, "todo:remove", now);
      state.updated_at = now;
      updateDerivedFields(state);
      saveState(state);
      console.log(`[todo] removed #${todoId}`);
      process.exit(0);
    }

    if (action === "todo-done") {
      todo.status = "done";
      todo.completed_at = now;
      appendHistory(state, "todo:done", now);
      console.log(`[todo] done #${todoId} ${todo.text}`);
    } else {
      todo.status = "open";
      todo.completed_at = null;
      appendHistory(state, "todo:reopen", now);
      console.log(`[todo] reopened #${todoId} ${todo.text}`);
    }

    todo.updated_at = now;
    state.updated_at = now;
    updateDerivedFields(state);
    saveState(state);
    process.exit(0);
  }

  throw new Error(`Unknown plan-state action: ${action}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
