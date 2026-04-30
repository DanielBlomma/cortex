import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Directories skipped while walking the project for a scope=all review.
// Common build/vendor conventions across JS/Python/Go/Rust/C#/Java
// ecosystems; keep permissive enough that individual validators still do
// their own per-language filtering.
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "target",
  "bin",
  "obj",
  ".venv",
  "venv",
  "__pycache__",
  ".nuxt",
  "vendor",
  ".terraform",
  "coverage",
  ".cache",
  ".turbo",
]);

const TEXT_EXT_RE =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|ini|env|config|xml|properties|tf|tfvars|sh|ps1|py|cs|vb|java|go|rs|rb|php|sql|md|txt|html?|css|scss|less)$/i;

// Extensionless text files the secrets validator cares about: dotenv
// variants and .NET appsettings.*
const PATH_EXTRA_RE = /(?:^|\/)\.env(?:\.|$)|(?:^|\/)appsettings(?:\.|$)/i;

const DEFAULT_MAX_FILES = 10_000;

export type WalkOptions = {
  maxFiles?: number;
};

// Recursively list project-relative text file paths under `root`. Used as
// the file set for scope=all reviews and as a fallback when scope=changed
// cannot resolve a git diff (non-git working copy, git missing, etc.).
export function walkProjectFiles(root: string, options: WalkOptions = {}): string[] {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const results: string[] = [];

  function walk(dir: string): void {
    if (results.length >= maxFiles) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (results.length >= maxFiles) return;
      if (EXCLUDED_DIRS.has(name)) continue;
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(abs);
      } else if (st.isFile()) {
        const rel = relative(root, abs).split(sep).join("/");
        if (TEXT_EXT_RE.test(rel) || PATH_EXTRA_RE.test(rel)) {
          results.push(rel);
        }
      }
    }
  }

  walk(root);
  return results;
}
