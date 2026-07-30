import path from "node:path";
import { PROJECT_DEFINITION_EXTENSIONS } from "./constants.mjs";
import { toPosixPath } from "./files.mjs";
import {
  decodeXmlEntities,
  extractXmlTagValue,
  relationKey
} from "./relations.mjs";
import { REPO_ROOT } from "./runtime-paths.mjs";

export function projectIdFor(filePath) {
  return `project:${filePath}`;
}

export function isProjectDefinitionFile(filePath) {
  return PROJECT_DEFINITION_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function resolveProjectRelativePath(baseFilePath, includePath) {
  if (!includePath) {
    return null;
  }

  const normalizedInclude = toPosixPath(decodeXmlEntities(includePath).trim().replace(/\\/g, "/"));
  if (!normalizedInclude) {
    return null;
  }

  const resolved = path.resolve(REPO_ROOT, path.dirname(baseFilePath), normalizedInclude);
  const relPath = toPosixPath(path.relative(REPO_ROOT, resolved));
  if (!relPath || relPath.startsWith("../")) {
    return null;
  }

  return relPath;
}

export function projectLanguageForExtension(ext) {
  switch (ext) {
    case ".vbproj":
      return "vbnet";
    case ".csproj":
      return "csharp";
    case ".fsproj":
      return "fsharp";
    case ".vcxproj":
      return "cpp";
    case ".sln":
      return "solution";
    default:
      return "dotnet";
  }
}

export function collectXmlIncludeValues(content, elementNames) {
  const values = [];
  const pattern = new RegExp(
    `<(?:${elementNames.join("|")})\\b[^>]*\\bInclude="([^"]+)"[^>]*\\/?>`,
    "gi"
  );
  let match;
  while ((match = pattern.exec(content)) !== null) {
    values.push(decodeXmlEntities(match[1]).trim());
  }
  return values;
}

export function parseSolutionProject(fileRecord, indexedFileIds) {
  const declaredMembers = [];
  const referencesProjectRelations = [];
  const includesFileRelations = [];
  const fileRelationKeys = new Set();
  const ext = path.extname(fileRecord.path).toLowerCase();
  const fallbackName = path.basename(fileRecord.path, ext);
  const projectPattern =
    /^Project\([^)]*\)\s*=\s*"([^"]+)",\s*"([^"]+\.(?:vbproj|csproj|fsproj|vcxproj))",\s*"\{[^"]+\}"$/gim;

  let match;
  while ((match = projectPattern.exec(fileRecord.content)) !== null) {
    const memberName = match[1].trim();
    const memberPath = resolveProjectRelativePath(fileRecord.path, match[2]);
    if (!memberPath) {
      continue;
    }
    declaredMembers.push({ name: memberName, path: memberPath });
    const targetId = projectIdFor(memberPath);
    if (indexedFileIds.has(`file:${memberPath}`)) {
      referencesProjectRelations.push({
        from: projectIdFor(fileRecord.path),
        to: targetId,
        note: `solution_member:${memberName}`
      });
    }
  }

  for (const fileId of [`file:${fileRecord.path}`]) {
    if (indexedFileIds.has(fileId) && !fileRelationKeys.has(fileId)) {
      fileRelationKeys.add(fileId);
      includesFileRelations.push({ from: projectIdFor(fileRecord.path), to: fileId });
    }
  }

  const summaryParts = [`Solution ${fallbackName}`];
  if (declaredMembers.length > 0) {
    summaryParts.push(`Contains ${declaredMembers.length} project references`);
  }

  return {
    project: {
      id: projectIdFor(fileRecord.path),
      path: fileRecord.path,
      name: fallbackName,
      kind: "solution",
      language: projectLanguageForExtension(ext),
      target_framework: "",
      summary: `${summaryParts.join(". ")}.`,
      file_count: includesFileRelations.length,
      updated_at: fileRecord.updated_at,
      source_of_truth: false,
      trust_level: 78,
      status: "active"
    },
    includesFileRelations,
    referencesProjectRelations
  };
}
export function parseDotNetProject(fileRecord, indexedFileIds) {
  const ext = path.extname(fileRecord.path).toLowerCase();
  const fallbackName = path.basename(fileRecord.path, ext);
  const assemblyName = extractXmlTagValue(fileRecord.content, "AssemblyName");
  const rootNamespace = extractXmlTagValue(fileRecord.content, "RootNamespace");
  const targetFrameworkRaw =
    extractXmlTagValue(fileRecord.content, "TargetFramework") ||
    extractXmlTagValue(fileRecord.content, "TargetFrameworkVersion") ||
    extractXmlTagValue(fileRecord.content, "TargetFrameworks");
  const targetFramework = targetFrameworkRaw.split(";")[0].trim();
  const includeCandidates = collectXmlIncludeValues(fileRecord.content, [
    "Compile",
    "Content",
    "EmbeddedResource",
    "None",
    "Page",
    "ApplicationDefinition"
  ]);
  const projectReferenceCandidates = collectXmlIncludeValues(fileRecord.content, ["ProjectReference"]);
  const includesFileRelations = [];
  const referencesProjectRelations = [];
  const fileRelationKeys = new Set();

  const addFileRelation = (relPath) => {
    const fileId = `file:${relPath}`;
    if (!indexedFileIds.has(fileId) || fileRelationKeys.has(fileId)) {
      return;
    }
    fileRelationKeys.add(fileId);
    includesFileRelations.push({
      from: projectIdFor(fileRecord.path),
      to: fileId
    });
  };

  addFileRelation(fileRecord.path);

  for (const includePath of includeCandidates) {
    const relPath = resolveProjectRelativePath(fileRecord.path, includePath);
    if (!relPath) {
      continue;
    }
    addFileRelation(relPath);
  }

  for (const includePath of projectReferenceCandidates) {
    const relPath = resolveProjectRelativePath(fileRecord.path, includePath);
    if (!relPath) {
      continue;
    }
    const targetFileId = `file:${relPath}`;
    if (!indexedFileIds.has(targetFileId)) {
      continue;
    }
    referencesProjectRelations.push({
      from: projectIdFor(fileRecord.path),
      to: projectIdFor(relPath),
      note: includePath
    });
  }

  const summaryParts = [
    `${projectLanguageForExtension(ext).toUpperCase()} project ${assemblyName || rootNamespace || fallbackName}`
  ];
  if (targetFramework) {
    summaryParts.push(`Target framework ${targetFramework}`);
  }
  if (includesFileRelations.length > 1) {
    summaryParts.push(`Includes ${includesFileRelations.length - 1} indexed project files`);
  }
  if (referencesProjectRelations.length > 0) {
    summaryParts.push(`References ${referencesProjectRelations.length} projects`);
  }

  return {
    project: {
      id: projectIdFor(fileRecord.path),
      path: fileRecord.path,
      name: assemblyName || rootNamespace || fallbackName,
      kind: "project",
      language: projectLanguageForExtension(ext),
      target_framework: targetFramework,
      summary: `${summaryParts.join(". ")}.`,
      file_count: includesFileRelations.length,
      updated_at: fileRecord.updated_at,
      source_of_truth: false,
      trust_level: 80,
      status: "active"
    },
    includesFileRelations,
    referencesProjectRelations
  };
}

export function generateProjects(fileRecords) {
  const indexedFileIds = new Set(fileRecords.map((record) => record.id));
  const projectRecords = [];
  const includesFileRelations = [];
  const referencesProjectRelations = [];
  const includeKeys = new Set();
  const referenceKeys = new Set();

  for (const fileRecord of fileRecords) {
    if (!isProjectDefinitionFile(fileRecord.path)) {
      continue;
    }

    const ext = path.extname(fileRecord.path).toLowerCase();
    const parsed =
      ext === ".sln"
        ? parseSolutionProject(fileRecord, indexedFileIds)
        : parseDotNetProject(fileRecord, indexedFileIds);

    projectRecords.push(parsed.project);

    for (const relation of parsed.includesFileRelations) {
      const key = relationKey(relation.from, relation.to);
      if (includeKeys.has(key)) {
        continue;
      }
      includeKeys.add(key);
      includesFileRelations.push(relation);
    }

    for (const relation of parsed.referencesProjectRelations) {
      const key = relationKey(relation.from, relation.to, relation.note);
      if (referenceKeys.has(key)) {
        continue;
      }
      referenceKeys.add(key);
      referencesProjectRelations.push(relation);
    }
  }

  projectRecords.sort((a, b) => a.path.localeCompare(b.path));
  includesFileRelations.sort((a, b) => relationKey(a.from, a.to).localeCompare(relationKey(b.from, b.to)));
  referencesProjectRelations.sort((a, b) =>
    relationKey(a.from, a.to, a.note).localeCompare(relationKey(b.from, b.to, b.note))
  );

  return {
    projects: projectRecords,
    includesFileRelations,
    referencesProjectRelations
  };
}
