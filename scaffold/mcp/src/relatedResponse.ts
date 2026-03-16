import type { RelatedParams, ToolPayload } from "./types.js";

export function buildRelatedResponseMeta(params: {
  parsed: RelatedParams;
  responsePreset: "full" | "compact" | "minimal";
  includeEdges: boolean;
  includeEntityMetadata: boolean;
  contextSource: string;
}): ToolPayload {
  return {
    entity_id: params.parsed.entity_id,
    depth: params.parsed.depth,
    response_preset: params.responsePreset,
    include_edges: params.includeEdges,
    include_entity_metadata: params.includeEntityMetadata,
    context_source: params.contextSource
  };
}

export function buildEmptyRelatedResponse(params: {
  meta: ToolPayload;
  warning: string;
}): ToolPayload {
  return {
    ...params.meta,
    related: [],
    edges: [],
    warning: params.warning
  };
}
