/**
 * Tree-sitter Bash parser for Cortex.
 *
 * Extracts `function_definition` nodes as chunks — both
 * `function foo { ... }` and `foo() { ... }` styles are handled by
 * tree-sitter-bash as the same node type.
 *
 * Imports cover `source path.sh` and `. path.sh` commands at program
 * scope. Dynamic path expressions like `. "$(dirname "$0")/lib.sh"`
 * are skipped — only static `word` arguments are extracted, since
 * anything else can't be resolved at parse time.
 *
 * Call extraction captures the `command_name` of every `command`
 * node, filtered against a large list of shell builtins and
 * ubiquitous system commands so the call graph reflects user-defined
 * function calls rather than shell plumbing.
 *
 * Naming:
 *   top-level function:  name = "deploy"
 *   nested function:     name = "inner"  (shell has no real nesting scope)
 *
 * exported: true iff the function name does NOT start with an
 * underscore. Shell has no export/import model per se; this mirrors
 * the convention used by Python and Ruby parsers.
 *
 * parseCode is async; the WASM grammar is lazily loaded on first call
 * and cached for subsequent calls.
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  dedupe,
  initTreeSitter,
  lineRangeOf,
  loadGrammar,
  bodyOf,
  collectErrors,
  parseSource,
  runQuery
} from "./tree-sitter/base.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUERY_DIR = path.join(__dirname, "tree-sitter", "queries");

let BASH_LANG = null;
let langPromise = null;

async function ensureLanguage() {
  if (BASH_LANG) return BASH_LANG;
  if (!langPromise) {
    langPromise = (async () => {
      await initTreeSitter();
      BASH_LANG = await loadGrammar("bash");
      return BASH_LANG;
    })();
  }
  await langPromise;
  return BASH_LANG;
}

export async function isAvailable() {
  try {
    await ensureLanguage();
    return true;
  } catch {
    return false;
  }
}

const CHUNK_QUERY = fs.readFileSync(path.join(QUERY_DIR, "bash.chunks.scm"), "utf8");
const CALL_QUERY = fs.readFileSync(path.join(QUERY_DIR, "bash.calls.scm"), "utf8");
const IMPORT_QUERY = fs.readFileSync(path.join(QUERY_DIR, "bash.imports.scm"), "utf8");

const LOADER_COMMANDS = new Set(["source", "."]);

// Shell builtins and ubiquitous system commands. Filtered out of the
// call graph so it reflects user-defined function calls, not shell
// plumbing. Keeping this list deliberately broad — the goal is graph
// signal-to-noise, not exhaustive coverage.
const CALL_FILTER = new Set([
  // Builtins
  "echo", "printf", "read", "test", "[", "[[", "true", "false",
  "exit", "return", "break", "continue", "shift", "trap",
  "export", "unset", "set", "local", "declare", "readonly", "typeset",
  "let", "eval", "exec", "source", ".", "alias", "unalias", "type",
  "command", "builtin", "hash", "help", "jobs", "fg", "bg", "kill",
  "pwd", "cd", "pushd", "popd", "dirs", "umask", "ulimit",
  "getopts", "shopt", "enable", "history", "fc", "logout", "suspend",
  "wait", "times", "login", "complete", "compgen",
  // Common system commands
  "ls", "cat", "grep", "sed", "awk", "cut", "sort", "uniq", "wc",
  "head", "tail", "tee", "find", "xargs", "tr", "rev",
  "cp", "mv", "rm", "mkdir", "rmdir", "ln", "touch", "chmod", "chown",
  "tar", "gzip", "gunzip", "zip", "unzip", "curl", "wget",
  "git", "docker", "kubectl", "make", "npm", "yarn",
  "python", "python3", "node", "ruby", "go", "bash", "sh", "zsh",
  "env", "which", "whereis", "whoami", "id", "uname", "hostname",
  "date", "sleep", "ps", "top", "df", "du", "mount", "umount",
  "ssh", "scp", "rsync", "ping", "netstat", "ifconfig", "ip",
  "basename", "dirname", "realpath", "readlink", "file", "stat",
  "awk", "perl", "dd"
]);

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function signatureOfDecl(node) {
  const braceIndex = node.text.indexOf("{");
  if (braceIndex === -1) return normalizeWhitespace(node.text);
  return normalizeWhitespace(node.text.slice(0, braceIndex));
}

function collectCallsInNode(node) {
  const captures = runQuery(BASH_LANG, CALL_QUERY, node);
  const names = captures
    .filter((c) => c.name === "call.name")
    .map((c) => c.node.text)
    .filter((name) => {
      if (!name) return false;
      if (CALL_FILTER.has(name)) return false;
      // Strip absolute paths to compare: /usr/bin/foo -> foo
      const trimmed = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
      if (CALL_FILTER.has(trimmed)) return false;
      return true;
    });
  return dedupe(names);
}

function collectImports(rootNode) {
  const captures = runQuery(BASH_LANG, IMPORT_QUERY, rootNode);
  const imports = [];
  for (const cap of captures) {
    if (cap.name !== "import.cmd") continue;
    const cmd = cap.node;

    // Only top-level sourcing counts as an "import" — nested
    // source-calls inside function bodies are conditional runtime
    // behavior rather than declared dependencies.
    let ancestor = cmd.parent;
    let isTopLevel = true;
    while (ancestor) {
      if (
        ancestor.type === "function_definition" ||
        ancestor.type === "compound_statement" ||
        ancestor.type === "subshell"
      ) {
        isTopLevel = false;
        break;
      }
      ancestor = ancestor.parent;
    }
    if (!isTopLevel) continue;

    const nameNode = cmd.childForFieldName("name") ?? cmd.namedChild(0);
    if (!nameNode) continue;
    const commandText = nameNode.text;
    if (!LOADER_COMMANDS.has(commandText)) continue;

    // First static `word` argument is the sourced path. Dynamic
    // expressions (strings, substitutions) are skipped.
    for (let i = 0; i < cmd.namedChildCount; i += 1) {
      const child = cmd.namedChild(i);
      if (child === nameNode) continue;
      if (child.type === "word") {
        imports.push(child.text);
        break;
      }
    }
  }
  return dedupe(imports);
}

function buildFunctionChunk(node, imports, language) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const name = nameNode.text;
  const { startLine, endLine } = lineRangeOf(node);
  return {
    name,
    kind: "function",
    signature: signatureOfDecl(node),
    body: bodyOf(node),
    startLine,
    endLine,
    language,
    exported: !name.startsWith("_"),
    calls: collectCallsInNode(node),
    imports
  };
}

export async function parseCode(code, filePath, language = "bash") {
  await ensureLanguage();
  const { tree, reason } = parseSource(BASH_LANG, code);
  if (!tree) return { chunks: [], errors: [{ message: reason }] };
  const root = tree.rootNode;
  const imports = collectImports(root);

  const captures = runQuery(BASH_LANG, CHUNK_QUERY, root);
  const declCaptures = captures.filter((c) => c.name.endsWith(".decl"));

  const chunks = [];
  for (const cap of declCaptures) {
    const chunk = buildFunctionChunk(cap.node, imports, language);
    if (chunk) chunks.push(chunk);
  }

  const seen = new Set();
  const deduped = chunks.filter((chunk) => {
    const key = `${chunk.kind}|${chunk.name}|${chunk.startLine}|${chunk.endLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { chunks: deduped, errors: collectErrors(tree) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: bash-treesitter.mjs <file.sh>");
    process.exit(1);
  }
  const code = fs.readFileSync(target, "utf8");
  const result = await parseCode(code, target, "bash");
  console.log(JSON.stringify(result, null, 2));
}
