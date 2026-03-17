import type { ContextData, JsonObject, RelationRecord, SearchEntity } from "./types.js";

function isWindowChunkId(id: string): boolean {
  return id.includes(":window:");
}

function baseChunkId(id: string): string {
  const markerIndex = id.indexOf(":window:");
  return markerIndex === -1 ? id : id.slice(0, markerIndex);
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

function buildRelationSearchSignals(data: ContextData): Map<string, string> {
  const labelsById = new Map<string, string>();
  for (const document of data.documents) {
    labelsById.set(document.id, document.path);
  }
  for (const chunk of data.chunks) {
    labelsById.set(chunk.id, chunk.name || chunk.id);
  }
  for (const module of data.modules) {
    labelsById.set(module.id, module.name || module.path);
  }
  for (const project of data.projects) {
    labelsById.set(project.id, project.name || project.path);
  }

  const supportedRelations = new Set([
    "CALLS_SQL",
    "USES_CONFIG_KEY",
    "USES_RESOURCE_KEY",
    "USES_SETTING_KEY",
    "USES_CONFIG",
    "TRANSFORMS_CONFIG"
  ]);
  const signalsByEntity = new Map<string, string[]>();

  for (const relation of data.relations) {
    if (!supportedRelations.has(relation.relation)) {
      continue;
    }
    const sourceLabel = labelsById.get(relation.from) ?? relation.from;
    const targetLabel = labelsById.get(relation.to) ?? relation.to;
    const outgoingSignal = [relation.relation.toLowerCase(), relation.note, targetLabel].filter(Boolean).join(" ");
    const incomingSignal = ["affected_by", relation.relation.toLowerCase(), relation.note, sourceLabel]
      .filter(Boolean)
      .join(" ");
    const outgoing = signalsByEntity.get(relation.from) ?? [];
    outgoing.push(outgoingSignal);
    signalsByEntity.set(relation.from, outgoing);
    const incoming = signalsByEntity.get(relation.to) ?? [];
    incoming.push(incomingSignal);
    signalsByEntity.set(relation.to, incoming);
  }

  return new Map([...signalsByEntity.entries()].map(([id, parts]) => [id, parts.join("\n")]));
}

export function buildSearchEntities(data: ContextData, includeContent: boolean): SearchEntity[] {
  const entities: SearchEntity[] = [];
  const fileRuleLinks = groupRuleLinks(data.relations);
  const relationSignals = buildRelationSearchSignals(data);
  const adrPathSet = new Set(
    data.adrs
      .map((adr) => adr.path.trim().toLowerCase())
      .filter((adrPath) => adrPath.length > 0)
  );

  for (const document of data.documents) {
    const normalizedPath = document.path.trim().toLowerCase();
    if (document.kind === "ADR" && adrPathSet.has(normalizedPath)) {
      continue;
    }

    entities.push({
      id: document.id,
      entity_type: "File",
      kind: document.kind,
      label: document.path,
      path: document.path,
      text: `${document.path}\n${document.excerpt}\n${document.content}\n${relationSignals.get(document.id) ?? ""}`,
      status: document.status,
      source_of_truth: document.source_of_truth,
      trust_level: document.trust_level,
      updated_at: document.updated_at,
      snippet: document.excerpt,
      matched_rules: fileRuleLinks.get(document.id) ?? [],
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

  const filePathById = new Map(
    data.documents.filter((document) => document.kind === "CODE").map((document) => [document.id, document.path])
  );

  for (const chunk of data.chunks) {
    const filePath = filePathById.get(chunk.file_id) ?? "";
    entities.push({
      id: chunk.id,
      entity_type: "Chunk",
      kind: chunk.kind || "chunk",
      label: chunk.name || chunk.id,
      path: filePath,
      text: `${filePath}\n${chunk.name}\n${chunk.signature}\n${chunk.description}\n${chunk.body}\n${relationSignals.get(chunk.id) ?? ""}`,
      status: chunk.status,
      source_of_truth: chunk.source_of_truth,
      trust_level: chunk.trust_level,
      updated_at: chunk.updated_at,
      snippet: chunk.description || chunk.body.slice(0, 500),
      matched_rules: fileRuleLinks.get(chunk.file_id) ?? [],
      content: includeContent ? chunk.body : undefined
    });
  }

  for (const module of data.modules) {
    entities.push({
      id: module.id,
      entity_type: "Module",
      kind: "MODULE",
      label: module.name,
      path: module.path,
      text: `${module.path}\n${module.name}\n${module.summary}\n${module.exported_symbols}`,
      status: module.status,
      source_of_truth: module.source_of_truth,
      trust_level: module.trust_level,
      updated_at: module.updated_at,
      snippet: (module.summary || "").slice(0, 500),
      matched_rules: [],
      content: includeContent ? module.summary : undefined
    });
  }

  for (const project of data.projects) {
    entities.push({
      id: project.id,
      entity_type: "Project",
      kind: project.kind.toUpperCase() || "PROJECT",
      label: project.name || project.path,
      path: project.path,
      text: `${project.path}\n${project.name}\n${project.kind}\n${project.language}\n${project.target_framework}\n${project.summary}`,
      status: project.status,
      source_of_truth: project.source_of_truth,
      trust_level: project.trust_level,
      updated_at: project.updated_at,
      snippet: (project.summary || "").slice(0, 500),
      matched_rules: [],
      content: includeContent ? project.summary : undefined
    });
  }

  return entities;
}

export function buildChunkPartOfRelations(data: ContextData): RelationRecord[] {
  const relations: RelationRecord[] = [];
  for (const chunk of data.chunks) {
    if (isWindowChunkId(chunk.id)) {
      relations.push({
        from: chunk.id,
        to: baseChunkId(chunk.id),
        relation: "PART_OF",
        note: "Overlap window belongs to base chunk"
      });
    }

    if (!chunk.file_id) {
      continue;
    }

    relations.push({
      from: chunk.id,
      to: chunk.file_id,
      relation: "PART_OF",
      note: "Chunk belongs to file"
    });
  }
  return relations;
}

export function entityCatalog(data: ContextData): Map<string, JsonObject> {
  const catalog = new Map<string, JsonObject>();
  const fileById = new Map(data.documents.map((document) => [document.id, document]));

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

  for (const chunk of data.chunks) {
    const filePath = fileById.get(chunk.file_id)?.path ?? "";
    const chunkEntity: JsonObject = {
      id: chunk.id,
      type: "Chunk",
      label: chunk.name || chunk.id,
      status: chunk.status,
      source_of_truth: chunk.source_of_truth
    };
    if (filePath) {
      chunkEntity.path = filePath;
    }
    catalog.set(chunk.id, chunkEntity);
  }

  for (const module of data.modules) {
    catalog.set(module.id, {
      id: module.id,
      type: "Module",
      label: module.name,
      status: module.status,
      source_of_truth: module.source_of_truth,
      path: module.path
    });
  }

  for (const project of data.projects) {
    catalog.set(project.id, {
      id: project.id,
      type: "Project",
      label: project.name || project.path,
      status: project.status,
      source_of_truth: project.source_of_truth,
      path: project.path
    });
  }

  return catalog;
}

export function buildEntitySearchMap(data: ContextData): Map<string, SearchEntity> {
  return new Map(buildSearchEntities(data, false).map((entity) => [entity.id, entity]));
}
