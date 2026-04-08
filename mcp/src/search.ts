import { embedQuery, getEmbeddingRuntimeWarning, loadEmbeddingIndex } from "./embeddings.js";
import { loadContextData } from "./graph.js";
import type {
  ContextData,
  FindCallersParams,
  ImpactAnalysisParams,
  JsonObject,
  RelatedParams,
  RelationRecord,
  SearchEntity,
  SearchParams,
  TraceCallsParams,
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

  const filePathById = new Map(data.documents.map((document) => [document.id, document.path]));

  for (const chunk of data.chunks) {
    const filePath = filePathById.get(chunk.file_id) ?? "";
    entities.push({
      id: chunk.id,
      entity_type: "Chunk",
      kind: chunk.kind || "chunk",
      label: chunk.name || chunk.id,
      path: filePath,
      file_id: chunk.file_id,
      signature: chunk.signature,
      start_line: chunk.start_line,
      end_line: chunk.end_line,
      language: chunk.language,
      text: `${filePath}\n${chunk.name}\n${chunk.signature}\n${chunk.body}`,
      status: chunk.status,
      source_of_truth: chunk.source_of_truth,
      trust_level: chunk.trust_level,
      updated_at: chunk.updated_at,
      snippet: chunk.signature || chunk.body.slice(0, 500),
      matched_rules: ruleLinks.get(chunk.file_id) ?? [],
      content: includeContent ? chunk.body : undefined
    });
  }

  for (const memory of data.memories) {
    entities.push({
      id: memory.id,
      entity_type: "Memory",
      kind: memory.memory_type,
      label: memory.title,
      path: memory.path,
      text: [
        memory.path,
        memory.title,
        memory.memory_type,
        memory.summary,
        memory.evidence,
        memory.decision_or_gotcha,
        memory.applies_to.join(" "),
        memory.sources.join(" "),
        memory.body
      ]
        .filter(Boolean)
        .join("\n"),
      status: memory.status,
      source_of_truth: memory.source_of_truth,
      trust_level: memory.trust_level,
      updated_at: memory.updated_at,
      snippet: memory.summary || memory.body.slice(0, 500),
      matched_rules: [],
      content: includeContent ? memory.body : undefined
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

  const filePathById = new Map(data.documents.map((document) => [document.id, document.path]));

  for (const chunk of data.chunks) {
    const chunkEntity: JsonObject = {
      id: chunk.id,
      type: "Chunk",
      label: chunk.name || chunk.id,
      status: chunk.status,
      source_of_truth: chunk.source_of_truth
    };
    const filePath = filePathById.get(chunk.file_id);
    if (filePath) {
      chunkEntity.path = filePath;
    }
    catalog.set(chunk.id, chunkEntity);
  }

  for (const memory of data.memories) {
    catalog.set(memory.id, {
      id: memory.id,
      type: "Memory",
      label: memory.title,
      status: memory.status,
      source_of_truth: memory.source_of_truth,
      path: memory.path
    });
  }

  return catalog;
}

function chunkSeedIds(entityId: string, data: ContextData): string[] {
  if (entityId.startsWith("chunk:")) {
    return data.chunkById.has(entityId) ? [entityId] : [];
  }

  if (entityId.startsWith("file:")) {
    return (data.chunksByFileId.get(entityId) ?? []).map((chunk) => chunk.id);
  }

  return [];
}

function buildCallAdjacency(relations: RelationRecord[]): {
  outgoing: Map<string, RelationRecord[]>;
  incoming: Map<string, RelationRecord[]>;
} {
  const outgoing = new Map<string, RelationRecord[]>();
  const incoming = new Map<string, RelationRecord[]>();

  for (const relation of relations) {
    if (relation.relation !== "CALLS") {
      continue;
    }

    const outList = outgoing.get(relation.from) ?? [];
    outList.push(relation);
    outgoing.set(relation.from, outList);

    const inList = incoming.get(relation.to) ?? [];
    inList.push(relation);
    incoming.set(relation.to, inList);
  }

  return { outgoing, incoming };
}

function buildCallResultEntity(entityId: string, catalog: Map<string, JsonObject>, hop: number): JsonObject {
  const entity = catalog.get(entityId) ?? {
    id: entityId,
    type: "Unknown",
    label: entityId,
    status: "unknown",
    source_of_truth: false
  };

  return {
    ...entity,
    hops: hop
  };
}

function buildChunkContextEnvelope(
  entityId: string,
  data: ContextData,
  catalog: Map<string, JsonObject>
): JsonObject | undefined {
  const chunk = data.chunkById.get(entityId);
  if (!chunk) {
    return undefined;
  }

  const parentFile = data.documentById.get(chunk.file_id);
  const siblingChunks = (data.chunksByFileId.get(chunk.file_id) ?? [])
    .filter(
      (candidate) =>
        candidate.id !== chunk.id && !candidate.id.includes(":window:")
    )
    .sort(
      (left, right) =>
        Math.abs(left.start_line - chunk.start_line) - Math.abs(right.start_line - chunk.start_line)
    )
    .slice(0, 2)
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.name,
      kind: candidate.kind,
      start_line: candidate.start_line,
      end_line: candidate.end_line
    }));

  const callers = data.relations
    .filter((relation) => relation.relation === "CALLS" && relation.to === chunk.id)
    .slice(0, 2)
    .map((relation) => {
      const caller = catalog.get(relation.from);
      return {
        id: relation.from,
        title: String(caller?.label ?? relation.from),
        path: caller?.path ?? null,
        relation: relation.relation
      };
    });

  const callees = data.relations
    .filter((relation) => relation.relation === "CALLS" && relation.from === chunk.id)
    .slice(0, 2)
    .map((relation) => {
      const callee = catalog.get(relation.to);
      return {
        id: relation.to,
        title: String(callee?.label ?? relation.to),
        path: callee?.path ?? null,
        relation: relation.relation
      };
    });

  return {
    parent_file: parentFile
      ? {
          id: parentFile.id,
          path: parentFile.path,
          kind: parentFile.kind,
          source_of_truth: parentFile.source_of_truth,
          status: parentFile.status
        }
      : null,
    sibling_chunks: siblingChunks,
    callers,
    callees
  };
}

async function resolveImpactSeedId(parsed: ImpactAnalysisParams, data: ContextData): Promise<{
  seedId: string | null;
  queryResults?: JsonObject[];
  warning?: string;
}> {
  if (parsed.entity_id) {
    return { seedId: parsed.entity_id };
  }

  if (!parsed.query) {
    return { seedId: null, warning: "Either entity_id or query is required." };
  }

  const searchPayload = await runContextSearchWithData({
    query: parsed.query,
    top_k: Math.max(parsed.top_k, 5),
    include_deprecated: false,
    include_content: false
  }, data);
  const rawResults = Array.isArray(searchPayload.results) ? searchPayload.results : [];
  const firstResult =
    rawResults.find(
      (result) =>
        typeof result === "object" &&
        result !== null &&
        "entity_type" in result &&
        result.entity_type === "Chunk"
    ) ?? rawResults[0];

  return {
    seedId: typeof firstResult?.id === "string" ? firstResult.id : null,
    queryResults: rawResults as JsonObject[],
    warning: typeof firstResult?.id === "string" ? undefined : "No matching seed entity found."
  };
}

async function runContextSearchWithData(parsed: SearchParams, data: ContextData): Promise<ToolPayload> {
  const degreeByEntity = relationDegree(data.allRelations);
  const catalog = entityCatalog(data);
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
        file_id: entity.file_id,
        signature: entity.signature,
        start_line: entity.start_line,
        end_line: entity.end_line,
        language: entity.language,
        score: Number(score.toFixed(4)),
        semantic_score: Number(semantic.toFixed(4)),
        embedding_score: Number(vectorSemantic.toFixed(4)),
        lexical_score: Number(lexicalSemantic.toFixed(4)),
        graph_score: Number(graphScore.toFixed(4)),
        source_of_truth: entity.source_of_truth,
        status: entity.status,
        updated_at: entity.updated_at,
        matched_rules: entity.matched_rules,
        context_envelope:
          entity.entity_type === "Chunk" ? buildChunkContextEnvelope(entity.id, data, catalog) : undefined,
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

export async function runContextSearch(parsed: SearchParams): Promise<ToolPayload> {
  const data = await loadContextData();
  return runContextSearchWithData(parsed, data);
}

export async function runContextRelated(parsed: RelatedParams): Promise<ToolPayload> {
  const data = await loadContextData();
  const catalog = entityCatalog(data);
  const relations = data.allRelations;

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

  for (const relation of relations) {
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

export async function runContextFindCallers(parsed: FindCallersParams): Promise<ToolPayload> {
  const data = await loadContextData();
  const catalog = entityCatalog(data);

  if (!catalog.has(parsed.entity_id)) {
    return {
      entity_id: parsed.entity_id,
      depth: parsed.depth,
      callers: [],
      edges: [],
      context_source: data.source,
      warning: "Entity not found in indexed context."
    };
  }

  const seedChunkIds = chunkSeedIds(parsed.entity_id, data);
  if (seedChunkIds.length === 0) {
    return {
      entity_id: parsed.entity_id,
      depth: parsed.depth,
      callers: [],
      edges: [],
      context_source: data.source,
      warning: "Entity has no chunk-level call graph representation."
    };
  }

  const relations = data.allRelations;
  const { incoming } = buildCallAdjacency(relations);
  const seen = new Set<string>(seedChunkIds);
  const queue = seedChunkIds.map((id) => ({ id, hop: 0 }));
  const callers: JsonObject[] = [];
  const traversedEdges: JsonObject[] = [];
  const traversedEdgeKeys = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift() as { id: string; hop: number };
    if (current.hop >= parsed.depth) {
      continue;
    }

    for (const edge of incoming.get(current.id) ?? []) {
      const nextId = edge.from;
      if (!seen.has(nextId)) {
        seen.add(nextId);
        queue.push({ id: nextId, hop: current.hop + 1 });
        callers.push({
          ...buildCallResultEntity(nextId, catalog, current.hop + 1),
          via_relation: edge.relation,
          direction: "incoming"
        });
      }

      const edgeKey = `${edge.from}|${edge.relation}|${edge.to}|${edge.note}`;
      if (!traversedEdgeKeys.has(edgeKey)) {
        traversedEdgeKeys.add(edgeKey);
        traversedEdges.push({
          from: edge.from,
          to: edge.to,
          relation: edge.relation,
          note: edge.note
        });
      }
    }
  }

  return {
    entity_id: parsed.entity_id,
    depth: parsed.depth,
    context_source: data.source,
    warning: data.warning,
    callers,
    edges: parsed.include_edges ? traversedEdges : []
  };
}

export async function runContextTraceCalls(parsed: TraceCallsParams): Promise<ToolPayload> {
  const data = await loadContextData();
  const catalog = entityCatalog(data);

  if (!catalog.has(parsed.entity_id)) {
    return {
      entity_id: parsed.entity_id,
      depth: parsed.depth,
      direction: parsed.direction,
      trace: [],
      edges: [],
      context_source: data.source,
      warning: "Entity not found in indexed context."
    };
  }

  const seedChunkIds = chunkSeedIds(parsed.entity_id, data);
  if (seedChunkIds.length === 0) {
    return {
      entity_id: parsed.entity_id,
      depth: parsed.depth,
      direction: parsed.direction,
      trace: [],
      edges: [],
      context_source: data.source,
      warning: "Entity has no chunk-level call graph representation."
    };
  }

  const relations = data.allRelations;
  const { outgoing, incoming } = buildCallAdjacency(relations);
  const seen = new Set<string>(seedChunkIds);
  const queue = seedChunkIds.map((id) => ({ id, hop: 0 }));
  const trace: JsonObject[] = [];
  const traversedEdges: JsonObject[] = [];
  const traversedEdgeKeys = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift() as { id: string; hop: number };
    if (current.hop >= parsed.depth) {
      continue;
    }

    const neighbors = [
      ...(parsed.direction === "outgoing" || parsed.direction === "both"
        ? (outgoing.get(current.id) ?? []).map((edge) => ({
            edge,
            next: edge.to,
            direction: "outgoing"
          }))
        : []),
      ...(parsed.direction === "incoming" || parsed.direction === "both"
        ? (incoming.get(current.id) ?? []).map((edge) => ({
            edge,
            next: edge.from,
            direction: "incoming"
          }))
        : [])
    ];

    for (const neighbor of neighbors) {
      if (!seen.has(neighbor.next)) {
        seen.add(neighbor.next);
        queue.push({ id: neighbor.next, hop: current.hop + 1 });
        trace.push({
          ...buildCallResultEntity(neighbor.next, catalog, current.hop + 1),
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
    direction: parsed.direction,
    context_source: data.source,
    warning: data.warning,
    trace,
    edges: parsed.include_edges ? traversedEdges : []
  };
}

export async function runContextImpactAnalysis(parsed: ImpactAnalysisParams): Promise<ToolPayload> {
  const data = await loadContextData();
  const seedResolution = await resolveImpactSeedId(parsed, data);
  const catalog = entityCatalog(data);

  if (!seedResolution.seedId) {
    return {
      entity_id: parsed.entity_id,
      query: parsed.query,
      depth: parsed.depth,
      top_k: parsed.top_k,
      direction: parsed.direction,
      context_source: data.source,
      warning: seedResolution.warning ?? data.warning ?? "No matching seed entity found.",
      seed: null,
      query_results: seedResolution.queryResults ?? [],
      results: [],
      edges: []
    };
  }

  if (!catalog.has(seedResolution.seedId)) {
    return {
      entity_id: parsed.entity_id,
      query: parsed.query,
      depth: parsed.depth,
      top_k: parsed.top_k,
      direction: parsed.direction,
      context_source: data.source,
      warning: "Seed entity not found in indexed context.",
      seed: null,
      query_results: seedResolution.queryResults ?? [],
      results: [],
      edges: []
    };
  }

  const seedChunkIds = chunkSeedIds(seedResolution.seedId, data);
  if (seedChunkIds.length === 0) {
    return {
      entity_id: parsed.entity_id,
      query: parsed.query,
      depth: parsed.depth,
      top_k: parsed.top_k,
      direction: parsed.direction,
      context_source: data.source,
      warning: "Seed entity has no chunk-level call graph representation.",
      seed: catalog.get(seedResolution.seedId),
      query_results: seedResolution.queryResults ?? [],
      results: [],
      edges: []
    };
  }

  const relations = data.allRelations;
  const degreeByEntity = relationDegree(relations);
  const searchEntityById = new Map(buildSearchEntities(data, false).map((entity) => [entity.id, entity]));
  const { outgoing, incoming } = buildCallAdjacency(relations);
  const seen = new Set<string>(seedChunkIds);
  const queue = seedChunkIds.map((id) => ({ id, hop: 0 }));
  const visited = new Map<
    string,
    { hops: number; via_relation: string; direction: string; via_entity: string; via_note: string }
  >();
  const traversedEdges: JsonObject[] = [];
  const traversedEdgeKeys = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift() as { id: string; hop: number };
    if (current.hop >= parsed.depth) {
      continue;
    }

    const neighbors = [
      ...(parsed.direction === "outgoing" || parsed.direction === "both"
        ? (outgoing.get(current.id) ?? []).map((edge) => ({
            edge,
            next: edge.to,
            direction: "outgoing"
          }))
        : []),
      ...(parsed.direction === "incoming" || parsed.direction === "both"
        ? (incoming.get(current.id) ?? []).map((edge) => ({
            edge,
            next: edge.from,
            direction: "incoming"
          }))
        : [])
    ];

    for (const neighbor of neighbors) {
      if (!seen.has(neighbor.next)) {
        seen.add(neighbor.next);
        queue.push({ id: neighbor.next, hop: current.hop + 1 });
        visited.set(neighbor.next, {
          hops: current.hop + 1,
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

  const results = [...visited.entries()]
    .map(([id, metadata]) => {
      const entity = searchEntityById.get(id);
      const graphScore = Math.min(1, (degreeByEntity.get(id) ?? 0) / 4);
      const trustScore = entity ? Math.max(0, Math.min(1, entity.trust_level / 100)) : 0.5;
      const impactScore = Number((1 / (metadata.hops + 1) + graphScore * 0.35 + trustScore * 0.25).toFixed(4));
      const catalogEntry = catalog.get(id) ?? { id, type: "Unknown", label: id, status: "unknown" };

      return {
        id,
        entity_type: entity?.entity_type ?? String(catalogEntry.type ?? "Unknown"),
        kind: entity?.kind ?? "",
        title: entity?.label ?? String(catalogEntry.label ?? id),
        path: entity?.path ?? catalogEntry.path ?? undefined,
        hops: metadata.hops,
        via_relation: metadata.via_relation,
        direction: metadata.direction,
        via_entity: metadata.via_entity,
        impact_score: impactScore,
        graph_score: Number(graphScore.toFixed(4)),
        trust_score: Number(trustScore.toFixed(4)),
        excerpt: entity?.snippet ?? "",
        status: entity?.status ?? String(catalogEntry.status ?? "unknown"),
        source_of_truth: entity?.source_of_truth ?? Boolean(catalogEntry.source_of_truth)
      };
    })
    .sort((a, b) => {
      if (a.hops !== b.hops) {
        return a.hops - b.hops;
      }
      return b.impact_score - a.impact_score;
    })
    .slice(0, parsed.top_k);

  return {
    entity_id: parsed.entity_id,
    query: parsed.query,
    resolved_seed_id: seedResolution.seedId,
    resolved_from_query: !parsed.entity_id,
    depth: parsed.depth,
    top_k: parsed.top_k,
    direction: parsed.direction,
    context_source: data.source,
    warning: data.warning,
    seed: catalog.get(seedResolution.seedId),
    query_results: seedResolution.queryResults ?? [],
    results,
    edges: parsed.include_edges ? traversedEdges : []
  };
}
