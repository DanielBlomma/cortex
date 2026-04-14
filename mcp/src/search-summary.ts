export type SearchResultItem = {
  id?: string;
  entity_type?: string;
  title?: string;
  path?: string;
  score?: number;
  excerpt?: string;
  matched_rules?: string[];
};

export function isSearchResultItem(item: unknown): item is SearchResultItem {
  return typeof item === "object" && item !== null && ("entity_type" in item || "title" in item || "path" in item);
}

export function summarizeSearchResults(query: string, results: SearchResultItem[]): string {
  const lines: string[] = [`Found ${results.length} result${results.length === 1 ? "" : "s"} for "${query}":\n`];

  for (let i = 0; i < Math.min(results.length, 10); i++) {
    const r = results[i];
    const type = r.entity_type ?? "Unknown";
    const label = r.title ?? r.path ?? r.id ?? "untitled";
    const score = typeof r.score === "number" ? ` (score: ${r.score.toFixed(2)})` : "";
    const excerpt = typeof r.excerpt === "string" ? r.excerpt.slice(0, 150).replace(/\n/g, " ").trim() : "";
    lines.push(`${i + 1}. [${type}] ${label}${score}`);
    if (excerpt) {
      lines.push(`   ${excerpt}${r.excerpt && r.excerpt.length > 150 ? "..." : ""}`);
    }
    if (r.matched_rules && r.matched_rules.length > 0) {
      lines.push(`   Rules: ${r.matched_rules.join(", ")}`);
    }
  }

  return lines.join("\n").slice(0, 2000);
}
