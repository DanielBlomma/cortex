export const SUPPORTED_TEXT_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".adoc",
  ".rst",
  ".yaml",
  ".yml",
  ".json",
  ".toml",
  ".csv",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".java",
  ".cs",
  ".vb",
  ".sln",
  ".vbproj",
  ".csproj",
  ".fsproj",
  ".props",
  ".targets",
  ".config",
  ".resx",
  ".settings",
  ".rb",
  ".rs",
  ".php",
  ".swift",
  ".kt",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".hh",
  ".bas",
  ".cls",
  ".frm",
  ".ctl"
]);

export const LEGACY_DOTNET_METADATA_EXTENSIONS = new Set([
  ".sln",
  ".vbproj",
  ".csproj",
  ".fsproj",
  ".props",
  ".targets",
  ".config",
  ".resx",
  ".settings"
]);

export const PROJECT_DEFINITION_EXTENSIONS = new Set([".sln", ".vbproj", ".csproj", ".fsproj", ".vcxproj"]);
export const STRUCTURED_NON_CODE_CHUNK_EXTENSIONS = new Set([".config", ".resx", ".settings", ".md", ".mdx"]);

export const CODE_FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".java",
  ".cs",
  ".vb",
  ".rb",
  ".rs",
  ".php",
  ".swift",
  ".kt",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".hh",
  ".bas",
  ".cls",
  ".frm",
  ".ctl"
]);

export const SQL_REFERENCE_SOURCE_EXTENSIONS = new Set([
  ".vb",
  ".cs",
  ".config",
  ".resx",
  ".settings"
]);
export const NAMED_RESOURCE_REFERENCE_SOURCE_EXTENSIONS = new Set([".vb", ".cs"]);

export const SQL_OBJECT_REFERENCE_PATTERNS = [
  /\b(?:SqlCommand|OleDbCommand|OdbcCommand)\s*\(\s*"([^"\r\n]{2,200})"/gi,
  /\bCommandText\s*=\s*"([^"\r\n]{2,500})"/gi,
  /\bCommandType\s*=\s*(?:CommandType\.)?StoredProcedure[\s\S]{0,240}?"([^"\r\n]{2,200})"/gi,
  /"([^"\r\n]{2,200})"[\s\S]{0,240}?\bCommandType\s*=\s*(?:CommandType\.)?StoredProcedure/gi
];

export const SQL_STRING_REFERENCE_PATTERNS = [
  /\bexec(?:ute)?\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bfrom\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bjoin\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bupdate\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\binsert\s+into\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bdelete\s+from\s+([#@]?[A-Za-z0-9_[\].]+)/gi,
  /\bmerge\s+into\s+([#@]?[A-Za-z0-9_[\].]+)/gi
];

export const SQL_RESOURCE_KEY_PATTERNS = [
  /\bMy\.Resources\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /\bResources\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /\bMy\.Settings\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /\b(?:[A-Za-z_][A-Za-z0-9_]*\.)?Settings\.Default\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /\bGetString\(\s*"([^"\r\n]+)"/g,
  /\bGetObject\(\s*"([^"\r\n]+)"/g
];
export const CONFIG_KEY_REFERENCE_PATTERNS = [
  /\bConfigurationManager\.ConnectionStrings\s*\[\s*"([^"\r\n]+)"\s*\]/g,
  /\bConfigurationManager\.ConnectionStrings\s*\(\s*"([^"\r\n]+)"\s*\)/g,
  /\bConfigurationManager\.AppSettings\s*\[\s*"([^"\r\n]+)"\s*\]/g,
  /\bConfigurationManager\.AppSettings\s*\(\s*"([^"\r\n]+)"\s*\)/g,
  /\bGetConnectionString\(\s*"([^"\r\n]+)"\s*\)/g,
  /\bGetAppSetting\(\s*"([^"\r\n]+)"\s*\)/g
];

export const SKIP_DIRECTORIES = new Set([
  ".git",
  ".idea",
  ".vscode",
  "node_modules",
  "bin",
  "obj",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  ".context"
]);

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_CONTENT_CHARS = 60000;
export const MAX_BODY_CHARS = 12000;
export const RULE_KEYWORD_LIMIT = 20;
export const DEFAULT_CHUNK_WINDOW_LINES = 80;
export const DEFAULT_CHUNK_OVERLAP_LINES = 16;
export const DEFAULT_CHUNK_SPLIT_MIN_LINES = 120;
export const DEFAULT_CHUNK_MAX_WINDOWS = 8;
export const IMPORT_RESOLUTION_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
export const IMPORT_RUNTIME_JS_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"]);
export const IMPORT_RUNTIME_JS_RESOLUTION_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
export const CPP_IMPORT_RESOLUTION_EXTENSIONS = [".h", ".hh", ".hpp", ".c", ".cc", ".cpp"];

export const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "must",
  "when",
  "where",
  "into",
  "used",
  "using",
  "only",
  "true",
  "false",
  "unless",
  "should",
  "global",
  "active",
  "rule",
  "rules",
  "data",
  "file",
  "files",
  "code",
  "docs",
  "context",
  "och",
  "det",
  "att",
  "som",
  "med",
  "för",
  "utan",
  "eller",
  "inte",
  "ska",
  "skall",
  "måste",
  "kan",
  "vid",
  "alla"
]);
