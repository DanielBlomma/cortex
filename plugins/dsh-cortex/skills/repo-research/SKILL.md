---
name: repo-research
description: Use when exploring how something works in this repository, locating an implementation, or answering "how/where does X" questions - retrieves cited Cortex context instead of grepping blindly or answering from memory
---

# Repo Research

## Workflow

1. Search: `cortex search "<topic>" --json` — read the top results and their
   scores.
2. Expand: `cortex related <entity-id> --json` on the most relevant hits to
   find callers, dependencies, and neighboring entities.
3. Read: open the cited files at the cited lines before drawing conclusions.

## Rules

- Quote entity ids and `path:line` citations in your answer.
- Two searches with different phrasings beat one; entity names and file
  basenames make good query terms.
- If results look stale or empty, run `cortex update` and retry once.
