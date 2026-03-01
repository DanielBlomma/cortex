import { embedQuery, getEmbeddingRuntimeWarning, loadEmbeddingIndex } from "./embeddings.js";
import { loadContextData } from "./graph.js";
import type {
  ContextData,
  JsonObject,
  RelatedParams,
  RelationRecord,
  RulesParams,
  SearchEntity,
  SearchParams,
  ToolPayload
} from "./types.js";

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function daysSince(isoDate: string): number {
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) {
    return 3650;
  }

  const now = Date.now();
  return Math.max(0, (now - timestamp) / (1000 * 60 * 60 * 24));
}

function recencyScore(isoDate: string): number {
  const days = daysSince(isoDate);
  return 1 / (1 + days / 30);
}

function semanticScore(query: string, text: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 0;
  }

  const haystack = text.toLowerCase();
  let matched = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      matched += 1;
    }
  }

  const overlap = matched / queryTokens.length;
  const phraseBonus = haystack.includes(query.toLowerCase()) ? 0.25 : 0;
  return Math.min(1, overlap * 0.85 + phraseBonus);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const av = a[index];
    const bv = b[index];
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function groupRuleLinks(relations: RelationRecord[]): Map<string, string[]> {
  const links = new Map<string, string[]>();
  for (const relation of relations) {
    if (relation.relation !== "CONSTRAINS" && relation.relation !== "IMPLEMENTS") {
      continue;
    }

    if (relation.relation === "CONSTRAINS") {
      const list = links.get(relation.to) ?? [];
      list.push(relation.from);
      links.set(relation.to, list);
    } else {
      const list = links.get(relation.from) ?? [];
      list.push(relation.to);
      links.set(relation.from, list);
    }
  }
  return links;
}

function buildSearchEntities(data: ContextData, includeContent: boolean): SearchEntity[] {
  const entities: SearchEntity[] = [];
  const ruleLinks = groupRuleLinks(data.relations);
  const adrPathSet = new Set(
    data.adrs
      .map((adr) => adr.path.trim().toLowerCase())
      .filter((adrPath) => adrPath.length > 0)
  );

  for (const document of data.documents) {
    const normalizedPath = document.path.trim().toLowerCase();
    // ADR content is represented by ADR entities below; avoid duplicate results.
    if (document.kind === "ADR" && adrPathSet.has(normalizedPath)) {
      continue;
    }

    entities.push({
      id: document.id,
      entity_type: "File",
      kind: document.kind,
      label: document.path,
      path: document.path,
      text: `${document.path}\n${document.excerpt}\n${document.content}`,
      status: document.status,
      source_of_truth: document.source_of_truth,
      trust_level: document.trust_level,
      updated_at: document.updated_at,
      snippet: document.excerpt,
      matched_rules: ruleLinks.get(document.id) ?? [],
      content: includeContent ? document.content : undefined
    });
  }

  for (const rule of data.rules) {
    entities.push({
      id: rule.id,
      entity_type: "Rule",
      kind: "RULE",
      label: rule.title || rule.id,
      path: "",
      text: `${rule.id}\n${rule.title}\n${rule.body}`,
      status: rule.status,
      source_of_truth: rule.source_of_truth,
      trust_level: rule.trust_level,
      updated_at: rule.updated_at,
      snippet: rule.body.slice(0, 500),
      matched_rules: [rule.id],
      content: includeContent ? rule.body : undefined
    });
  }

  for (const adr of data.adrs) {
    entities.push({
      id: adr.id,
      entity_type: "ADR",
      kind: "ADR",
      label: adr.title || adr.id,
      path: adr.path,
      text: `${adr.path}\n${adr.title}\n${adr.body}`,
      status: adr.status,
      source_of_truth: adr.source_of_truth,
      trust_level: adr.trust_level,
      updated_at: adr.decision_date,
      snippet: adr.body.slice(0, 500),
      matched_rules: [],
      content: includeContent ? adr.body : undefined
    });
  }

  return entities;
}

function relationDegree(relations: RelationRecord[]): Map<string, number> {
  const degrees = new Map<string, number>();

  for (const relation of relations) {
    degrees.set(relation.from, (degrees.get(relation.from) ?? 0) + 1);
    degrees.set(relation.to, (degrees.get(relation.to) ?? 0) + 1);
  }

  return degrees;
}

function entityCatalog(data: ContextData): Map<string, JsonObject> {
  const catalog = new Map<string, JsonObject>();

  for (const file of data.documents) {
    catalog.set(file.id, {
      id: file.id,
      type: "File",
      label: file.path,
      status: file.status,
      source_of_truth: file.source_of_truth
    });
  }

  for (const rule of data.rules) {
    catalog.set(rule.id, {
      id: rule.id,
      type: "Rule",
      label: rule.title,
      status: rule.status,
      source_of_truth: rule.source_of_truth
    });
  }

  for (const adr of data.adrs) {
    catalog.set(adr.id, {
      id: adr.id,
      type: "ADR",
      label: adr.title || adr.id,
      status: adr.status,
      source_of_truth: adr.source_of_truth
    });
  }

  return catalog;
}

export async function runContextSearch(parsed: SearchParams): Promise<ToolPayload> {
  const data = await loadContextData();
  const degreeByEntity = relationDegree(data.relations);
  const candidates = buildSearchEntities(data, parsed.include_content).filter(
    (entity) => parsed.include_deprecated || entity.status.toLowerCase() !== "deprecated"
  );
  const embeddings = loadEmbeddingIndex();
  const queryVector =
    embeddings.model && embeddings.vectors.size > 0
      ? await embedQuery(parsed.query, embeddings.model)
      : null;

  const results = candidates
    .map((entity) => {
      const lexicalSemantic = semanticScore(parsed.query, entity.text);
      const entityVector = embeddings.vectors.get(entity.id);
      const vectorSemantic =
        queryVector && entityVector
          ? Math.max(0, Math.min(1, (cosineSimilarity(queryVector, entityVector) + 1) / 2))
          : 0;
      const semantic =
        vectorSemantic > 0 ? vectorSemantic * 0.75 + lexicalSemantic * 0.25 : lexicalSemantic;
      const graphScore = Math.min(1, (degreeByEntity.get(entity.id) ?? 0) / 4);
      const trustScore = Math.max(0, Math.min(1, entity.trust_level / 100));
      const dateScore = recencyScore(entity.updated_at);

      let score = 0;
      score += data.ranking.semantic * semantic;
      score += data.ranking.graph * graphScore;
      score += data.ranking.trust * trustScore;
      score += data.ranking.recency * dateScore;

      if (entity.source_of_truth) {
        score += 0.1;
      }

      return {
        id: entity.id,
        entity_type: entity.entity_type,
        kind: entity.kind,
        title: entity.label,
        path: entity.path || undefined,
        score: Number(score.toFixed(4)),
        semantic_score: Number(semantic.toFixed(4)),
        embedding_score: Number(vectorSemantic.toFixed(4)),
        lexical_score: Number(lexicalSemantic.toFixed(4)),
        graph_score: Number(graphScore.toFixed(4)),
        source_of_truth: entity.source_of_truth,
        status: entity.status,
        updated_at: entity.updated_at,
        matched_rules: entity.matched_rules,
        excerpt: entity.snippet,
        content: parsed.include_content ? entity.content : undefined
      };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, parsed.top_k);

  const warningMessages = [data.warning, embeddings.warning, getEmbeddingRuntimeWarning()].filter(Boolean);

  return {
    query: parsed.query,
    top_k: parsed.top_k,
    ranking: data.ranking,
    total_candidates: candidates.length,
    context_source: data.source,
    warning: warningMessages.length > 0 ? warningMessages.join(" | ") : undefined,
    semantic_engine:
      queryVector && embeddings.model ? `embedding+lexical (${embeddings.model})` : "lexical-only",
    results
  };
}

export async function runContextRelated(parsed: RelatedParams): Promise<ToolPayload> {
  const data = await loadContextData();
  const catalog = entityCatalog(data);

  if (!catalog.has(parsed.entity_id)) {
    return {
      entity_id: parsed.entity_id,
      depth: parsed.depth,
      related: [],
      edges: [],
      context_source: data.source,
      warning: "Entity not found in indexed context."
    };
  }

  const outgoing = new Map<string, RelationRecord[]>();
  const incoming = new Map<string, RelationRecord[]>();

  for (const relation of data.relations) {
    const outList = outgoing.get(relation.from) ?? [];
    outList.push(relation);
    outgoing.set(relation.from, outList);

    const inList = incoming.get(relation.to) ?? [];
    inList.push(relation);
    incoming.set(relation.to, inList);
  }

  const seen = new Set<string>([parsed.entity_id]);
  const queue: Array<{ id: string; hop: number }> = [{ id: parsed.entity_id, hop: 0 }];
  const related: JsonObject[] = [];
  const traversedEdges: JsonObject[] = [];
  const traversedEdgeKeys = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift() as { id: string; hop: number };
    if (current.hop >= parsed.depth) {
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

        const entity = catalog.get(target) ?? {
          id: target,
          type: "Unknown",
          label: target,
          status: "unknown",
          source_of_truth: false
        };

        related.push({
          ...entity,
          hops: current.hop + 1,
          via_relation: neighbor.edge.relation,
          direction: neighbor.direction
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
    entity_id: parsed.entity_id,
    depth: parsed.depth,
    context_source: data.source,
    warning: data.warning,
    related,
    edges: parsed.include_edges ? traversedEdges : []
  };
}

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
