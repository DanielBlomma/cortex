#!/usr/bin/env node
/**
 * Conditional C# parser bridge for Cortex.
 *
 * Uses a Roslyn sidecar via `dotnet run` when a .NET runtime is available.
 * If no runtime exists, callers should skip structured chunk extraction and
 * fall back to plain file-level indexing.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DOTNET_COMMAND = "dotnet";
const DEFAULT_PROJECT_PATH = path.join(__dirname, "dotnet", "CSharpParser", "CSharpParser.csproj");

let runtimeCache = null;

function getDotnetCommand() {
  const override = process.env.CORTEX_DOTNET_CMD;
  return override && override.trim().length > 0 ? override.trim() : DEFAULT_DOTNET_COMMAND;
}

function getProjectPath() {
  const override = process.env.CORTEX_CSHARP_PARSER_PROJECT;
  return override && override.trim().length > 0 ? override.trim() : DEFAULT_PROJECT_PATH;
}

export function resetCSharpParserRuntimeCache() {
  runtimeCache = null;
}

export function getCSharpParserRuntime() {
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

export function isCSharpParserAvailable() {
  return getCSharpParserRuntime().available;
}

export function parseCode(code, filePath, language = "csharp") {
  const runtime = getCSharpParserRuntime();
  if (!runtime.available) {
    return { chunks: [], errors: [] };
  }

  const args = [
    "run",
    "--project",
    runtime.projectPath,
    "--configuration",
    "Release",
    "--",
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
            `C# parser failed with exit code ${result.status ?? "unknown"}`
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
          message: `C# parser returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import("node:fs");
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: csharp.mjs <file.cs>");
    process.exit(1);
  }

  const code = fs.readFileSync(filePath, "utf8");
  const result = parseCode(code, filePath, "csharp");
  console.log(JSON.stringify(result, null, 2));
}
