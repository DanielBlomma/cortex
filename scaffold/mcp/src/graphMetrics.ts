import type { RelationRecord } from "./types.js";

export function relationDegree(relations: RelationRecord[]): Map<string, number> {
  const degrees = new Map<string, number>();

  for (const relation of relations) {
    degrees.set(relation.from, (degrees.get(relation.from) ?? 0) + 1);
    degrees.set(relation.to, (degrees.get(relation.to) ?? 0) + 1);
  }

  return degrees;
}
