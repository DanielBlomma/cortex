import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";
import {
  runStateSchema,
  stageArtifactFrontmatterSchema,
  type RunState,
  type StageArtifactFrontmatter,
} from "./schemas.js";

/**
 * Filesystem layout for one workflow run:
 *
 *   <cwd>/.agents/<task-id>/
 *     plan.md
 *     review.md
 *     ...
 *     state.json
 *
 * All paths in this module are relative to the project's <cwd>. The caller
 * is responsible for choosing cwd; we never assume process.cwd() here so
 * tests can target a tmp directory.
 */

export const AGENTS_DIR = ".agents";
export const STATE_FILENAME = "state.json";

export function runDir(cwd: string, taskId: string): string {
  return join(cwd, AGENTS_DIR, taskId);
}

export function stateFilePath(cwd: string, taskId: string): string {
  return join(runDir(cwd, taskId), STATE_FILENAME);
}

export function artifactPath(
  cwd: string,
  taskId: string,
  artifactName: string,
): string {
  return join(runDir(cwd, taskId), artifactName);
}

const FRONTMATTER_OPEN = /^---\s*\r?\n/;
const FRONTMATTER_CLOSE = /\r?\n---\s*\r?\n/;

export type ParsedArtifact = {
  frontmatter: StageArtifactFrontmatter;
  body: string;
};

export function parseStageArtifact(text: string): ParsedArtifact {
  if (!FRONTMATTER_OPEN.test(text)) {
    throw new Error("Stage artifact is missing YAML frontmatter (--- ... ---)");
  }
  const afterOpen = text.replace(FRONTMATTER_OPEN, "");
  const closeMatch = afterOpen.match(FRONTMATTER_CLOSE);
  if (!closeMatch || closeMatch.index === undefined) {
    throw new Error("Stage artifact frontmatter is not terminated (--- ... ---)");
  }
  const yamlText = afterOpen.slice(0, closeMatch.index);
  const body = afterOpen
    .slice(closeMatch.index + closeMatch[0].length)
    .replace(/^\s+/, "")
    .replace(/\s+$/, "");

  let raw: unknown;
  try {
    raw = yaml.load(yamlText);
  } catch (err) {
    throw new Error(
      `Failed to parse stage artifact frontmatter as YAML: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const parsed = stageArtifactFrontmatterSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Stage artifact frontmatter does not match schema: ${parsed.error.message}`,
    );
  }
  return { frontmatter: parsed.data, body };
}

export function readStageArtifact(
  cwd: string,
  taskId: string,
  artifactName: string,
): ParsedArtifact {
  const path = artifactPath(cwd, taskId, artifactName);
  const text = readFileSync(path, "utf8");
  return parseStageArtifact(text);
}

export function renderStageArtifact(
  frontmatter: StageArtifactFrontmatter,
  body: string,
): string {
  const yamlText = yaml.dump(frontmatter, {
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  });
  const trimmedBody = body.trim();
  return `---\n${yamlText}---\n\n${trimmedBody}\n`;
}

export function writeStageArtifact(
  cwd: string,
  taskId: string,
  artifactName: string,
  frontmatter: StageArtifactFrontmatter,
  body: string,
): string {
  const dir = runDir(cwd, taskId);
  mkdirSync(dir, { recursive: true });
  const path = artifactPath(cwd, taskId, artifactName);
  writeFileSync(path, renderStageArtifact(frontmatter, body), "utf8");
  return path;
}

export function readRunState(cwd: string, taskId: string): RunState | null {
  const path = stateFilePath(cwd, taskId);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `Failed to parse run state at ${path}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const parsed = runStateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Run state at ${path} does not match schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function writeRunState(cwd: string, state: RunState): string {
  const validated = runStateSchema.parse(state);
  const dir = runDir(cwd, validated.task_id);
  mkdirSync(dir, { recursive: true });
  const path = stateFilePath(cwd, validated.task_id);
  writeFileSync(path, JSON.stringify(validated, null, 2) + "\n", "utf8");
  return path;
}
