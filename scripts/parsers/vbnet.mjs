#!/usr/bin/env node
/**
 * Conditional VB.NET parser bridge for Cortex.
 *
 * Uses a Roslyn sidecar via a pre-published DLL when a .NET SDK is available.
 * On first use the sidecar is published to bin/Release/<tfm>/publish/ and the
 * DLL path is cached; subsequent invocations skip the msbuild cycle and run
 * `dotnet <dll>` directly — roughly 10× faster per call than `dotnet run`.
 *
 * If no runtime/SDK exists, callers should skip structured chunk extraction
 * and fall back to plain file-level indexing.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DOTNET_COMMAND = "dotnet";
const DEFAULT_PROJECT_PATH = path.join(__dirname, "dotnet", "VbNetParser", "VbNetParser.csproj");
const DEFAULT_TARGET_FRAMEWORK = "net8.0";

let runtimeCache = null;
let publishCache = null;

function getDotnetCommand() {
  const override = process.env.CORTEX_DOTNET_CMD;
  return override && override.trim().length > 0 ? override.trim() : DEFAULT_DOTNET_COMMAND;
}

function getProjectPath() {
  const override = process.env.CORTEX_VBNET_PARSER_PROJECT;
  return override && override.trim().length > 0 ? override.trim() : DEFAULT_PROJECT_PATH;
}

function getTargetFramework() {
  const override = process.env.CORTEX_VBNET_PARSER_TFM;
  return override && override.trim().length > 0 ? override.trim() : DEFAULT_TARGET_FRAMEWORK;
}

function getPublishDir() {
  const override = process.env.CORTEX_VBNET_PUBLISH_DIR;
  if (override && override.trim().length > 0) return override.trim();
  const projectDir = path.dirname(getProjectPath());
  return path.join(projectDir, "bin", "Release", getTargetFramework(), "publish");
}

function getDllPath() {
  return path.join(getPublishDir(), "VbNetParser.dll");
}

function getMaxSourceMtime() {
  const projectDir = path.dirname(getProjectPath());
  const sources = [getProjectPath(), path.join(projectDir, "Program.cs")];
  let max = 0;
  for (const src of sources) {
    try {
      const mtime = fs.statSync(src).mtimeMs;
      if (mtime > max) max = mtime;
    } catch {
      // missing source — treated as stale below
    }
  }
  return max;
}

function needsPublish() {
  const dll = getDllPath();
  let dllMtime;
  try {
    dllMtime = fs.statSync(dll).mtimeMs;
  } catch {
    return true;
  }
  return getMaxSourceMtime() > dllMtime;
}

export function resetVbNetParserRuntimeCache() {
  runtimeCache = null;
  publishCache = null;
}

export function getVbNetParserRuntime() {
  if (runtimeCache) {
    return runtimeCache;
  }

  const command = getDotnetCommand();
  const versionProbe = spawnSync(command, ["--version"], {
    encoding: "utf8",
    timeout: 5000
  });

  if (versionProbe.error || versionProbe.status !== 0) {
    runtimeCache = {
      available: false,
      command,
      projectPath: getProjectPath(),
      reason:
        versionProbe.error?.message ||
        versionProbe.stderr?.trim() ||
        "dotnet runtime not available"
    };
    return runtimeCache;
  }

  runtimeCache = {
    available: true,
    command,
    projectPath: getProjectPath(),
    version: versionProbe.stdout.trim()
  };
  return runtimeCache;
}

export function isVbNetParserAvailable() {
  return getVbNetParserRuntime().available;
}

export function ensureVbNetParserPublished() {
  if (publishCache) return publishCache;

  const runtime = getVbNetParserRuntime();
  if (!runtime.available) {
    publishCache = { ok: false, reason: runtime.reason };
    return publishCache;
  }

  const dllPath = getDllPath();
  if (!needsPublish()) {
    publishCache = { ok: true, dllPath };
    return publishCache;
  }

  if (!process.env.CORTEX_QUIET) {
    process.stderr.write("[cortex] Publishing Roslyn VB.NET parser (one-time, ~15s)...\n");
  }

  const result = spawnSync(
    runtime.command,
    [
      "publish",
      runtime.projectPath,
      "-c", "Release",
      "-o", getPublishDir(),
      "--nologo",
      "-v", "quiet"
    ],
    { encoding: "utf8", timeout: 180000 }
  );

  if (result.error || result.status !== 0) {
    publishCache = {
      ok: false,
      reason:
        result.error?.message ||
        result.stderr?.trim() ||
        `dotnet publish failed with exit code ${result.status ?? "unknown"}`
    };
    return publishCache;
  }

  publishCache = { ok: true, dllPath };
  return publishCache;
}

export function parseCode(code, filePath, language = "vbnet") {
  const runtime = getVbNetParserRuntime();
  if (!runtime.available) {
    return { chunks: [], errors: [] };
  }

  const published = ensureVbNetParserPublished();
  if (!published.ok) {
    return {
      chunks: [],
      errors: [{ message: `VB.NET parser publish failed: ${published.reason}` }]
    };
  }

  const args = [
    published.dllPath,
    "--stdin",
    "--file",
    filePath,
    "--language",
    language
  ];

  const result = spawnSync(runtime.command, args, {
    input: code,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024
  });

  if (result.error || result.status !== 0) {
    return {
      chunks: [],
      errors: [
        {
          message:
            result.error?.message ||
            result.stderr?.trim() ||
            `VB.NET parser failed with exit code ${result.status ?? "unknown"}`
        }
      ]
    };
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return {
      chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
      errors: Array.isArray(parsed.errors) ? parsed.errors : []
    };
  } catch (error) {
    return {
      chunks: [],
      errors: [
        {
          message: `VB.NET parser returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: vbnet.mjs <file.vb>");
    process.exit(1);
  }

  const code = fs.readFileSync(filePath, "utf8");
  const result = parseCode(code, filePath, "vbnet");
  console.log(JSON.stringify(result, null, 2));
}
