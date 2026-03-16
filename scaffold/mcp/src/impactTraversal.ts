import type { JsonObject, RelationRecord } from "./types.js";
import type { ImpactTraversalStep } from "./impactPresentation.js";

export function traverseImpactGraph(params: {
  seedId: string;
  relations: RelationRecord[];
  depth: number;
}): {
  visited: Map<string, ImpactTraversalStep>;
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

  const seen = new Set<string>([params.seedId]);
  const queue: Array<{ id: string; hop: number }> = [{ id: params.seedId, hop: 0 }];
  const visited = new Map<string, ImpactTraversalStep>();
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
      const nextHop = current.hop + 1;

      if (!seen.has(target)) {
        seen.add(target);
        queue.push({ id: target, hop: nextHop });
        visited.set(target, {
          hops: nextHop,
          via_relation: neighbor.edge.relation,
          direction: neighbor.direction,
          via_entity: current.id,
          via_note: neighbor.edge.note
        });
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
    visited,
    traversedEdges
  };
}
