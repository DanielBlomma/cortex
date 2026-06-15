/**
 * Shared chunk-parser registry.
 *
 * Single source of truth for "which parser handles which extension", used by
 * both the main ingest process and the worker-thread pool. Keeping one table
 * guarantees a file parses identically whether it runs inline or in a worker.
 *
 * Parsers self-initialize lazily (tree-sitter grammars load WASM on first
 * parse and cache per module instance), so a worker amortizes that cost over
 * its lifetime.
 */
import { parseCode } from "./parsers/javascript.mjs";

const parseJavaScriptCode = parseCode;
let parseVbNetCode = null;
let parseCSharpCode = null;
let parseCSharpProjectImpl = null;
let parseCppCode = null;
let parseConfigCode = null;
let parseResourcesCode = null;
let parseSqlCode = null;
let parseRustCode = null;
let parsePythonCode = null;
let parseGoCode = null;
let parseJavaCode = null;
let parseRubyCode = null;
let parseBashCode = null;
let parseVb6Code = null;
let parseMarkdownCode = null;
let isVbNetParserAvailable = () => false;
let isCSharpParserAvailableImpl = () => false;
let isCppParserAvailable = () => false;
let getCSharpParserRuntimeImpl = () => ({ available: false, reason: "parser module not loaded" });

let loadPromise = null;

// Languages whose parser runs purely in-process (JS or WASM) with no
// subprocess and no cross-file global state, so they are safe to run in a
// worker thread. csharp (Roslyn subprocess + project-wide batch parse in the
// main process), vbnet (subprocess), and cpp (clang-bridge fallback
// subprocess) stay on the main thread.
export const PARALLEL_SAFE_LANGUAGES = new Set([
  "javascript",
  "typescript",
  "python",
  "go",
  "java",
  "ruby",
  "bash",
  "sql",
  "config",
  "resource",
  "settings",
  "markdown",
  "rust",
  "vb6"
]);

export async function loadParsers() {
  if (loadPromise) {
    return loadPromise;
  }
  const loaders = [
    import("./parsers/vbnet.mjs").then((module) => {
      parseVbNetCode = module.parseCode;
      isVbNetParserAvailable =
        typeof module.isVbNetParserAvailable === "function"
          ? module.isVbNetParserAvailable
          : () => typeof module.parseCode === "function";
    }),
    import("./parsers/csharp.mjs").then((module) => {
      parseCSharpCode = module.parseCode;
      parseCSharpProjectImpl = module.parseProject ?? null;
      getCSharpParserRuntimeImpl =
        typeof module.getCSharpParserRuntime === "function"
          ? module.getCSharpParserRuntime
          : () => ({ available: typeof module.parseCode === "function", reason: "runtime details unavailable" });
      isCSharpParserAvailableImpl =
        typeof module.isCSharpParserAvailable === "function"
          ? module.isCSharpParserAvailable
          : () => typeof module.parseCode === "function";
    }),
    import("./parsers/cpp-dispatch.mjs").then((module) => {
      parseCppCode = module.parseCode;
      isCppParserAvailable =
        typeof module.isCppParserAvailable === "function"
          ? module.isCppParserAvailable
          : () => typeof module.parseCode === "function";
    }),
    import("./parsers/config.mjs").then((module) => {
      parseConfigCode = module.parseCode;
    }),
    import("./parsers/resources.mjs").then((module) => {
      parseResourcesCode = module.parseCode;
    }),
    import("./parsers/sql.mjs").then((module) => {
      parseSqlCode = module.parseCode;
    }),
    import("./parsers/rust-dispatch.mjs").then((module) => {
      parseRustCode = module.parseCode;
    }),
    import("./parsers/python-treesitter.mjs").then((module) => {
      parsePythonCode = module.parseCode;
    }),
    import("./parsers/go-treesitter.mjs").then((module) => {
      parseGoCode = module.parseCode;
    }),
    import("./parsers/java-treesitter.mjs").then((module) => {
      parseJavaCode = module.parseCode;
    }),
    import("./parsers/ruby-treesitter.mjs").then((module) => {
      parseRubyCode = module.parseCode;
    }),
    import("./parsers/bash-treesitter.mjs").then((module) => {
      parseBashCode = module.parseCode;
    }),
    import("./parsers/vb6.mjs").then((module) => {
      parseVb6Code = module.parseCode;
    }),
    import("./parsers/markdown.mjs").then((module) => {
      parseMarkdownCode = module.parseCode;
    })
  ];

  loadPromise = Promise.allSettled(loaders).then(() => undefined);
  return loadPromise;
}

const CHUNK_PARSERS = new Map([
  [".js", { language: "javascript", parse: parseJavaScriptCode }],
  [".mjs", { language: "javascript", parse: parseJavaScriptCode }],
  [".cjs", { language: "javascript", parse: parseJavaScriptCode }],
  [".ts", { language: "typescript", parse: parseJavaScriptCode }],
  [
    ".vb",
    {
      language: "vbnet",
      parse: (...args) => parseVbNetCode(...args),
      isAvailable: () => typeof parseVbNetCode === "function" && isVbNetParserAvailable()
    }
  ],
  [
    ".cs",
    {
      language: "csharp",
      parse: (...args) => parseCSharpCode(...args),
      isAvailable: () => typeof parseCSharpCode === "function" && isCSharpParserAvailableImpl()
    }
  ],
  [
    ".sql",
    {
      language: "sql",
      parse: (...args) => parseSqlCode(...args),
      isAvailable: () => typeof parseSqlCode === "function"
    }
  ],
  [
    ".md",
    {
      language: "markdown",
      parse: (...args) => parseMarkdownCode(...args),
      isAvailable: () => typeof parseMarkdownCode === "function"
    }
  ],
  [
    ".mdx",
    {
      language: "markdown",
      parse: (...args) => parseMarkdownCode(...args),
      isAvailable: () => typeof parseMarkdownCode === "function"
    }
  ],
  [
    ".config",
    {
      language: "config",
      parse: (...args) => parseConfigCode(...args),
      isAvailable: () => typeof parseConfigCode === "function"
    }
  ],
  [
    ".resx",
    {
      language: "resource",
      parse: (...args) => parseResourcesCode(...args),
      isAvailable: () => typeof parseResourcesCode === "function"
    }
  ],
  [
    ".settings",
    {
      language: "settings",
      parse: (...args) => parseResourcesCode(...args),
      isAvailable: () => typeof parseResourcesCode === "function"
    }
  ],
  [
    ".c",
    {
      language: "c",
      parse: (...args) => parseCppCode(...args),
      isAvailable: () => typeof parseCppCode === "function" && isCppParserAvailable()
    }
  ],
  [
    ".h",
    {
      language: "c",
      parse: (...args) => parseCppCode(...args),
      isAvailable: () => typeof parseCppCode === "function" && isCppParserAvailable()
    }
  ],
  [
    ".cpp",
    {
      language: "cpp",
      parse: (...args) => parseCppCode(...args),
      isAvailable: () => typeof parseCppCode === "function" && isCppParserAvailable()
    }
  ],
  [
    ".cc",
    {
      language: "cpp",
      parse: (...args) => parseCppCode(...args),
      isAvailable: () => typeof parseCppCode === "function" && isCppParserAvailable()
    }
  ],
  [
    ".hpp",
    {
      language: "cpp",
      parse: (...args) => parseCppCode(...args),
      isAvailable: () => typeof parseCppCode === "function" && isCppParserAvailable()
    }
  ],
  [
    ".hh",
    {
      language: "cpp",
      parse: (...args) => parseCppCode(...args),
      isAvailable: () => typeof parseCppCode === "function" && isCppParserAvailable()
    }
  ],
  [
    ".rs",
    {
      language: "rust",
      parse: (...args) => parseRustCode(...args),
      isAvailable: () => typeof parseRustCode === "function"
    }
  ],
  [
    ".py",
    {
      language: "python",
      parse: (...args) => parsePythonCode(...args),
      isAvailable: () => typeof parsePythonCode === "function"
    }
  ],
  [
    ".go",
    {
      language: "go",
      parse: (...args) => parseGoCode(...args),
      isAvailable: () => typeof parseGoCode === "function"
    }
  ],
  [
    ".java",
    {
      language: "java",
      parse: (...args) => parseJavaCode(...args),
      isAvailable: () => typeof parseJavaCode === "function"
    }
  ],
  [
    ".rb",
    {
      language: "ruby",
      parse: (...args) => parseRubyCode(...args),
      isAvailable: () => typeof parseRubyCode === "function"
    }
  ],
  [
    ".sh",
    {
      language: "bash",
      parse: (...args) => parseBashCode(...args),
      isAvailable: () => typeof parseBashCode === "function"
    }
  ],
  [
    ".bash",
    {
      language: "bash",
      parse: (...args) => parseBashCode(...args),
      isAvailable: () => typeof parseBashCode === "function"
    }
  ],
  [
    ".zsh",
    {
      language: "bash",
      parse: (...args) => parseBashCode(...args),
      isAvailable: () => typeof parseBashCode === "function"
    }
  ],
  [
    ".bas",
    {
      language: "vb6",
      parse: (...args) => parseVb6Code(...args),
      isAvailable: () => typeof parseVb6Code === "function"
    }
  ],
  [
    ".cls",
    {
      language: "vb6",
      parse: (...args) => parseVb6Code(...args),
      isAvailable: () => typeof parseVb6Code === "function"
    }
  ],
  [
    ".frm",
    {
      language: "vb6",
      parse: (...args) => parseVb6Code(...args),
      isAvailable: () => typeof parseVb6Code === "function"
    }
  ],
  [
    ".ctl",
    {
      language: "vb6",
      parse: (...args) => parseVb6Code(...args),
      isAvailable: () => typeof parseVb6Code === "function"
    }
  ]
]);

export function getChunkParserForExtension(ext) {
  return CHUNK_PARSERS.get(ext) ?? null;
}

// Stable wrappers so callers can import these once; they delegate to whatever
// the dynamic import populated.
export function isCSharpParserAvailable() {
  return isCSharpParserAvailableImpl();
}

export function getCSharpParserRuntime() {
  return getCSharpParserRuntimeImpl();
}

export function parseCSharpProject(inputs) {
  if (typeof parseCSharpProjectImpl !== "function") {
    return null;
  }
  return parseCSharpProjectImpl(inputs);
}

export function hasCSharpProjectParser() {
  return typeof parseCSharpProjectImpl === "function";
}

// Parse a single file with the registered parser for its extension. Used by
// the worker; returns the parser's { chunks, errors } result, or null if no
// parser is registered or it is unavailable in this process.
export async function parseFileContent(ext, content, filePath) {
  const parser = getChunkParserForExtension(ext);
  if (!parser) {
    return null;
  }
  if (typeof parser.isAvailable === "function" && !(await parser.isAvailable())) {
    return null;
  }
  return { language: parser.language, result: await parser.parse(content, filePath, parser.language) };
}
