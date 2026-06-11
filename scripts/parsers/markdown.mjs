#!/usr/bin/env node
/**
 * Markdown parser for Cortex.
 * Chunks documents into heading-bounded sections (H1-H3). Headings inside
 * fenced code blocks are ignored. Sections longer than the window threshold
 * are split with overlap downstream by splitChunkIntoWindows in ingest.
 */

const HEADING_PATTERN = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const FENCE_PATTERN = /^(```|~~~)/;

export function parseCode(code, filePath, language = "markdown") {
  const lines = code.split(/\r?\n/);
  const sections = [];
  let current = null;
  let inFence = false;

  const pushCurrent = (endIndex) => {
    if (!current) {
      return;
    }
    const body = lines.slice(current.startIndex, endIndex).join("\n").trimEnd();
    const contentLines = lines.slice(current.startIndex + (current.heading ? 1 : 0), endIndex);
    const hasContent = contentLines.some((line) => line.trim().length > 0);
    if (body.trim().length > 0 && hasContent) {
      sections.push({
        name: current.name,
        kind: "section",
        signature: current.heading ?? current.name,
        body,
        startLine: current.startIndex + 1,
        endLine: Math.max(current.startIndex + 1, endIndex),
        language,
        calls: [],
        imports: []
      });
    }
    current = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (FENCE_PATTERN.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const match = line.match(HEADING_PATTERN);
    if (!match) {
      if (!current) {
        current = { name: "preamble", heading: null, startIndex: i };
      }
      continue;
    }
    pushCurrent(i);
    current = { name: match[2].trim(), heading: line.trim(), startIndex: i };
  }
  pushCurrent(lines.length);

  return { chunks: sections, errors: [] };
}
