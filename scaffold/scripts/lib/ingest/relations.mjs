import path from "node:path";
import {
  CONFIG_KEY_REFERENCE_PATTERNS,
  NAMED_RESOURCE_REFERENCE_SOURCE_EXTENSIONS,
  PROJECT_DEFINITION_EXTENSIONS,
  SQL_OBJECT_REFERENCE_PATTERNS,
  SQL_REFERENCE_SOURCE_EXTENSIONS,
  SQL_RESOURCE_KEY_PATTERNS,
  SQL_STRING_REFERENCE_PATTERNS
} from "./constants.mjs";
import { normalizeToken, toPosixPath, uniqueSorted } from "./files.mjs";
import { isWindowChunkId } from "./chunks.mjs";

export function relationKey(...parts) {
  return parts.map((part) => String(part ?? "")).join("|");
}

export function uniqueRelations(relations) {
  const deduped = new Map();
  for (const relation of relations) {
    const key = relationKey(relation.from, relation.to, relation.note);
    if (!deduped.has(key)) {
      deduped.set(key, relation);
    }
  }
  return [...deduped.values()].sort((a, b) =>
    relationKey(a.from, a.to, a.note).localeCompare(relationKey(b.from, b.to, b.note))
  );
}

export function normalizeSqlName(value) {
  if (!value) {
    return "";
  }

  return String(value)
    .trim()
    .replace(/[;"`]/g, "")
    .replace(/\[(.+?)\]/g, "$1")
    .replace(/\s+/g, "")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.\.+/g, ".")
    .toLowerCase();
}

export function sqlChunkAliases(name) {
  const normalized = normalizeSqlName(name);
  if (!normalized) {
    return [];
  }

  const aliases = new Set([normalized]);
  const parts = normalized.split(".").filter(Boolean);
  if (parts.length > 1) {
    aliases.add(parts[parts.length - 1]);
  }
  return [...aliases];
}

export function configChunkAliases(chunk) {
  const aliases = new Set();
  const rawKey = String(chunk?.configKey ?? chunk?.name ?? "");
  const normalizedKey = normalizeToken(rawKey);
  if (normalizedKey) {
    aliases.add(normalizedKey);
  }
  const chunkName = String(chunk?.name ?? "");
  const tail = chunkName.split(".").pop() ?? "";
  const normalizedTail = normalizeToken(tail);
  if (normalizedTail) {
    aliases.add(normalizedTail);
  }
  return [...aliases];
}

export function namedEntryChunkAliases(chunk) {
  const aliases = new Set();
  const rawKey = String(chunk?.resourceKey ?? chunk?.configKey ?? chunk?.name ?? "");
  const normalizedKey = normalizeToken(rawKey);
  if (normalizedKey) {
    aliases.add(normalizedKey);
  }
  const chunkName = String(chunk?.name ?? "");
  const tail = chunkName.split(".").pop() ?? "";
  const normalizedTail = normalizeToken(tail);
  if (normalizedTail) {
    aliases.add(normalizedTail);
  }
  return [...aliases];
}

export function buildChunkAliasIndexes(chunkRecords) {
  const sqlChunkIdsByAlias = new Map();
  const configChunkIdsByAlias = new Map();
  const resourceChunkIdsByAlias = new Map();
  const settingChunkIdsByAlias = new Map();

  for (const chunk of chunkRecords) {
    if (isWindowChunkId(chunk?.id)) {
      continue;
    }

    const language = String(chunk?.language ?? "").toLowerCase();
    if (language === "sql") {
      for (const alias of sqlChunkAliases(chunk.name)) {
        const existing = sqlChunkIdsByAlias.get(alias) ?? [];
        sqlChunkIdsByAlias.set(alias, [...existing, chunk.id]);
      }
      continue;
    }

    if (language === "config") {
      for (const alias of configChunkAliases(chunk)) {
        const existing = configChunkIdsByAlias.get(alias) ?? [];
        configChunkIdsByAlias.set(alias, [...existing, chunk.id]);
      }
      continue;
    }

    if (language === "resource") {
      for (const alias of namedEntryChunkAliases(chunk)) {
        const existing = resourceChunkIdsByAlias.get(alias) ?? [];
        resourceChunkIdsByAlias.set(alias, [...existing, chunk.id]);
      }
      continue;
    }

    if (language === "settings") {
      for (const alias of namedEntryChunkAliases(chunk)) {
        const existing = settingChunkIdsByAlias.get(alias) ?? [];
        settingChunkIdsByAlias.set(alias, [...existing, chunk.id]);
      }
    }
  }

  return {
    sqlChunkIdsByAlias,
    configChunkIdsByAlias,
    resourceChunkIdsByAlias,
    settingChunkIdsByAlias
  };
}

export function extractSqlReferenceNamesFromString(text) {
  const refs = new Set();

  const normalizedName = normalizeSqlName(text);
  if (/^[a-z0-9_.]+$/i.test(normalizedName) && normalizedName.includes(".")) {
    refs.add(normalizedName);
  }

  for (const pattern of SQL_STRING_REFERENCE_PATTERNS) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = normalizeSqlName(match[1]);
      if (!name || name.startsWith("@") || name.startsWith("#")) {
        continue;
      }
      refs.add(name);
    }
  }

  return [...refs];
}

export function parseResxSqlReferenceMap(content) {
  const refsByKey = new Map();
  const dataPattern = /<data\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/data>/gi;
  let match;

  while ((match = dataPattern.exec(content)) !== null) {
    const key = normalizeToken(decodeXmlEntities(match[1]));
    if (!key) {
      continue;
    }

    const valueMatch = match[2].match(/<value>([\s\S]*?)<\/value>/i);
    if (!valueMatch) {
      continue;
    }

    const value = decodeXmlEntities(valueMatch[1]).trim();
    const refs = extractSqlReferenceNamesFromString(value);
    if (refs.length === 0) {
      continue;
    }

    const existing = refsByKey.get(key) ?? [];
    refsByKey.set(key, uniqueSorted([...existing, ...refs]));
  }

  return refsByKey;
}

export function parseResxKeyMap(content) {
  const fileKeys = new Map();
  const dataPattern = /<data\b[^>]*\bname="([^"]+)"[^>]*>/gi;
  let match;

  while ((match = dataPattern.exec(content)) !== null) {
    const key = normalizeToken(decodeXmlEntities(match[1]));
    if (!key) {
      continue;
    }
    fileKeys.set(key, true);
  }

  return fileKeys;
}

export function parseSettingsSqlReferenceMap(content) {
  const refsByKey = new Map();
  const settingPattern = /<Setting\b[^>]*\bName="([^"]+)"[^>]*>([\s\S]*?)<\/Setting>/gi;
  let match;

  while ((match = settingPattern.exec(content)) !== null) {
    const key = normalizeToken(decodeXmlEntities(match[1]));
    if (!key) {
      continue;
    }

    const valueMatch = match[2].match(/<Value(?:\s[^>]*)?>([\s\S]*?)<\/Value>/i);
    if (!valueMatch) {
      continue;
    }

    const value = decodeXmlEntities(valueMatch[1]).trim();
    const refs = extractSqlReferenceNamesFromString(value);
    if (refs.length === 0) {
      continue;
    }

    const existing = refsByKey.get(key) ?? [];
    refsByKey.set(key, uniqueSorted([...existing, ...refs]));
  }

  return refsByKey;
}

export function parseSettingsKeyMap(content) {
  const fileKeys = new Map();
  const settingPattern = /<Setting\b[^>]*\bName="([^"]+)"[^>]*>/gi;
  let match;

  while ((match = settingPattern.exec(content)) !== null) {
    const key = normalizeToken(decodeXmlEntities(match[1]));
    if (!key) {
      continue;
    }
    fileKeys.set(key, true);
  }

  return fileKeys;
}

export function parseConfigKeyMap(content) {
  const fileKeys = new Map();
  const addPattern = /<add\b([^>]+?)\/?>/gi;
  let match;

  while ((match = addPattern.exec(content)) !== null) {
    const attributes = match[1];
    const nameMatch = attributes.match(/\bname="([^"]+)"/i);
    const keyMatch = attributes.match(/\bkey="([^"]+)"/i);
    const normalized = normalizeToken(decodeXmlEntities(nameMatch?.[1] ?? keyMatch?.[1] ?? ""));
    if (!normalized) {
      continue;
    }
    fileKeys.set(normalized, true);
  }

  return fileKeys;
}

export function buildSqlResourceReferenceMap(fileRecords) {
  const refsByKey = new Map();

  for (const fileRecord of fileRecords) {
    const ext = path.extname(fileRecord.path).toLowerCase();
    let fileRefs = null;
    if (ext === ".resx") {
      fileRefs = parseResxSqlReferenceMap(fileRecord.content);
    } else if (ext === ".settings") {
      fileRefs = parseSettingsSqlReferenceMap(fileRecord.content);
    }

    if (!fileRefs) {
      continue;
    }

    for (const [key, refs] of fileRefs.entries()) {
      const existing = refsByKey.get(key) ?? [];
      refsByKey.set(key, uniqueSorted([...existing, ...refs]));
    }
  }

  return refsByKey;
}

export function buildNamedResourceFileMaps(fileRecords) {
  const resourceFilesByKey = new Map();
  const settingFilesByKey = new Map();
  const configFilesByKey = new Map();

  for (const fileRecord of fileRecords) {
    const ext = path.extname(fileRecord.path).toLowerCase();
    const keyMap =
      ext === ".resx"
        ? parseResxKeyMap(fileRecord.content)
        : ext === ".settings"
          ? parseSettingsKeyMap(fileRecord.content)
          : ext === ".config"
            ? parseConfigKeyMap(fileRecord.content)
          : null;

    if (!keyMap) {
      continue;
    }

    for (const key of keyMap.keys()) {
      const targetMap =
        ext === ".resx" ? resourceFilesByKey : ext === ".settings" ? settingFilesByKey : configFilesByKey;
      const list = targetMap.get(key) ?? [];
      list.push(fileRecord.id);
      targetMap.set(key, uniqueSorted(list));
    }
  }

  return { resourceFilesByKey, settingFilesByKey, configFilesByKey };
}

export function extractSqlResourceKeyReferences(content) {
  const keys = new Set();

  for (const pattern of SQL_RESOURCE_KEY_PATTERNS) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const key = normalizeToken(match[1]);
      if (key) {
        keys.add(key);
      }
    }
  }

  return [...keys];
}

export function extractConfigKeyReferences(content) {
  const keys = new Set();

  for (const pattern of CONFIG_KEY_REFERENCE_PATTERNS) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const key = normalizeToken(match[1]);
      if (key) {
        keys.add(key);
      }
    }
  }

  return [...keys];
}

export function shouldExtractNamedResourceReferences(filePath) {
  return NAMED_RESOURCE_REFERENCE_SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function generateNamedResourceRelations(fileRecords) {
  const { resourceFilesByKey, settingFilesByKey, configFilesByKey } = buildNamedResourceFileMaps(fileRecords);
  const usesResourceRelations = [];
  const usesSettingRelations = [];
  const usesConfigRelations = [];
  const resourceSeen = new Set();
  const settingSeen = new Set();
  const configSeen = new Set();

  for (const fileRecord of fileRecords) {
    if (!shouldExtractNamedResourceReferences(fileRecord.path)) {
      continue;
    }

    for (const key of extractSqlResourceKeyReferences(fileRecord.content)) {
      for (const targetFileId of resourceFilesByKey.get(key) ?? []) {
        const relKey = relationKey(fileRecord.id, targetFileId, key);
        if (!resourceSeen.has(relKey) && fileRecord.id !== targetFileId) {
          resourceSeen.add(relKey);
          usesResourceRelations.push({
            from: fileRecord.id,
            to: targetFileId,
            note: key
          });
        }
      }

      for (const targetFileId of settingFilesByKey.get(key) ?? []) {
        const relKey = relationKey(fileRecord.id, targetFileId, key);
        if (!settingSeen.has(relKey) && fileRecord.id !== targetFileId) {
          settingSeen.add(relKey);
          usesSettingRelations.push({
            from: fileRecord.id,
            to: targetFileId,
            note: key
          });
        }
      }
    }

    for (const key of extractConfigKeyReferences(fileRecord.content)) {
      for (const targetFileId of configFilesByKey.get(key) ?? []) {
        const relKey = relationKey(fileRecord.id, targetFileId, key);
        if (!configSeen.has(relKey) && fileRecord.id !== targetFileId) {
          configSeen.add(relKey);
          usesConfigRelations.push({
            from: fileRecord.id,
            to: targetFileId,
            note: key
          });
        }
      }
    }
  }

  usesResourceRelations.sort((a, b) =>
    relationKey(a.from, a.to, a.note).localeCompare(relationKey(b.from, b.to, b.note))
  );
  usesSettingRelations.sort((a, b) =>
    relationKey(a.from, a.to, a.note).localeCompare(relationKey(b.from, b.to, b.note))
  );
  usesConfigRelations.sort((a, b) =>
    relationKey(a.from, a.to, a.note).localeCompare(relationKey(b.from, b.to, b.note))
  );

  return { usesResourceRelations, usesSettingRelations, usesConfigRelations };
}

export function parseConfigIncludeTargets(fileRecord) {
  const relPath = toPosixPath(String(fileRecord?.path ?? "").trim());
  const lowerPath = relPath.toLowerCase();
  if (!lowerPath.endsWith(".config")) {
    return [];
  }

  const content = String(fileRecord?.content ?? "");
  const dir = path.posix.dirname(relPath);
  const includes = [];
  const sectionPattern =
    /<([A-Za-z_][A-Za-z0-9_.:-]*)\b([^>]*?)\b(configSource|file)="([^"]+)"([^>]*)>/gi;
  let match;

  while ((match = sectionPattern.exec(content)) !== null) {
    const sectionName = String(match[1] ?? "").trim().toLowerCase();
    const attributeName = String(match[3] ?? "").trim().toLowerCase();
    const includePath = decodeXmlEntities(match[4] ?? "").trim().replace(/\\/g, "/");
    if (!sectionName || !attributeName || !includePath) {
      continue;
    }
    if (includePath.startsWith("/") || includePath.startsWith("~")) {
      continue;
    }

    const resolvedPath = path.posix.normalize(dir === "." ? includePath : `${dir}/${includePath}`);
    if (!resolvedPath || resolvedPath.startsWith("../")) {
      continue;
    }

    includes.push({
      targetPath: resolvedPath,
      note: `${sectionName}:${attributeName}`
    });
  }

  return includes;
}

export function generateConfigIncludeRelations(fileRecords) {
  const fileIdByPath = new Map(fileRecords.map((record) => [toPosixPath(record.path), record.id]));
  const relations = [];
  const seen = new Set();

  for (const fileRecord of fileRecords) {
    for (const include of parseConfigIncludeTargets(fileRecord)) {
      const targetFileId = fileIdByPath.get(include.targetPath);
      if (!targetFileId || targetFileId === fileRecord.id) {
        continue;
      }
      const key = relationKey(fileRecord.id, targetFileId, include.note);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      relations.push({
        from: fileRecord.id,
        to: targetFileId,
        note: include.note
      });
    }
  }

  relations.sort((a, b) => relationKey(a.from, a.to, a.note).localeCompare(relationKey(b.from, b.to, b.note)));
  return relations;
}

export function parseSectionHandlerDeclarations(content) {
  const declarations = [];
  const sectionPattern = /<section\b([^>]*?)\/?>/gi;
  let match;

  while ((match = sectionPattern.exec(String(content ?? ""))) !== null) {
    const attrs = match[1] ?? "";
    const nameMatch = attrs.match(/\bname="([^"]+)"/i);
    const typeMatch = attrs.match(/\btype="([^"]+)"/i);
    const sectionName = normalizeToken(decodeXmlEntities(nameMatch?.[1] ?? ""));
    const typeValue = decodeXmlEntities(typeMatch?.[1] ?? "").trim();
    if (!sectionName || !typeValue) {
      continue;
    }

    const typeParts = typeValue.split(",").map((part) => part.trim()).filter(Boolean);
    const fullTypeName = typeParts[0] ?? "";
    const assemblyName = typeParts[1] ?? "";
    const shortTypeName = fullTypeName.split(".").pop()?.split("+").pop() ?? "";
    const normalizedTypeName = normalizeToken(shortTypeName);
    const normalizedAssemblyName = normalizeToken(assemblyName);
    if (!normalizedTypeName && !normalizedAssemblyName) {
      continue;
    }

    declarations.push({
      sectionName,
      normalizedTypeName,
      normalizedAssemblyName
    });
  }

  return declarations;
}

export function buildProjectAssemblyFileMap(fileRecords) {
  const aliasMap = new Map();

  for (const fileRecord of fileRecords) {
    const ext = path.extname(fileRecord.path).toLowerCase();
    if (!PROJECT_DEFINITION_EXTENSIONS.has(ext) || ext === ".sln") {
      continue;
    }

    const aliases = uniqueSorted([
      normalizeToken(extractXmlTagValue(fileRecord.content, "AssemblyName")),
      normalizeToken(extractXmlTagValue(fileRecord.content, "RootNamespace")),
      normalizeToken(path.basename(fileRecord.path, ext))
    ].filter(Boolean));

    for (const alias of aliases) {
      const existing = aliasMap.get(alias) ?? [];
      aliasMap.set(alias, uniqueSorted([...existing, fileRecord.id]));
    }
  }

  return aliasMap;
}

export function extractDeclaredTypeNames(fileRecord) {
  const ext = path.extname(fileRecord.path).toLowerCase();
  const pattern =
    ext === ".vb"
      ? /\b(?:Public|Friend|Private|Protected|Partial|MustInherit|NotInheritable|Shadows|Default|Overridable|Overrides|Shared|\s)*(?:Class|Module|Structure|Interface|Enum)\s+([A-Za-z_][A-Za-z0-9_]*)/gi
      : ext === ".cs"
        ? /\b(?:public|internal|private|protected|abstract|sealed|static|partial|\s)*(?:class|struct|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/gi
        : null;

  if (!pattern) {
    return [];
  }

  const typeNames = new Set();
  let match;
  while ((match = pattern.exec(String(fileRecord.content ?? ""))) !== null) {
    const normalized = normalizeToken(match[1] ?? "");
    if (normalized) {
      typeNames.add(normalized);
    }
  }

  return [...typeNames];
}

export function buildCodeTypeFileMap(fileRecords) {
  const typeMap = new Map();

  for (const fileRecord of fileRecords) {
    if (fileRecord.kind !== "CODE") {
      continue;
    }
    for (const typeName of extractDeclaredTypeNames(fileRecord)) {
      const existing = typeMap.get(typeName) ?? [];
      typeMap.set(typeName, uniqueSorted([...existing, fileRecord.id]));
    }
  }

  return typeMap;
}

export function longestCommonPathPrefixLength(pathA, pathB) {
  const partsA = toPosixPath(pathA).split("/").filter(Boolean);
  const partsB = toPosixPath(pathB).split("/").filter(Boolean);
  const limit = Math.min(partsA.length, partsB.length);
  let count = 0;
  while (count < limit && partsA[count] === partsB[count]) {
    count += 1;
  }
  return count;
}

export function generateMachineConfigRelations(fileRecords) {
  const machineConfigs = fileRecords.filter(
    (record) => path.basename(record.path).toLowerCase() === "machine.config"
  );
  if (machineConfigs.length === 0) {
    return [];
  }

  const relations = [];
  const seen = new Set();

  for (const fileRecord of fileRecords) {
    const lowerPath = fileRecord.path.toLowerCase();
    if (
      !lowerPath.endsWith(".config") ||
      path.basename(lowerPath) === "machine.config" ||
      !/<configuration\b/i.test(String(fileRecord.content ?? "")) ||
      parseConfigTransformTarget(fileRecord)
    ) {
      continue;
    }

    const rankedTargets = machineConfigs
      .filter((candidate) => candidate.id !== fileRecord.id)
      .map((candidate) => ({
        id: candidate.id,
        score: longestCommonPathPrefixLength(fileRecord.path, candidate.path)
      }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    const target = rankedTargets[0];
    if (!target) {
      continue;
    }

    const key = relationKey(fileRecord.id, target.id, "inherits:machine");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    relations.push({
      from: fileRecord.id,
      to: target.id,
      note: "inherits:machine"
    });
  }

  return uniqueRelations(relations);
}

export function generateSectionHandlerRelations(fileRecords) {
  const projectAssemblyFileMap = buildProjectAssemblyFileMap(fileRecords);
  const codeTypeFileMap = buildCodeTypeFileMap(fileRecords);
  const relations = [];

  for (const fileRecord of fileRecords) {
    if (!fileRecord.path.toLowerCase().endsWith(".config")) {
      continue;
    }

    for (const declaration of parseSectionHandlerDeclarations(fileRecord.content)) {
      const note = `section_handler:${declaration.sectionName}`;

      for (const targetFileId of projectAssemblyFileMap.get(declaration.normalizedAssemblyName) ?? []) {
        relations.push({
          from: fileRecord.id,
          to: targetFileId,
          note
        });
      }

      for (const targetFileId of codeTypeFileMap.get(declaration.normalizedTypeName) ?? []) {
        relations.push({
          from: fileRecord.id,
          to: targetFileId,
          note
        });
      }
    }
  }

  return uniqueRelations(relations.filter((relation) => relation.from !== relation.to));
}

export function generateConfigTransformKeyRelations(fileRecords, chunkRecords) {
  const fileIdByPath = new Map(fileRecords.map((record) => [toPosixPath(record.path), record.id]));
  const chunkFileIdById = new Map(chunkRecords.map((chunk) => [chunk.id, chunk.file_id]));
  const configChunkIdsByAlias = new Map();

  for (const chunk of chunkRecords) {
    if (isWindowChunkId(chunk.id) || String(chunk.language ?? "").toLowerCase() !== "config") {
      continue;
    }
    for (const alias of configChunkAliases(chunk)) {
      const existing = configChunkIdsByAlias.get(alias) ?? [];
      configChunkIdsByAlias.set(alias, [...existing, chunk.id]);
    }
  }

  const relations = [];
  for (const fileRecord of fileRecords) {
    const transform = parseConfigTransformTarget(fileRecord);
    if (!transform) {
      continue;
    }

    const targetFileId = fileIdByPath.get(transform.targetPath);
    if (!targetFileId) {
      continue;
    }

    for (const key of parseConfigKeyMap(fileRecord.content).keys()) {
      for (const targetChunkId of configChunkIdsByAlias.get(key) ?? []) {
        if (chunkFileIdById.get(targetChunkId) !== targetFileId) {
          continue;
        }
        relations.push({
          from: fileRecord.id,
          to: targetChunkId,
          note: `${key}:${transform.environment}`
        });
      }
    }
  }

  return uniqueRelations(relations);
}

export function parseConfigTransformTarget(fileRecord) {
  const relPath = toPosixPath(String(fileRecord?.path ?? "").trim());
  const lowerPath = relPath.toLowerCase();
  if (!lowerPath.endsWith(".config")) {
    return null;
  }

  const content = String(fileRecord?.content ?? "");
  if (!/\bxdt:(?:transform|locator)\b/i.test(content) && !/\bxmlns:xdt=/i.test(content)) {
    return null;
  }

  const dir = path.posix.dirname(relPath);
  const baseName = path.posix.basename(relPath, ".config");
  const match = baseName.match(/^(.+)\.([^.]+)$/);
  if (!match) {
    return null;
  }

  const baseStem = match[1]?.trim();
  const environment = match[2]?.trim();
  if (!baseStem || !environment) {
    return null;
  }

  const targetPath = dir === "." ? `${baseStem}.config` : `${dir}/${baseStem}.config`;
  return {
    targetPath,
    environment: normalizeToken(environment)
  };
}

export function generateConfigTransformRelations(fileRecords) {
  const fileIdByPath = new Map(fileRecords.map((record) => [toPosixPath(record.path), record.id]));
  const relations = [];
  const seen = new Set();

  for (const fileRecord of fileRecords) {
    const transform = parseConfigTransformTarget(fileRecord);
    if (!transform) {
      continue;
    }

    const targetFileId = fileIdByPath.get(transform.targetPath);
    if (!targetFileId || targetFileId === fileRecord.id) {
      continue;
    }

    const key = relationKey(fileRecord.id, targetFileId, transform.environment);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    relations.push({
      from: fileRecord.id,
      to: targetFileId,
      note: transform.environment
    });
  }

  relations.sort((a, b) => relationKey(a.from, a.to, a.note).localeCompare(relationKey(b.from, b.to, b.note)));
  return relations;
}

export function shouldExtractSqlReferences(filePath) {
  return SQL_REFERENCE_SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function extractSqlObjectReferencesFromContent(content, filePath = "", sqlResourceReferenceMap = new Map()) {
  const refs = new Set();
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".resx") {
    for (const values of parseResxSqlReferenceMap(content).values()) {
      for (const ref of values) {
        refs.add(ref);
      }
    }
  } else if (ext === ".settings") {
    for (const values of parseSettingsSqlReferenceMap(content).values()) {
      for (const ref of values) {
        refs.add(ref);
      }
    }
  }

  for (const pattern of SQL_OBJECT_REFERENCE_PATTERNS) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      for (const ref of extractSqlReferenceNamesFromString(match[1])) {
        refs.add(ref);
      }
    }
  }

  if (sqlResourceReferenceMap.size > 0) {
    for (const key of extractSqlResourceKeyReferences(content)) {
      for (const ref of sqlResourceReferenceMap.get(key) ?? []) {
        refs.add(ref);
      }
    }
  }

  return uniqueSorted([...refs]);
}

export function decodeXmlEntities(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function extractXmlTagValue(content, tagName) {
  const match = content.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeXmlEntities(match[1]).trim() : "";
}
