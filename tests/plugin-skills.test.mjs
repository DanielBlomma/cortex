import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
    assert.match(body, /cortex |context\.review/, "body must reference cortex commands");
  });
}
