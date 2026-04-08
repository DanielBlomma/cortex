export function parseFrontmatter(markdown: string): { fields: Map<string, string>; body: string } {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { fields: new Map(), body: markdown };
  }

  const fields = new Map<string, string>();
  let index = 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "---") {
      index += 1;
      break;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    fields.set(match[1].toLowerCase(), match[2].trim());
  }

  return {
    fields,
    body: lines.slice(index).join("\n").trim()
  };
}

export function parseStringList(value: string | undefined): string[] {
  if (!value || !value.trim()) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
