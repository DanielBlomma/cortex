import type { ImpactParams, JsonObject, ToolPayload } from "./types.js";

export async function resolveImpactSeed(
  parsed: ImpactParams,
  runSearch: (params: {
    query: string;
    top_k: number;
    include_deprecated: boolean;
    include_content: boolean;
  }) => Promise<ToolPayload>
): Promise<{ id: string | null; query_results?: JsonObject[]; warning?: string }> {
  if (parsed.entity_id) {
    return { id: parsed.entity_id };
  }

  if (!parsed.query) {
    return { id: null, warning: "Either entity_id or query is required." };
  }

  const searchPayload = await runSearch({
    query: parsed.query,
    top_k: Math.max(parsed.top_k, 5),
    include_deprecated: false,
    include_content: false
  });
  const rawResults = Array.isArray(searchPayload.results) ? searchPayload.results : [];
  const firstResult = rawResults[0];

  return {
    id: typeof firstResult?.id === "string" ? firstResult.id : null,
    query_results: rawResults as JsonObject[]
  };
}
