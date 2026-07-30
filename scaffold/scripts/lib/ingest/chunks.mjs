import fs from "node:fs";
import path from "node:path";
import { MAX_BODY_CHARS } from "./constants.mjs";
import { checksum, normalizeWhitespace } from "./files.mjs";
import { REPO_ROOT } from "./runtime-paths.mjs";

export function chunkIdFor(filePath, chunk) {
  const startLine = Number.isFinite(chunk.startLine) ? chunk.startLine : 0;
  const endLine = Number.isFinite(chunk.endLine) ? chunk.endLine : startLine;
  return `chunk:${filePath}:${chunk.name}:${startLine}-${endLine}`;
}

export function generateChunkDescription(chunk) {
  const parts = [chunk.kind];
  if (chunk.exported) parts.push("exported");
  if (chunk.async) parts.push("async");
  parts.push(chunk.signature);

  if (typeof chunk.description === "string" && chunk.description.trim().length > 10) {
    parts.push(normalizeWhitespace(chunk.description).slice(0, 200));
  }

  // Extract leading JSDoc/comment from body
  // Match leading JSDoc (/** */), block (/* */) and line (//) comments
  const commentMatch = chunk.body.match(/^(?:\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)[\s\n]*)+/);
  if (commentMatch) {
    const cleaned = commentMatch[0]
      .replace(/\/\*\*|\*\/|\*|\/\//g, "")
      .replace(/\s+/g, " ").trim()
      .slice(0, 200);
    if (cleaned.length > 10) parts.push(cleaned);
  }

  return parts.join(". ") + ".";
}

export function generateModuleSummary(dir, files, exportNames, repoRoot = REPO_ROOT) {
  // Check for README.md in directory
  const readmePath = path.join(repoRoot, dir, "README.md");
  if (fs.existsSync(readmePath)) {
    try {
      const content = fs.readFileSync(readmePath, "utf8");
      // Skip first heading line, take first 300 chars
      const lines = content.split(/\r?\n/);
      const startIdx = lines.findIndex(l => !l.startsWith("#") && l.trim().length > 0);
      if (startIdx >= 0) {
        const excerpt = lines.slice(startIdx).join(" ").trim().slice(0, 300);
        if (excerpt.length > 20) return excerpt;
      }
    } catch {
      // fall through to auto-generated summary
    }
  }

  const name = path.basename(dir);
  const codeFiles = files.filter(f => f.kind === "CODE");
  const docFiles = files.filter(f => f.kind !== "CODE");

  const parts = [`Module ${name}`];
  parts.push(`Contains ${files.length} files (${codeFiles.length} code, ${docFiles.length} docs)`);

  // Detect common file extension pattern
  const exts = new Set(codeFiles.map(f => path.extname(f.path).toLowerCase()));
  if (exts.size === 1) {
    const ext = [...exts][0];
    const extNames = {
      ".ts": "TypeScript",
      ".tsx": "TypeScript React",
      ".mts": "TypeScript ESM",
      ".cts": "TypeScript CommonJS",
      ".js": "JavaScript",
      ".jsx": "JavaScript React",
      ".mjs": "JavaScript ESM",
      ".cjs": "JavaScript CommonJS"
    };
    if (extNames[ext]) parts.push(`${extNames[ext]} source files`);
  }

  if (exportNames.length > 0) {
    parts.push(`Key exports: ${exportNames.slice(0, 5).join(", ")}`);
  }

  return parts.join(". ") + ".";
}

export function generateModules(fileRecords, chunkRecords) {
  const dirFiles = new Map();
  const dirChunks = new Map();
  const fileById = new Map(fileRecords.map(f => [f.id, f]));

  for (const file of fileRecords) {
    const dir = path.dirname(file.path);
    if (!dirFiles.has(dir)) dirFiles.set(dir, []);
    dirFiles.get(dir).push(file);
  }

  for (const chunk of chunkRecords) {
    if (!chunk.exported || isWindowChunkId(chunk.id)) continue;
    const file = fileById.get(chunk.file_id);
    if (!file) continue;
    const dir = path.dirname(file.path);
    if (!dirChunks.has(dir)) dirChunks.set(dir, []);
    dirChunks.get(dir).push(chunk);
  }

  const modules = [];
  const containsRelations = [];
  const containsModuleRelations = [];
  const exportsRelations = [];

  const MIN_MODULE_FILES = 2;

  for (const [dir, files] of dirFiles) {
    if (files.length < MIN_MODULE_FILES) continue;

    const exports = dirChunks.get(dir) || [];
    const exportNames = [...new Set(exports.slice(0, 20).map(c => c.name))];
    const moduleId = `module:${dir}`;

    modules.push({
      id: moduleId,
      path: dir,
      name: path.basename(dir),
      summary: generateModuleSummary(dir, files, exportNames),
      file_count: files.length,
      exported_symbols: exportNames.join(", "),
      updated_at: files.reduce((latest, f) => f.updated_at > latest ? f.updated_at : latest, ""),
      source_of_truth: false,
      trust_level: 75,
      status: "active"
    });

    // CONTAINS: Module -> File
    for (const file of files) {
      containsRelations.push({ from: moduleId, to: file.id });
    }

    // EXPORTS: Module -> Chunk
    for (const chunk of exports) {
      exportsRelations.push({ from: moduleId, to: chunk.id });
    }
  }

  // CONTAINS_MODULE: parent Module -> child Module
  const moduleDirs = new Set(modules.map(m => m.path));
  for (const dir of moduleDirs) {
    const parent = path.dirname(dir);
    if (parent !== dir && moduleDirs.has(parent)) {
      containsModuleRelations.push({
        from: `module:${parent}`,
        to: `module:${dir}`
      });
    }
  }

  return { modules, containsRelations, containsModuleRelations, exportsRelations };
}

export function isWindowChunkId(chunkId) {
  return typeof chunkId === "string" && chunkId.includes(":window:");
}

export function splitChunkIntoWindows(chunkRecord, options) {
  const { windowLines, overlapLines, splitMinLines, maxWindows, chunkBody } = options;
  const sourceBody = typeof chunkBody === "string" ? chunkBody : chunkRecord.body;
  const lines = sourceBody.split(/\r?\n/);
  const totalLines = lines.length;
  if (totalLines < splitMinLines || totalLines <= windowLines) {
    return [];
  }

  const windows = [];
  const safeOverlap = Math.max(0, Math.min(overlapLines, windowLines - 1));
  let start = 0;
  let windowIndex = 1;

  while (start < totalLines && windows.length < maxWindows) {
    const isLastAllowedWindow = windows.length + 1 >= maxWindows;
    const end = isLastAllowedWindow ? totalLines : Math.min(totalLines, start + windowLines);
    const windowStartLine = chunkRecord.start_line + start;
    const windowEndLine = chunkRecord.start_line + Math.max(0, end - 1);
    const windowBody = lines.slice(start, end).join("\n");
    const persistedBody = isLastAllowedWindow ? windowBody : windowBody.slice(0, MAX_BODY_CHARS);
    windows.push({
      id: `${chunkRecord.id}:window:${windowIndex}:${windowStartLine}-${windowEndLine}`,
      file_id: chunkRecord.file_id,
      name: `${chunkRecord.name}#window${windowIndex}`,
      kind: chunkRecord.kind,
      signature: `${chunkRecord.signature} [window ${windowIndex}]`,
      body: persistedBody,
      description: chunkRecord.description || "",
      start_line: windowStartLine,
      end_line: windowEndLine,
      language: chunkRecord.language,
      exported: chunkRecord.exported || false,
      checksum: checksum(Buffer.from(windowBody)),
      updated_at: chunkRecord.updated_at,
      trust_level: chunkRecord.trust_level,
      status: chunkRecord.status,
      source_of_truth: chunkRecord.source_of_truth
    });

    if (end >= totalLines) {
      break;
    }

    start = end - safeOverlap;
    windowIndex += 1;
  }

  return windows;
}
