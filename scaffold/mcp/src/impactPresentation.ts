import type { ImpactParams, JsonObject, SearchEntity } from "./types.js";

export type ImpactTraversalStep = {
  hops: number;
  via_relation: string;
  direction: string;
  via_entity: string;
  via_note?: string;
};

function impactEntityLabel(
  entityId: string,
  catalog: Map<string, JsonObject>,
  searchEntities: Map<string, SearchEntity>
): string {
  const searchEntity = searchEntities.get(entityId);
  if (searchEntity?.label) {
    return searchEntity.label;
  }
  const catalogEntry = catalog.get(entityId);
  return String(catalogEntry?.label ?? entityId);
}

export function buildImpactPath(
  targetId: string,
  seedId: string,
  visited: Map<string, ImpactTraversalStep>,
  catalog: Map<string, JsonObject>,
  searchEntities: Map<string, SearchEntity>
): { summary: string; entities: string[]; edges: JsonObject[] } {
  const entities = [targetId];
  const edges: JsonObject[] = [];
  let currentId = targetId;

  while (currentId !== seedId) {
    const metadata = visited.get(currentId);
    if (!metadata) {
      break;
    }

    const from = metadata.direction === "outgoing" ? metadata.via_entity : currentId;
    const to = metadata.direction === "outgoing" ? currentId : metadata.via_entity;
    edges.push({
      from,
      to,
      relation: metadata.via_relation,
      note: metadata.via_note ?? ""
    });
    entities.push(metadata.via_entity);
    currentId = metadata.via_entity;
  }

  entities.reverse();
  edges.reverse();

  const labels = entities.map((entityId) => impactEntityLabel(entityId, catalog, searchEntities));
  const summaryParts = [];
  for (let index = 0; index < labels.length; index += 1) {
    summaryParts.push(labels[index]);
    if (index < edges.length) {
      const edge = edges[index];
      const note = edge.note ? `(${String(edge.note)})` : "";
      summaryParts.push(`-[${String(edge.relation)}${note}]->`);
    }
  }

  return {
    summary: summaryParts.join(" "),
    entities,
    edges
  };
}

export function buildCompactImpactSummary(
  entities: string[],
  edges: JsonObject[],
  catalog: Map<string, JsonObject>,
  searchEntities: Map<string, SearchEntity>,
  maxPathHopsShown: number
): string {
  const labels = entities.map((entityId) => impactEntityLabel(entityId, catalog, searchEntities));
  if (labels.length <= 3 || edges.length <= maxPathHopsShown) {
    const summaryParts = [];
    for (let index = 0; index < labels.length; index += 1) {
      summaryParts.push(labels[index]);
      if (index < edges.length) {
        const edge = edges[index];
        const note = edge.note ? `(${String(edge.note)})` : "";
        summaryParts.push(`-[${String(edge.relation)}${note}]->`);
      }
    }
    return summaryParts.join(" ");
  }

  const headEdgeCount = Math.max(1, Math.ceil(maxPathHopsShown / 2));
  const tailEdgeCount = Math.max(0, Math.floor(maxPathHopsShown / 2));
  const hiddenHopCount = Math.max(0, edges.length - headEdgeCount - tailEdgeCount);
  const hiddenText = hiddenHopCount === 1 ? "1 more hop" : `${hiddenHopCount} more hops`;
  const summaryParts = [labels[0]];

  for (let index = 0; index < headEdgeCount; index += 1) {
    const edge = edges[index];
    const note = edge.note ? `(${String(edge.note)})` : "";
    summaryParts.push(`-[${String(edge.relation)}${note}]->`);
    summaryParts.push(labels[index + 1]);
  }

  summaryParts.push(`... ${hiddenText} ...`);

  const tailStart = edges.length - tailEdgeCount;
  const tailEntityStart = labels.length - tailEdgeCount - 1;
  for (let index = tailStart; index < edges.length; index += 1) {
    const edge = edges[index];
    const note = edge.note ? `(${String(edge.note)})` : "";
    const labelIndex = tailEntityStart + (index - tailStart);
    summaryParts.push(`-[${String(edge.relation)}${note}]->`);
    summaryParts.push(labels[labelIndex + 1]);
  }

  return summaryParts.join(" ");
}

function formatImpactRelationLabel(relation: string): string {
  return relation.toLowerCase().replaceAll("_", " ");
}

function formatImpactRelationWithNote(edge: JsonObject): string {
  const relationLabel = formatImpactRelationLabel(String(edge.relation ?? ""));
  const note = String(edge.note ?? "").trim();
  if (!note) {
    return relationLabel;
  }
  return `${relationLabel} (${note})`;
}

export function buildImpactWhy(
  seedId: string,
  targetId: string,
  pathEdges: JsonObject[],
  hops: number,
  catalog: Map<string, JsonObject>,
  searchEntities: Map<string, SearchEntity>
): string {
  const seedLabel = impactEntityLabel(seedId, catalog, searchEntities);
  const targetLabel = impactEntityLabel(targetId, catalog, searchEntities);
  const relationLabels = [...new Set(pathEdges.map((edge) => formatImpactRelationWithNote(edge)))];

  if (relationLabels.length === 0) {
    return `${targetLabel} is reachable from ${seedLabel}.`;
  }

  const relationText =
    relationLabels.length === 1
      ? relationLabels[0]
      : `${relationLabels.slice(0, -1).join(", ")} and ${relationLabels[relationLabels.length - 1]}`;
  const hopText = hops === 1 ? "1 hop" : `${hops} hops`;
  return `${targetLabel} is impacted from ${seedLabel} via ${relationText} in ${hopText}.`;
}

export function buildImpactTopReasons(params: {
  hops: number;
  profile: NonNullable<ImpactParams["profile"]>;
  semanticScore: number;
  noteScore: number;
  profileScore: number;
  impactDomains: string[];
  pathEdges: JsonObject[];
}): string[] {
  const reasons: string[] = [];

  reasons.push(params.hops === 1 ? "1-hop path" : `${params.hops}-hop path`);

  if (params.impactDomains.length > 0) {
    reasons.push(`domains: ${params.impactDomains.join(", ")}`);
  }

  if (params.noteScore > 0) {
    const notedEdges = params.pathEdges
      .map((edge) => ({
        relation: formatImpactRelationLabel(String(edge.relation ?? "")),
        note: String(edge.note ?? "").trim()
      }))
      .filter((edge) => edge.note.length > 0)
      .slice(0, 2)
      .map((edge) => `${edge.relation} (${edge.note})`);
    if (notedEdges.length > 0) {
      reasons.push(`note match: ${notedEdges.join(", ")}`);
    } else {
      reasons.push("note match");
    }
  }

  if (params.profileScore > 0) {
    reasons.push(`profile boost: ${params.profile}`);
  }

  if (params.semanticScore > 0.15) {
    reasons.push("entity text matched query");
  }

  return reasons.slice(0, 4);
}
