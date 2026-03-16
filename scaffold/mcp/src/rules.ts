import { loadContextData } from "./graph.js";
import type { RulesParams, ToolPayload } from "./types.js";

export async function runContextRules(parsed: RulesParams): Promise<ToolPayload> {
  const data = await loadContextData();

  const rules = data.rules
    .filter((rule) => parsed.include_inactive || rule.status === "active")
    .filter((rule) => !parsed.scope || rule.scope === parsed.scope || rule.scope === "global")
    .sort((a, b) => b.priority - a.priority)
    .map((rule) => ({
      id: rule.id,
      title: rule.title,
      description: rule.body,
      priority: rule.priority,
      scope: rule.scope,
      status: rule.status
    }));

  return {
    scope: parsed.scope ?? "global",
    count: rules.length,
    context_source: data.source,
    warning: data.warning,
    rules
  };
}
