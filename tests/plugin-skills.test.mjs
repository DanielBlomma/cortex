import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SKILLS_DIR = fileURLToPath(new URL("../plugins/cortex/skills", import.meta.url));
const EXPECTED_SKILLS = [
  "using-cortex",
  "repo-research",
  "change-impact",
  "pattern-review",
  "context-review",
];
const MAX_BODY_LINES = 100;

function parseSkill(skillName) {
  const raw = fs.readFileSync(path.join(SKILLS_DIR, skillName, "SKILL.md"), "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(match, `${skillName}: SKILL.md must start with YAML frontmatter`);
  const frontmatter = Object.fromEntries(
    match[1]
      .split("\n")
      .filter((line) => line.includes(":"))
      .map((line) => [
        line.slice(0, line.indexOf(":")).trim(),
        line.slice(line.indexOf(":") + 1).trim(),
      ]),
  );
  return { frontmatter, body: match[2] };
}

for (const skillName of EXPECTED_SKILLS) {
  test(`skill ${skillName} has trigger frontmatter and a bounded body`, () => {
    const { frontmatter, body } = parseSkill(skillName);
    assert.equal(frontmatter.name, skillName);
    assert.match(frontmatter.description, /^Use when /);
    assert.ok(frontmatter.description.length >= 40, "description too short to trigger well");
    const bodyLines = body.split("\n").length;
    assert.ok(bodyLines <= MAX_BODY_LINES, `body has ${bodyLines} lines (max ${MAX_BODY_LINES})`);
    assert.match(
      body,
      /`cortex [a-z][^`]*`|`context\.review`/,
      "body must reference a backticked cortex command",
    );
  });
}

test("skills directory contains exactly the expected skills", () => {
  const actual = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(actual, [...EXPECTED_SKILLS].sort());
});

test("DeepSeek Harness skills are byte-identical to canonical Cortex skills", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "plugins/dsh-cortex/skills-manifest.json"), "utf8"),
  );
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.source_root, "plugins/cortex/skills");
  assert.equal(manifest.skills.length, 5);
  for (const entry of manifest.skills) {
    const canonical = fs.readFileSync(
      path.join(repoRoot, manifest.source_root, entry.name, "SKILL.md"),
    );
    const packaged = fs.readFileSync(
      path.join(repoRoot, "plugins/dsh-cortex/skills", entry.name, "SKILL.md"),
    );
    assert.deepEqual(packaged, canonical, `${entry.name} packaged body drifted`);
    assert.equal(
      crypto.createHash("sha256").update(packaged).digest("hex"),
      entry.sha256,
      `${entry.name} manifest hash drifted`,
    );
  }
});
