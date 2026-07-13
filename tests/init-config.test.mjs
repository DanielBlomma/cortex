import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildInitialConfig, detectInitialSourcePaths, slugifyRepoId } from "../bin/cortex.mjs";

function makeRepo(name) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-init-config-"));
  const repoRoot = path.join(tempRoot, name);
  fs.mkdirSync(repoRoot, { recursive: true });
  return { tempRoot, repoRoot };
}

test("slugifyRepoId splits separators and camel-case repo names", () => {
  assert.equal(slugifyRepoId("API_DOIGraphApi"), "api-doi-graph-api");
});

test("detectInitialSourcePaths defaults new repos to the whole repo root", () => {
  const { tempRoot, repoRoot } = makeRepo("API_DOIGraphApi");
  try {
    fs.mkdirSync(path.join(repoRoot, "DOIGraphApi", "GraphQL"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "DOIGraphApi", "bin", "Debug", "net10.0"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "DOIGraphApi", "obj", "Debug", "net10.0"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "bin"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, ".context", "cache"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "docs"), { recursive: true });

    fs.writeFileSync(path.join(repoRoot, "DOIGraphApi", "DOIGraphApi.csproj"), "<Project />\n");
    fs.writeFileSync(path.join(repoRoot, "DOIGraphApi", "Program.cs"), "var builder = WebApplication.CreateBuilder(args);\n");
    fs.writeFileSync(path.join(repoRoot, "DOIGraphApi", "GraphQL", "Query.cs"), "namespace Api; public class Query { }\n");
    fs.writeFileSync(path.join(repoRoot, "DOIGraphApi", "bin", "Debug", "net10.0", "Generated.g.cs"), "namespace Generated {}\n");
    fs.writeFileSync(path.join(repoRoot, "DOIGraphApi", "obj", "Debug", "net10.0", "Generated.g.cs"), "namespace Generated {}\n");
    fs.writeFileSync(path.join(repoRoot, "bin", "tool.mjs"), "console.log('tool');\n");
    fs.writeFileSync(path.join(repoRoot, "scripts", "deploy.sh"), "echo deploy\n");
    fs.writeFileSync(path.join(repoRoot, ".context", "cache", "generated.jsonl"), "{}\n");
    fs.writeFileSync(path.join(repoRoot, "docs", "overview.md"), "# Overview\n");
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# API_DOIGraphApi\n");

    assert.deepEqual(detectInitialSourcePaths(repoRoot), ["."]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("buildInitialConfig writes detected repo_id and source_paths", () => {
  const { tempRoot, repoRoot } = makeRepo("API_DOIGraphApi");
  try {
    fs.mkdirSync(path.join(repoRoot, "DOIGraphApi"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "DOIGraphApi", "DOIGraphApi.csproj"), "<Project />\n");
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# API_DOIGraphApi\n");

    const config = buildInitialConfig(repoRoot);

    assert.match(config, /^repo_id: api-doi-graph-api$/m);
    assert.match(config, /^source_paths:\n  - \.$/m);
    assert.match(config, /^  semantic: 0\.40$/m);
    assert.match(config, /^  graph: 0\.25$/m);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
