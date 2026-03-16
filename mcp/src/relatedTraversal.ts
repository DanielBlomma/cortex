import type { JsonObject, RelationRecord } from "./types.js";

export function traverseRelatedGraph(params: {
  entityId: string;
  relations: RelationRecord[];
  depth: number;
  catalog: Map<string, JsonObject>;
  includeEntityMetadata: boolean;
}): {
  related: JsonObject[];
  traversedEdges: JsonObject[];
} {
  const outgoing = new Map<string, RelationRecord[]>();
  const incoming = new Map<string, RelationRecord[]>();

  for (const relation of params.relations) {
    const outList = outgoing.get(relation.from) ?? [];
    outList.push(relation);
    outgoing.set(relation.from, outList);

    const inList = incoming.get(relation.to) ?? [];
    inList.push(relation);
    incoming.set(relation.to, inList);
  }

  const seen = new Set<string>([params.entityId]);
  const queue: Array<{ id: string; hop: number }> = [{ id: params.entityId, hop: 0 }];
  const related: JsonObject[] = [];
  const traversedEdges: JsonObject[] = [];
  const traversedEdgeKeys = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift() as { id: string; hop: number };
    if (current.hop >= params.depth) {
      continue;
    }

    const neighbors = [
      ...(outgoing.get(current.id) ?? []).map((edge) => ({
        edge,
        next: edge.to,
        direction: "outgoing"
      })),
      ...(incoming.get(current.id) ?? []).map((edge) => ({
        edge,
        next: edge.from,
        direction: "incoming"
      }))
    ];

    for (const neighbor of neighbors) {
      const target = neighbor.next;
      if (!seen.has(target)) {
        seen.add(target);
        queue.push({ id: target, hop: current.hop + 1 });

        const entity = params.catalog.get(target) ?? {
          id: target,
          type: "Unknown",
          label: target,
          status: "unknown",
          source_of_truth: false
        };

        related.push(
          params.includeEntityMetadata
            ? {
                ...entity,
                hops: current.hop + 1,
                via_relation: neighbor.edge.relation,
                direction: neighbor.direction
              }
            : {
                id: entity.id,
                type: entity.type,
                label: entity.label,
                hops: current.hop + 1,
                via_relation: neighbor.edge.relation,
                direction: neighbor.direction
              }
        );
      }

      const edgeKey = `${neighbor.edge.from}|${neighbor.edge.relation}|${neighbor.edge.to}|${neighbor.edge.note}`;
      if (!traversedEdgeKeys.has(edgeKey)) {
        traversedEdgeKeys.add(edgeKey);
        traversedEdges.push({
          from: neighbor.edge.from,
          to: neighbor.edge.to,
          relation: neighbor.edge.relation,
          note: neighbor.edge.note
        });
      }
    }
  }

  return {
    related,
    traversedEdges
  };
}
