import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildConventionProfiles, validateConventionProfile, validateConventionProfilesAgainstContext } from "./conventions.js";
import type { ConventionConflict, ConventionProfile } from "./conventions.js";
import { loadContextData } from "./graph.js";
import { REPO_ROOT } from "./paths.js";
import { runLocalPatternEvidence } from "./patternEvidence.js";
import type { ContextData, ReviewParams } from "./types.js";

export const REVIEW_SCHEMA_VERSION = 1;
export const REVIEW_GENERATOR_VERSION = "repo-diff-review-v1";
export const REVIEW_LIMITS = Object.freeze({
  max_changed_paths: 200,
  max_total_diff_utf8_bytes: 1_000_000,
  max_file_diff_utf8_bytes: 250_000,
  max_findings: 100,
  max_conflicts: 50,
  max_evidence_per_finding_or_conflict: 10,
  max_json_response_utf8_bytes: 1_000_000,
  max_text_response_utf8_bytes: 250_000,
});

const UNSAFE_VISIBLE_TEXT_PATTERN = /[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PROFILE_ID_PATTERN = /^convention:[a-f0-9]{32}$/u;
const OID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const CODE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".hpp", ".java", ".js", ".jsx",
  ".mjs", ".mts", ".php", ".py", ".rb", ".rs", ".sh", ".sql", ".swift", ".ts", ".tsx",
  ".vb", ".vue",
]);
const FINDING_CATEGORIES = new Set([
  "duplicate_helper", "shared_abstraction_bypass", "error_convention", "logging_convention", "testing_convention",
]);
const RELATION_TYPES = ["CONSTRAINS", "IMPLEMENTS", "SUPERSEDES", "DEFINES", "CALLS", "IMPORTS", "CALLS_SQL", "USES_CONFIG_KEY", "USES_RESOURCE_KEY", "USES_SETTING_KEY", "PART_OF", "CONTAINS", "CONTAINS_MODULE", "EXPORTS", "INCLUDES_FILE", "REFERENCES_PROJECT", "USES_RESOURCE", "USES_SETTING", "USES_CONFIG", "TRANSFORMS_CONFIG"] as const;

type Evidence = {
  entity_id: string;
  path?: string;
  start_line?: number;
  end_line?: number;
  relation?: { from: string; to: string; type: string };
};
type Counted<T> = { observed_count: number; omitted_count: number; items: T[] };
type ChangedStatus = "added" | "modified" | "deleted" | "renamed" | "type_changed" | "untracked";
type ProfileRef = {
  profile_id: string;
  profile_hash: string;
  language: string;
  subsystem_id: string;
  subsystem_path: string;
  selection_tier: "active_authority" | "same_file" | "directory_module" | "feature_graph" | "repository_fallback";
};
type ChangedFile = {
  path: string;
  old_path: string | null;
  status: ChangedStatus;
  binary: boolean;
  diff_utf8_bytes: number;
  added_lines: number;
  deleted_lines: number;
  profiles: ProfileRef[];
};
type Finding = {
  id: string;
  path: string;
  location: { start_line: number; end_line: number };
  category: "duplicate_helper" | "shared_abstraction_bypass" | "error_convention" | "logging_convention" | "testing_convention";
  enforcement: "deterministic" | "heuristic";
  confidence: number;
  message: string;
  reason: string;
  profile: { profile_id: string; profile_hash: string };
  evidence: Counted<Evidence>;
};
type ReviewConflict = {
  id: string;
  path: string;
  key: string;
  message: string;
  profile: { profile_id: string; profile_hash: string };
  claims: Counted<{ source_id: string; source_type: "Rule" | "ADR"; priority: number; value_hash: string; evidence: Evidence[] }>;
};
export type ReviewData = {
  schema_version: 1;
  generator_version: string;
  review_hash: string;
  repository: { repository_id: string; head_oid: string; git_metadata_hash: string };
  diff_hash: string;
  changed_files: Counted<ChangedFile>;
  findings: Counted<Finding>;
  conflicts: Counted<ReviewConflict>;
  diagnostics: {
    eligible_code_files: number;
    reviewed_code_files: number;
    no_applicable_profile: number;
    binary_files: number;
    deletions: number;
    untracked_files: number;
  };
  limits: typeof REVIEW_LIMITS;
  context_source: "cache" | "ryu";
};

type GitEntry = {
  path: string;
  oldPath: string | null;
  status: ChangedStatus;
  binary: boolean;
  diff: Buffer;
  added: Array<{ line: number; text: string }>;
  addedCount: number;
  deletedCount: number;
};
type Identity = { dev: bigint; ino: bigint; mode: bigint; nlink: bigint; size: bigint; mtimeNs: bigint };
type CandidateBinding = { state: "file" | "missing"; identity_hash: string; content_hash: string; bytes?: Buffer };
type ReviewHooks = {
  after_discovery?: () => void;
  after_file_read?: (repoPath: string) => void;
  before_context?: () => void;
  before_output?: () => void;
};
type ReviewOptions = {
  repo_root?: string;
  repository_id?: string;
  data?: ContextData;
  hooks?: ReviewHooks;
};

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(compareText)) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) output[key] = canonicalize(item);
    }
    return output;
  }
  return value;
}
export function canonicalReviewJson(value: unknown): string { return `${JSON.stringify(canonicalize(value), null, 2)}\n`; }
function canonicalKey(value: unknown): string { return JSON.stringify(canonicalize(value)); }
function hashBytes(value: string | Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function isSafeVisible(value: string): boolean { return !UNSAFE_VISIBLE_TEXT_PATTERN.test(value); }
function assertSafeVisible(value: unknown, seen = new Set<object>()): void {
  if (typeof value === "string") { if (!isSafeVisible(value)) throw new Error("Review public output contains unsafe visible text"); return; }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) assertSafeVisible(item, seen);
}
function assertExactKeys(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value as Record<string, unknown>).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} has unknown or missing schema keys`);
}
function assertInteger(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} is invalid`);
}
function assertString(value: unknown, label: string, max = 4096, allowEmpty = false): asserts value is string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > max || !isSafeVisible(value)) throw new Error(`${label} is invalid`);
}
function assertEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): asserts value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${label} is invalid`);
}
function normalizeRepoPath(value: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 1024 || value !== value.trim() || !isSafeVisible(value) ||
    value.includes("\\") || value.includes(":") || value.startsWith("/") || value.endsWith("/") || value.includes("//") ||
    value.split("/").some((part) => part === "" || part === "." || part === "..") ||
    value === ".git" || value.startsWith(".git/") || value === ".context" || value.startsWith(".context/")
  ) throw new Error("Review discovered an unsafe repository path");
  return value;
}
function statIdentity(stats: fs.BigIntStats): Identity {
  return { dev: stats.dev, ino: stats.ino, mode: stats.mode, nlink: stats.nlink, size: stats.size, mtimeNs: stats.mtimeNs };
}
function sameIdentity(left: Identity, right: Identity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.nlink === right.nlink && left.size === right.size && left.mtimeNs === right.mtimeNs;
}
function lstatIdentity(target: string): Identity {
  return statIdentity(fs.lstatSync(target, { bigint: true }));
}
function identityValue(value: Identity): string[] { return [value.dev, value.ino, value.mode, value.nlink, value.size, value.mtimeNs].map(String); }
function assertRealDirectoryAncestry(target: string): void {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of path.relative(parsed.root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stats = fs.lstatSync(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("Review repository ancestry is unsafe");
  }
}
function bindCandidatePath(repoRoot: string, repoPath: string, expectMissing = false, hook?: (path: string) => void): CandidateBinding {
  const canonical = normalizeRepoPath(repoPath);
  let current = repoRoot;
  const identities: string[][] = [];
  for (const [index, segment] of canonical.split("/").entries()) {
    current = path.join(current, segment);
    const final = index === canonical.split("/").length - 1;
    let stats: fs.BigIntStats;
    try { stats = fs.lstatSync(current, { bigint: true }); }
    catch (error) {
      if (final && expectMissing && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return { state: "missing", identity_hash: hashBytes(canonicalReviewJson(identities)), content_hash: hashBytes("missing") };
      }
      if (final && (error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Review changed path disappeared during collection");
      throw error;
    }
    if (stats.isSymbolicLink()) throw new Error("Review path contains a symbolic link");
    if (!final && !stats.isDirectory()) throw new Error("Review path contains a non-directory ancestor");
    if (final && (!stats.isFile() || stats.nlink !== 1n)) throw new Error("Review path is not a single-link regular file");
    identities.push(identityValue(statIdentity(stats)));
  }
  if (expectMissing) throw new Error("Review deleted path changed during collection");
  const before = lstatIdentity(current);
  if (before.size > BigInt(REVIEW_LIMITS.max_file_diff_utf8_bytes) * 16n) throw new Error("Review changed file is too large to bind safely");
  const bytes = fs.readFileSync(current);
  hook?.(canonical);
  const after = lstatIdentity(current);
  if (!sameIdentity(before, after) || BigInt(bytes.byteLength) !== before.size) throw new Error("Review changed file identity or bytes changed during collection");
  return { state: "file", identity_hash: hashBytes(canonicalReviewJson(identities)), content_hash: hashBytes(bytes), bytes };
}
function stableExistingFile(repoRoot: string, repoPath: string, hook?: (path: string) => void): Buffer {
  return bindCandidatePath(repoRoot, repoPath, false, hook).bytes!;
}
function git(repoRoot: string, args: string[], maxBuffer = 2_000_000): Buffer {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: null, input: undefined, maxBuffer, timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) throw new Error("Review could not read Git state safely");
  return result.stdout;
}
function parseNameStatus(bytes: Buffer): Array<{ code: string; path: string; oldPath: string | null }> {
  const tokens = bytes.toString("utf8").split("\0");
  if (tokens.at(-1) === "") tokens.pop();
  const output: Array<{ code: string; path: string; oldPath: string | null }> = [];
  for (let index = 0; index < tokens.length;) {
    const code = tokens[index++];
    if (!/^(?:A|M|D|T|R[0-9]{1,3}|C[0-9]{1,3})$/u.test(code)) throw new Error("Review received malformed Git path status");
    if (code.startsWith("R") || code.startsWith("C")) {
      const oldPath = normalizeRepoPath(tokens[index++] ?? "");
      const nextPath = normalizeRepoPath(tokens[index++] ?? "");
      output.push({ code, path: nextPath, oldPath });
    } else {
      output.push({ code, path: normalizeRepoPath(tokens[index++] ?? ""), oldPath: null });
    }
  }
  return output;
}
function parseUnifiedDiff(diff: Buffer, untrackedBytes?: Buffer): { binary: boolean; added: GitEntry["added"]; addedCount: number; deletedCount: number } {
  const binary = (untrackedBytes ? untrackedBytes.includes(0) : diff.includes(0)) || /^GIT binary patch$/mu.test(diff.toString("utf8"));
  if (binary) return { binary: true, added: [], addedCount: 0, deletedCount: 0 };
  const text = untrackedBytes ? untrackedBytes.toString("utf8") : diff.toString("utf8");
  if (Buffer.byteLength(text, "utf8") !== (untrackedBytes?.byteLength ?? diff.byteLength)) throw new Error("Review diff input is not canonical UTF-8");
  if (untrackedBytes) {
    const lines = text.split("\n");
    return { binary: false, added: lines.map((line, index) => ({ line: index + 1, text: line })).filter((item) => item.text.length > 0), addedCount: lines.length - (text.endsWith("\n") ? 1 : 0), deletedCount: 0 };
  }
  const added: GitEntry["added"] = [];
  let newLine = 0;
  let addedCount = 0;
  let deletedCount = 0;
  let inHunk = false;
  for (const line of text.split("\n")) {
    const hunk = /^@@ -[0-9]+(?:,[0-9]+)? \+([0-9]+)(?:,[0-9]+)? @@/u.exec(line);
    if (hunk) { newLine = Number(hunk[1]); inHunk = true; continue; }
    if (!inHunk) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) { added.push({ line: newLine, text: line.slice(1) }); newLine += 1; addedCount += 1; }
    else if (line.startsWith("-") && !line.startsWith("---")) deletedCount += 1;
    else if (!line.startsWith("\\")) newLine += 1;
  }
  return { binary: false, added, addedCount, deletedCount };
}
function changedStatus(code: string): ChangedStatus {
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  if (code === "T") return "type_changed";
  if (code.startsWith("R") || code.startsWith("C")) return "renamed";
  return "modified";
}
function bindAbsoluteMetadataFile(target: string, maxBytes: bigint): { identity: Identity; hash: string } {
  assertRealDirectoryAncestry(path.dirname(target));
  const before = lstatIdentity(target);
  const stats = fs.lstatSync(target, { bigint: true });
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n || stats.size > maxBytes) throw new Error("Review Git metadata file is unsafe");
  const bytes = fs.readFileSync(target);
  const after = lstatIdentity(target);
  if (!sameIdentity(before, after) || BigInt(bytes.byteLength) !== before.size) throw new Error("Review Git metadata changed during collection");
  return { identity: before, hash: hashBytes(Buffer.concat([Buffer.from(identityValue(before).join(":")), bytes])) };
}
function metadataIdentity(repoRoot: string): { identity: Identity; hash: string; headOid: string } {
  const dotGit = path.join(repoRoot, ".git");
  const stats = fs.lstatSync(dotGit, { bigint: true });
  if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile()) || (stats.isFile() && stats.nlink !== 1n)) throw new Error("Review Git metadata identity is unsafe");
  const identity = statIdentity(stats);
  const descriptor = stats.isFile() ? fs.readFileSync(dotGit) : Buffer.from("directory", "utf8");
  const gitDirRaw = git(repoRoot, ["rev-parse", "--absolute-git-dir"]).toString("utf8").trim();
  if (!path.isAbsolute(gitDirRaw)) throw new Error("Review Git directory is invalid");
  assertRealDirectoryAncestry(gitDirRaw);
  const gitDir = fs.realpathSync(gitDirRaw);
  const gitDirIdentity = lstatIdentity(gitDir);
  const indexRaw = git(repoRoot, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).toString("utf8").trim();
  const headRaw = git(repoRoot, ["rev-parse", "--path-format=absolute", "--git-path", "HEAD"]).toString("utf8").trim();
  if (!path.isAbsolute(indexRaw) || !path.isAbsolute(headRaw)) throw new Error("Review Git metadata path is invalid");
  const index = bindAbsoluteMetadataFile(indexRaw, 64_000_000n);
  const head = bindAbsoluteMetadataFile(headRaw, 1_000_000n);
  const headOid = git(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"]).toString("utf8").trim();
  if (!OID_PATTERN.test(headOid)) throw new Error("Review HEAD identity is invalid");
  const hash = hashBytes(canonicalReviewJson({ dot_git: [...identityValue(identity), hashBytes(descriptor)], git_dir: identityValue(gitDirIdentity), index: [...identityValue(index.identity), index.hash], head: [...identityValue(head.identity), head.hash], head_oid: headOid }));
  return { identity, hash, headOid };
}
function collectGitDiff(repoRootInput: string, hooks: ReviewHooks = {}, verifyFinal = true): { entries: GitEntry[]; headOid: string; diffHash: string; gitMetadataHash: string; transactionHash: string; assert_stable: () => void } {
  const resolved = path.resolve(repoRootInput);
  assertRealDirectoryAncestry(resolved);
  const repoRoot = fs.realpathSync(resolved);
  const rootBefore = lstatIdentity(repoRoot);
  const metadataBefore = metadataIdentity(repoRoot);
  const top = git(repoRoot, ["rev-parse", "--show-toplevel"]).toString("utf8").trim();
  if (fs.realpathSync(top) !== repoRoot) throw new Error("Review must run at the bound repository root");
  const headOid = metadataBefore.headOid;
  const tracked = parseNameStatus(git(repoRoot, ["diff", "--name-status", "-z", "--find-renames", "HEAD", "--"]));
  const untracked = git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z", "--"]).toString("utf8").split("\0").filter(Boolean).map(normalizeRepoPath);
  const discovered = new Map<string, { code: string; path: string; oldPath: string | null }>();
  for (const item of tracked) discovered.set(item.path, item);
  for (const repoPath of untracked) if (!discovered.has(repoPath)) discovered.set(repoPath, { code: "?", path: repoPath, oldPath: null });
  if (discovered.size > REVIEW_LIMITS.max_changed_paths) throw new Error("Review changed path count exceeds the version-1 limit");
  const ordered = [...discovered.values()].sort((a, b) => compareText(a.path, b.path));
  const initialBindings = new Map(ordered.map((item) => [item.path, bindCandidatePath(repoRoot, item.path, item.code === "D")]));
  hooks.after_discovery?.();
  const entries: GitEntry[] = [];
  let totalBytes = 0;
  const hash = crypto.createHash("sha256");
  for (const item of ordered) {
    let diff: Buffer;
    let currentBytes: Buffer | undefined;
    const currentBinding = bindCandidatePath(repoRoot, item.path, item.code === "D", hooks.after_file_read);
    const initialBinding = initialBindings.get(item.path)!;
    if (currentBinding.state !== initialBinding.state || currentBinding.identity_hash !== initialBinding.identity_hash || currentBinding.content_hash !== initialBinding.content_hash) throw new Error("Review candidate path identity or bytes changed during collection");
    if (item.code === "?") {
      currentBytes = currentBinding.bytes;
      if (!currentBytes) throw new Error("Review untracked file backing disappeared");
      if (currentBytes.byteLength > REVIEW_LIMITS.max_file_diff_utf8_bytes) throw new Error("Review per-file diff input exceeds the version-1 limit");
      diff = Buffer.concat([Buffer.from(`untracked\0${item.path}\0`, "utf8"), currentBytes]);
    } else {
      if (item.code !== "D") currentBytes = currentBinding.bytes;
      diff = git(repoRoot, ["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--find-renames", "HEAD", "--", item.path], REVIEW_LIMITS.max_file_diff_utf8_bytes + 65_536);
      if (diff.byteLength === 0) throw new Error("Review Git diff disappeared during collection");
    }
    if (diff.byteLength > REVIEW_LIMITS.max_file_diff_utf8_bytes) throw new Error("Review per-file diff input exceeds the version-1 limit");
    totalBytes += diff.byteLength;
    if (totalBytes > REVIEW_LIMITS.max_total_diff_utf8_bytes) throw new Error("Review total diff input exceeds the version-1 limit");
    const parsed = parseUnifiedDiff(diff, item.code === "?" ? currentBytes : undefined);
    const status = item.code === "?" ? "untracked" : changedStatus(item.code);
    entries.push({ path: item.path, oldPath: item.oldPath, status, diff, ...parsed });
    hash.update(Buffer.from(`${item.path.length}:${item.path}:${status}:${item.oldPath ?? ""}:${diff.byteLength}:`, "utf8"));
    hash.update(diff);
  }
  const transactionHash = hashBytes(canonicalReviewJson({ root: identityValue(rootBefore), metadata: metadataBefore.hash, discovery: ordered, bindings: ordered.map((item) => [item.path, initialBindings.get(item.path)!.state, initialBindings.get(item.path)!.identity_hash, initialBindings.get(item.path)!.content_hash]), entries: entries.map((entry) => [entry.path, entry.oldPath, entry.status, hashBytes(entry.diff)]) }));
  const assertStable = (): void => {
    const final = collectGitDiff(repoRoot, {}, false);
    if (final.transactionHash !== transactionHash) throw new Error("Review repository, Git transaction, candidate identities, or diff changed during collection");
  };
  if (verifyFinal) assertStable();
  return { entries, headOid, diffHash: hash.digest("hex"), gitMetadataHash: metadataBefore.hash, transactionHash, assert_stable: assertStable };
}

function languageForPath(repoPath: string): string {
  const ext = path.posix.extname(repoPath).toLowerCase();
  return ({ ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".ts": "typescript", ".tsx": "typescript", ".py": "python", ".cs": "csharp", ".go": "go", ".rs": "rust", ".java": "java", ".sh": "bash", ".sql": "sql", ".vb": "vbnet", ".cpp": "cpp", ".cc": "cpp", ".c": "c" } as Record<string, string>)[ext] ?? "unknown";
}
function isCodePath(repoPath: string): boolean { return CODE_EXTENSIONS.has(path.posix.extname(repoPath).toLowerCase()); }
function pathWithin(repoPath: string, scope: string): boolean { return scope === "." || repoPath === scope || repoPath.startsWith(`${scope}/`); }
type SelectedProfile = { profile: ConventionProfile; tier: ProfileRef["selection_tier"]; authorityIds: Set<string>; conflicts: ConventionConflict[] };
function candidateEntityIds(entry: GitEntry, data: ContextData): Set<string> {
  const paths = new Set([entry.path, ...(entry.oldPath ? [entry.oldPath] : [])]);
  const documents = data.documents.filter((item) => paths.has(item.path));
  for (const repoPath of paths) {
    const matches = documents.filter((item) => item.path === repoPath);
    if (matches.length > 1) throw new Error("Review changed path is ambiguously indexed");
    if (matches[0] && (matches[0].id !== `file:${repoPath}` || matches[0].kind !== "CODE" || matches[0].status !== "active")) throw new Error("Review changed path has stale indexed identity");
  }
  const ids = new Set(documents.map((item) => item.id));
  for (const chunk of data.chunks) if (ids.has(chunk.file_id)) ids.add(chunk.id);
  return ids;
}
function profileEntityIds(profile: ConventionProfile, data: ContextData): Set<string> {
  const ids = new Set<string>([profile.subsystem.id, ...profile.file_ids]);
  for (const chunk of data.chunks) if (profile.file_ids.includes(chunk.file_id)) ids.add(chunk.id);
  return ids;
}
const FEATURE_RELATIONS = new Set(["CALLS", "IMPORTS", "REFERENCES_PROJECT", "USES_CONFIG", "USES_RESOURCE", "USES_SETTING", "USES_CONFIG_KEY", "USES_RESOURCE_KEY", "USES_SETTING_KEY"]);
function exactGraphConnection(candidateIds: Set<string>, profile: ConventionProfile, data: ContextData): boolean {
  const profileIds = profileEntityIds(profile, data);
  return data.relations.some((relation) => FEATURE_RELATIONS.has(relation.relation) && ((candidateIds.has(relation.from) && profileIds.has(relation.to)) || (candidateIds.has(relation.to) && profileIds.has(relation.from))));
}
function applicableAuthorityIds(entry: GitEntry, profile: ConventionProfile, data: ContextData, candidateIds: Set<string>): Set<string> {
  const scopeIds = new Set([...candidateIds, profile.subsystem.id]);
  const active = new Set([
    ...data.rules.filter((item) => item.status === "active" && item.source_of_truth).map((item) => item.id),
    ...data.adrs.filter((item) => item.status === "active" && item.source_of_truth).map((item) => item.id),
  ]);
  return new Set(profile.authoritative_evidence.filter((authority) => active.has(authority.entity_id) && (authority.scope === "repository" || authority.evidence.some((evidence) => evidence.relation && scopeIds.has(evidence.relation.type === "CONSTRAINS" ? evidence.relation.to : evidence.relation.from)))).map((authority) => authority.entity_id));
}
function applicableConflicts(profile: ConventionProfile, authorityIds: Set<string>): ConventionConflict[] {
  return profile.conflicts.flatMap((conflict) => {
    const claims = conflict.claims.filter((claim) => authorityIds.has(claim.source_id));
    return new Set(claims.map((claim) => claim.value)).size > 1 ? [{ ...conflict, claims }] : [];
  });
}
function selectProfiles(entry: GitEntry, profiles: ConventionProfile[], data: ContextData): SelectedProfile[] {
  const language = languageForPath(entry.path);
  const candidates = profiles.filter((profile) => profile.language === language || (language === "unknown" && profile.language === "unknown"));
  const ids = candidateEntityIds(entry, data);
  const sameFile = candidates.filter((profile) => profile.file_ids.some((id) => ids.has(id)));
  let selected = sameFile;
  let localityTier: ProfileRef["selection_tier"] = "same_file";
  if (selected.length === 0) {
    const directory = candidates.filter((profile) => profile.subsystem.path !== "." && pathWithin(entry.path, profile.subsystem.path));
    const maxDepth = Math.max(0, ...directory.map((profile) => profile.subsystem.path.split("/").length));
    selected = directory.filter((profile) => profile.subsystem.path.split("/").length === maxDepth);
    localityTier = "directory_module";
  }
  if (selected.length === 0) { selected = candidates.filter((profile) => exactGraphConnection(ids, profile, data)); localityTier = "feature_graph"; }
  if (selected.length === 0) { selected = candidates.filter((profile) => profile.subsystem.path === "."); localityTier = "repository_fallback"; }
  return selected.sort((a, b) => compareText(a.profile_id, b.profile_id)).map((profile) => {
    const authorityIds = applicableAuthorityIds(entry, profile, data, ids);
    return { profile, tier: authorityIds.size > 0 ? "active_authority" : localityTier, authorityIds, conflicts: applicableConflicts(profile, authorityIds) };
  });
}
function evidenceCompare(left: Evidence, right: Evidence): number {
  return compareText(left.entity_id, right.entity_id) || compareText(left.path ?? "", right.path ?? "") || (left.start_line ?? 0) - (right.start_line ?? 0) || compareText(canonicalKey(left.relation), canonicalKey(right.relation));
}
function retainEvidence(values: Evidence[]): Counted<Evidence> {
  const canonical = [...new Map(values.sort(evidenceCompare).map((item) => [canonicalKey(item), item])).values()];
  return { observed_count: canonical.length, omitted_count: Math.max(0, canonical.length - REVIEW_LIMITS.max_evidence_per_finding_or_conflict), items: canonical.slice(0, REVIEW_LIMITS.max_evidence_per_finding_or_conflict) };
}
function profileEvidence(profile: ConventionProfile, preferredIds: Set<string>, excludedPaths: Set<string>, symbolId?: string): Evidence[] {
  const all = [
    ...profile.authoritative_evidence.flatMap((item) => item.evidence),
    ...profile.structural_facts.flatMap((item) => item.evidence),
    ...profile.reusable_symbols.flatMap((item) => [...item.evidence, ...item.representative_callers, ...item.representative_tests]),
  ];
  return all.filter((item) => item.path === undefined || !excludedPaths.has(item.path)).sort((a, b) => {
    const ap = a.entity_id === symbolId ? 0 : preferredIds.has(a.entity_id) ? 1 : 2;
    const bp = b.entity_id === symbolId ? 0 : preferredIds.has(b.entity_id) ? 1 : 2;
    return ap - bp || evidenceCompare(a, b);
  });
}
function findingId(value: Omit<Finding, "id">): string { return `review:${hashBytes(canonicalReviewJson(value)).slice(0, 32)}`; }
function makeFinding(value: Omit<Finding, "id">): Finding { return { id: findingId(value), ...value }; }
function firstLine(entry: GitEntry, predicate: (line: string) => boolean): number | null { return entry.added.find((item) => predicate(item.text))?.line ?? null; }
function heuristicFindings(entry: GitEntry, profile: ConventionProfile, preferredIds: Set<string>, excludedPaths: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const addedText = entry.added.map((item) => item.text).join("\n");
  const declarations = entry.added.flatMap((item) => [...item.text.matchAll(/\b(?:function|class|def|func|interface|const)\s+([\p{L}_$][\p{L}\p{N}_$]*)/gu)].map((match) => ({ name: match[1], line: item.line })));
  for (const declaration of declarations) {
    const symbol = profile.reusable_symbols.find((item) => !excludedPaths.has(item.path) && item.name.normalize("NFKC").toLowerCase() === declaration.name.normalize("NFKC").toLowerCase());
    if (!symbol) continue;
    const evidence = retainEvidence(profileEvidence(profile, preferredIds, excludedPaths, symbol.entity_id));
    if (evidence.items.length === 0) continue;
    const base = {
      path: entry.path, location: { start_line: declaration.line, end_line: declaration.line }, category: "duplicate_helper" as const,
      enforcement: "heuristic" as const, confidence: 90,
      message: "A newly declared helper matches an accepted reusable symbol.",
      reason: "Exact normalized helper-name equality is strong local evidence, but applicability remains a heuristic judgment.",
      profile: { profile_id: profile.profile_id, profile_hash: profile.profile_hash }, evidence,
    };
    findings.push(makeFinding(base));
  }
  const roleSignals: Array<{ role: string; category: Finding["category"]; pattern: RegExp; message: string }> = [
    { role: "logging", category: "logging_convention", pattern: /\bconsole\.(?:log|warn|error)\s*\(/u, message: "New logging code may bypass an accepted shared logging abstraction." },
    { role: "error_type", category: "error_convention", pattern: /\b(?:throw\s+new\s+Error|raise\s+(?:Exception|Error))\b/u, message: "New error construction may bypass an accepted repository error abstraction." },
    { role: "test_helper", category: "testing_convention", pattern: /\b(?:fixture|mock|stub|testHelper|test_helper)\b/u, message: "New test support code may duplicate an accepted test helper." },
    { role: "configuration", category: "shared_abstraction_bypass", pattern: /\b(?:process\.env|os\.environ|dotenv|config)\b/u, message: "New configuration access may bypass an accepted shared abstraction." },
  ];
  for (const signal of roleSignals) {
    const line = firstLine(entry, (value) => signal.pattern.test(value));
    const symbol = profile.reusable_symbols.find((item) => !excludedPaths.has(item.path) && item.role === signal.role && !new RegExp(`\\b${item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "u").test(addedText));
    if (line === null || !symbol) continue;
    const evidence = retainEvidence(profileEvidence(profile, preferredIds, excludedPaths, symbol.entity_id));
    if (evidence.items.length === 0) continue;
    const base = {
      path: entry.path, location: { start_line: line, end_line: line }, category: signal.category,
      enforcement: "heuristic" as const, confidence: 75, message: signal.message,
      reason: "The changed line matches a local concern and the closest profile exposes a role-compatible reusable symbol; direct applicability is not policy authority.",
      profile: { profile_id: profile.profile_id, profile_hash: profile.profile_hash }, evidence,
    };
    findings.push(makeFinding(base));
  }
  return findings;
}
function authorityBodies(data: ContextData): Map<string, string> {
  return new Map([
    ...data.rules.filter((item) => item.status === "active" && item.source_of_truth).map((item) => [item.id, item.body] as const),
    ...data.adrs.filter((item) => item.status === "active" && item.source_of_truth).map((item) => [item.id, item.body] as const),
  ]);
}
function deterministicFindings(entry: GitEntry, profile: ConventionProfile, authorityIds: Set<string>, applicableProfileConflicts: ConventionConflict[], preferredIds: Set<string>, excludedPaths: Set<string>, bodies: Map<string, string>): Finding[] {
  const findings: Finding[] = [];
  const conflicts = new Set(applicableProfileConflicts.map((item) => item.key));
  for (const authority of profile.authoritative_evidence) {
    if (!authorityIds.has(authority.entity_id)) continue;
    const body = bodies.get(authority.entity_id) ?? "";
    const pattern = /^\s*convention:(review\.forbid\.(duplicate_helper|shared_abstraction_bypass|error_convention|logging_convention|testing_convention))\s*=\s*literal:(.{1,200})\s*$/gimu;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const [key, category, literal] = [match[1].toLowerCase(), match[2].toLowerCase(), match[3]];
      if (conflicts.has(key) || !FINDING_CATEGORIES.has(category) || !isSafeVisible(literal)) continue;
      const line = firstLine(entry, (value) => value.includes(literal));
      if (line === null) continue;
      const base = {
        path: entry.path, location: { start_line: line, end_line: line }, category: category as Finding["category"],
        enforcement: "deterministic" as const, confidence: 100,
        message: "Changed code contains a literal forbidden by exact active source-of-truth review evidence.",
        reason: `Exact active authority ${authority.entity_id} establishes ${key}; no conflicting active claim applies.`,
        profile: { profile_id: profile.profile_id, profile_hash: profile.profile_hash }, evidence: retainEvidence([...authority.evidence, ...profileEvidence(profile, preferredIds, excludedPaths)]),
      };
      findings.push(makeFinding(base));
    }
  }
  return findings;
}
function conflictRecords(repoPath: string, profile: ConventionProfile, conflicts: ConventionConflict[]): ReviewConflict[] {
  return conflicts.map((conflict: ConventionConflict) => {
    const claims = conflict.claims.map((claim) => ({ source_id: claim.source_id, source_type: claim.source_type, priority: claim.priority, value_hash: hashBytes(claim.value), evidence: [claim.evidence].sort(evidenceCompare) }))
      .sort((left, right) => right.priority - left.priority || compareText(left.value_hash, right.value_hash) || compareText(left.source_type, right.source_type) || compareText(left.source_id, right.source_id));
    const retained = claims.slice(0, REVIEW_LIMITS.max_evidence_per_finding_or_conflict);
    const withoutId = {
      path: repoPath, key: conflict.key,
      message: "Conflicting active convention evidence suppresses deterministic review recommendations for this key.",
      profile: { profile_id: profile.profile_id, profile_hash: profile.profile_hash },
      claims: { observed_count: claims.length, omitted_count: claims.length - retained.length, items: retained },
    };
    return { id: `review-conflict:${hashBytes(canonicalReviewJson(withoutId)).slice(0, 32)}`, ...withoutId };
  });
}
function counted<T>(items: T[], cap: number): Counted<T> { return { observed_count: items.length, omitted_count: Math.max(0, items.length - cap), items: items.slice(0, cap) }; }
function readRepositoryId(repoRoot: string): string {
  const config = path.join(repoRoot, ".context", "config.yaml");
  try {
    const stats = fs.lstatSync(config, { bigint: true });
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n || stats.size > 1_000_000n) return "repository";
    const text = fs.readFileSync(config, "utf8");
    const match = /^repo_id:\s*([A-Za-z0-9._-]{1,100})\s*$/mu.exec(text);
    return match?.[1] ?? "repository";
  } catch { return "repository"; }
}
function profileFingerprint(profiles: ConventionProfile[]): string { return hashBytes(canonicalReviewJson(profiles.map((item) => [item.profile_id, item.source_hash, item.profile_hash] as [string, string, string]).sort((a, b) => compareText(a[0], b[0])))); }
function contextFingerprint(data: ContextData): string { return hashBytes(canonicalReviewJson(data)); }

type CanonicalParserModules = {
  loadParsers: () => Promise<void>;
  parseFileContent: (extension: string, content: string, filePath: string) => Promise<{ language: string; result: { chunks: Array<{ name: string; kind: string; signature: string; body: string; description?: string; startLine: number; endLine: number; language: string; exported?: boolean; async?: boolean }> } } | null>;
  chunkIdFor: (filePath: string, chunk: { name: string; startLine: number; endLine: number }) => string;
  generateChunkDescription: (chunk: { kind: string; signature: string; body: string; description?: string; exported?: boolean; async?: boolean }) => string;
  maxBodyChars: number;
};
let canonicalParserModulesPromise: Promise<CanonicalParserModules> | null = null;
function loadCanonicalParserModules(): Promise<CanonicalParserModules> {
  if (canonicalParserModulesPromise) return canonicalParserModulesPromise;
  canonicalParserModulesPromise = (async () => {
    const scriptsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/lib/ingest");
    const registryUrl = pathToFileURL(path.join(scriptsRoot, "parser-registry.mjs")).href;
    const chunksUrl = pathToFileURL(path.join(scriptsRoot, "chunks.mjs")).href;
    const constantsUrl = pathToFileURL(path.join(scriptsRoot, "constants.mjs")).href;
    const registry = await import(registryUrl) as Pick<CanonicalParserModules, "loadParsers" | "parseFileContent">;
    const chunks = await import(chunksUrl) as Pick<CanonicalParserModules, "chunkIdFor" | "generateChunkDescription">;
    const constants = await import(constantsUrl) as { MAX_BODY_CHARS: number };
    if (typeof registry.loadParsers !== "function" || typeof registry.parseFileContent !== "function" || typeof chunks.chunkIdFor !== "function" || typeof chunks.generateChunkDescription !== "function" || !Number.isSafeInteger(constants.MAX_BODY_CHARS) || constants.MAX_BODY_CHARS < 1) throw new Error("Review canonical parser runtime is unavailable");
    await registry.loadParsers();
    return { ...registry, ...chunks, maxBodyChars: constants.MAX_BODY_CHARS };
  })();
  return canonicalParserModulesPromise;
}

function uniqueContextEntity<T extends { id: string }>(items: T[], id: string, label: string): T {
  const matches = items.filter((item) => item.id === id);
  if (matches.length !== 1) throw new Error(`Review ${label} identity is not uniquely backed`);
  return matches[0];
}

function backedDocumentBytes(documentId: string, data: ContextData, repoRoot: string, changedPaths: Set<string>): { document: ContextData["documents"][number]; bytes: Buffer } {
  const document = uniqueContextEntity(data.documents, documentId, "document");
  const canonical = normalizeRepoPath(document.path);
  if (document.status !== "active" || document.kind !== "CODE" || document.id !== `file:${canonical}`) throw new Error("Review evidence document is stale or substituted");
  const matches = (bytes: Buffer): boolean => bytes.toString("utf8") === document.content && Buffer.byteLength(document.content, "utf8") === bytes.byteLength;
  try { const bytes = stableExistingFile(repoRoot, canonical); if (matches(bytes)) return { document, bytes }; } catch { /* changed/deleted paths may use committed backing */ }
  if (changedPaths.has(canonical)) {
    try { const bytes = git(repoRoot, ["show", `HEAD:${canonical}`], 16_000_000); if (matches(bytes)) return { document, bytes }; } catch { /* fail below */ }
  }
  throw new Error("Review evidence backing bytes are stale");
}

async function validateSelectedChunkSemantics(profiles: ConventionProfile[], data: ContextData, repoRoot: string, changedPaths: Set<string>): Promise<void> {
  const fileIds = [...new Set(profiles.flatMap((profile) => profile.file_ids))].sort(compareText);
  const selectedChunks = data.chunks.filter((chunk) => fileIds.includes(chunk.file_id) && chunk.status === "active" && !chunk.id.includes(":window:"));
  if (selectedChunks.length === 0) return;
  const parser = await loadCanonicalParserModules();
  const reconstructed = new Map<string, { name: string; kind: string; signature: string; body: string; description: string; start_line: number; end_line: number; language: string; exported: boolean }>();
  for (const fileId of fileIds) {
    const chunks = selectedChunks.filter((chunk) => chunk.file_id === fileId);
    if (chunks.length === 0) continue;
    const { document, bytes } = backedDocumentBytes(fileId, data, repoRoot, changedPaths);
    const extension = path.posix.extname(document.path).toLowerCase();
    const parsed = await parser.parseFileContent(extension, bytes.toString("utf8"), document.path);
    if (!parsed || !parsed.result || !Array.isArray(parsed.result.chunks)) throw new Error("Review selected chunk has no canonical parser backing");
    for (const chunk of parsed.result.chunks) {
      const id = parser.chunkIdFor(document.path, chunk);
      if (reconstructed.has(id)) throw new Error("Review canonical parser produced duplicate chunk identity");
      reconstructed.set(id, { name: chunk.name, kind: chunk.kind, signature: chunk.signature, body: chunk.body.slice(0, parser.maxBodyChars), description: parser.generateChunkDescription(chunk), start_line: chunk.startLine, end_line: chunk.endLine, language: chunk.language, exported: Boolean(chunk.exported) });
    }
  }
  for (const chunk of selectedChunks) {
    const expected = reconstructed.get(chunk.id);
    const actual = { name: chunk.name, kind: chunk.kind, signature: chunk.signature, body: chunk.body, description: chunk.description, start_line: chunk.start_line, end_line: chunk.end_line, language: chunk.language, exported: chunk.exported };
    if (!expected || canonicalKey(actual) !== canonicalKey(expected)) throw new Error("Review selected chunk semantic backing is stale or fabricated");
  }
}

function validateEvidenceBacking(evidence: Evidence, data: ContextData, repoRoot: string, changedPaths = new Set<string>()): void {
  const unique = <T extends { id: string }>(items: T[], id: string): T => {
    const matches = items.filter((item) => item.id === id);
    if (matches.length !== 1) throw new Error("Review evidence identity is not uniquely backed");
    return matches[0];
  };
  const validateDocument = (id: string, expectedPath?: string): void => {
    const document = unique(data.documents, id);
    const canonical = normalizeRepoPath(document.path);
    if (document.status !== "active" || document.kind !== "CODE" || document.id !== `file:${canonical}` || (expectedPath !== undefined && canonical !== expectedPath)) throw new Error("Review evidence document is stale or substituted");
    backedDocumentBytes(id, data, repoRoot, changedPaths);
  };
  if (evidence.entity_id.startsWith("file:")) validateDocument(evidence.entity_id, evidence.path);
  else if (evidence.entity_id.startsWith("chunk:")) {
    const chunk = unique(data.chunks, evidence.entity_id);
    const document = unique(data.documents, chunk.file_id);
    const documentPath = normalizeRepoPath(document.path);
    const expectedId = `chunk:${documentPath}:${chunk.name}:${chunk.start_line}-${chunk.end_line}`;
    if (chunk.status !== "active" || chunk.id !== expectedId || chunk.file_id !== `file:${documentPath}` || chunk.id.includes(":window:") || (evidence.start_line !== undefined && chunk.start_line !== evidence.start_line) || (evidence.end_line !== undefined && chunk.end_line !== evidence.end_line)) throw new Error("Review evidence chunk is stale or substituted");
    validateDocument(chunk.file_id, evidence.path);
  } else if (/^rule[.:]/u.test(evidence.entity_id)) {
    const rule = unique(data.rules, evidence.entity_id); if (rule.status !== "active" || !rule.source_of_truth || evidence.path !== undefined) throw new Error("Review evidence rule is not eligible authority");
  } else if (/^adr[.:]/u.test(evidence.entity_id)) {
    const adr = unique(data.adrs, evidence.entity_id); if (adr.status !== "active" || !adr.source_of_truth || evidence.path !== adr.path) throw new Error("Review evidence ADR is not eligible authority"); const bytes = stableExistingFile(repoRoot, normalizeRepoPath(adr.path)); if (bytes.toString("utf8") !== adr.body) throw new Error("Review evidence ADR backing bytes are stale");
  } else throw new Error("Review evidence entity type is unsupported");
  if (evidence.relation) {
    const matches = data.relations.filter((item) => item.from === evidence.relation!.from && item.to === evidence.relation!.to && item.relation === evidence.relation!.type);
    if (matches.length !== 1 || (evidence.entity_id !== evidence.relation.from && evidence.entity_id !== evidence.relation.to)) throw new Error("Review evidence graph relation is stale or substituted");
  }
}
async function validateSelectedProfiles(profiles: ConventionProfile[], data: ContextData, repoRoot: string, repositoryId: string, changedPaths: Set<string>): Promise<void> {
  validateConventionProfilesAgainstContext(profiles, data, { repository_id: repositoryId, repo_root: repoRoot });
  const unique = <T extends { id: string }>(items: T[], id: string, label: string): T => {
    const matches = items.filter((item) => item.id === id); if (matches.length !== 1) throw new Error(`Review ${label} identity is not uniquely backed`); return matches[0];
  };
  const validateDirectory = (repoPath: string): void => {
    const canonical = repoPath === "." ? "." : normalizeRepoPath(repoPath); const target = canonical === "." ? repoRoot : path.join(repoRoot, ...canonical.split("/"));
    assertRealDirectoryAncestry(target);
  };
  for (const profile of profiles) {
    validateConventionProfile(profile);
    for (const fileId of profile.file_ids) validateEvidenceBacking({ entity_id: fileId, path: fileId.slice("file:".length) }, data, repoRoot, changedPaths);
    if (profile.subsystem.type === "module") { const item = unique(data.modules, profile.subsystem.id, "module"); if (item.status !== "active" || item.path !== profile.subsystem.path || item.id !== `module:${item.path}`) throw new Error("Review module backing is stale"); validateDirectory(item.path); }
    else if (profile.subsystem.type === "project") { const item = unique(data.projects, profile.subsystem.id, "project"); if (item.status !== "active" || item.path !== profile.subsystem.path || item.id !== `project:${item.path}`) throw new Error("Review project backing is stale"); validateDirectory(item.path); }
    else { if (profile.subsystem.id !== `path:${profile.subsystem.path}`) throw new Error("Review path subsystem backing is stale"); validateDirectory(profile.subsystem.path); }
    const evidence = [
      ...profile.authoritative_evidence.flatMap((item) => item.evidence),
      ...profile.structural_facts.flatMap((item) => item.evidence),
      ...profile.reusable_symbols.flatMap((item) => [...item.evidence, ...item.representative_callers, ...item.representative_tests]),
      ...profile.related_subsystems.flatMap((item) => item.evidence),
      ...profile.conflicts.flatMap((item) => item.claims.map((claim) => claim.evidence)),
    ];
    for (const item of evidence) validateEvidenceBacking(item, data, repoRoot, changedPaths);
  }
  await validateSelectedChunkSemantics(profiles, data, repoRoot, changedPaths);
}

export async function runDiffReview(parsed: ReviewParams, options: ReviewOptions = {}): Promise<ReviewData> {
  if (!parsed || parsed.diff !== true || Object.keys(parsed).length !== 1) throw new Error("Review requires exactly --diff");
  const repoRoot = options.repo_root ?? REPO_ROOT;
  const collected = collectGitDiff(repoRoot, options.hooks);
  options.hooks?.before_context?.();
  const data = options.data ?? await loadContextData();
  const repositoryId = options.repository_id ?? readRepositoryId(repoRoot);
  const profiles = buildConventionProfiles(data, { repository_id: repositoryId, repo_root: repoRoot });
  profiles.forEach(validateConventionProfile);
  validateConventionProfilesAgainstContext(profiles, data, { repository_id: repositoryId, repo_root: repoRoot });
  const beforeProfiles = profileFingerprint(profiles);
  const beforeContext = contextFingerprint(data);
  const changedFiles: ChangedFile[] = [];
  const findings: Finding[] = [];
  const conflicts: ReviewConflict[] = [];
  let eligible = 0; let reviewed = 0; let noProfile = 0;
  const bodies = authorityBodies(data);
  const excludedEvidencePaths = new Set(collected.entries.flatMap((item) => [item.path, ...(item.oldPath ? [item.oldPath] : [])]));
  const selections = new Map(collected.entries.filter((entry) => isCodePath(entry.path)).map((entry) => [entry.path, selectProfiles(entry, profiles, data)]));
  const selectedProfiles = [...new Map([...selections.values()].flat().map((item) => [item.profile.profile_id, item.profile])).values()];
  await validateSelectedProfiles(selectedProfiles, data, repoRoot, repositoryId, excludedEvidencePaths);
  for (const entry of collected.entries) {
    const selected = selections.get(entry.path) ?? [];
    if (isCodePath(entry.path)) eligible += 1;
    if (isCodePath(entry.path) && selected.length === 0) noProfile += 1;
    if (selected.length > 0) reviewed += 1;
    const refs = selected.map(({ profile, tier }): ProfileRef => ({ profile_id: profile.profile_id, profile_hash: profile.profile_hash, language: profile.language, subsystem_id: profile.subsystem.id, subsystem_path: profile.subsystem.path, selection_tier: tier })).sort((a, b) => compareText(a.profile_id, b.profile_id));
    changedFiles.push({ path: entry.path, old_path: entry.oldPath, status: entry.status, binary: entry.binary, diff_utf8_bytes: entry.diff.byteLength, added_lines: entry.addedCount, deleted_lines: entry.deletedCount, profiles: refs });
    if (entry.binary || entry.status === "deleted" || selected.length === 0) continue;
    let preferredIds = new Set<string>();
    try {
      const pattern = await runLocalPatternEvidence({ target: entry.path, top_k: 10, include_deprecated: false }, { data });
      const tiers = Array.isArray(pattern.tiers) ? pattern.tiers : [];
      preferredIds = new Set(tiers.flatMap((tier) => tier && typeof tier === "object" && Array.isArray((tier as Record<string, unknown>).evidence) ? ((tier as Record<string, unknown>).evidence as Array<Record<string, unknown>>).flatMap((item) => typeof item.id === "string" && item.id.length > 0 ? [item.id] : []) : []));
    } catch { /* unindexed new files still use closest validated profiles */ }
    for (const { profile, authorityIds, conflicts: applicableProfileConflicts } of selected) {
      findings.push(...deterministicFindings(entry, profile, authorityIds, applicableProfileConflicts, preferredIds, excludedEvidencePaths, bodies), ...heuristicFindings(entry, profile, preferredIds, excludedEvidencePaths));
      conflicts.push(...conflictRecords(entry.path, profile, applicableProfileConflicts));
    }
  }
  const canonicalFindings = [...new Map(findings.sort((a, b) => compareText(a.path, b.path) || a.location.start_line - b.location.start_line || compareText(a.enforcement, b.enforcement) || compareText(a.category, b.category) || compareText(a.id, b.id)).map((item) => [item.id, item])).values()];
  const canonicalConflicts = [...new Map(conflicts.sort((a, b) => compareText(a.path, b.path) || compareText(a.key, b.key) || compareText(a.id, b.id)).map((item) => [item.id, item])).values()];
  for (const finding of canonicalFindings) {
    if (finding.evidence.items.length === 0) throw new Error("Review finding lacks live-backed concrete evidence");
    finding.evidence.items.forEach((item) => validateEvidenceBacking(item, data, repoRoot));
  }
  for (const conflict of canonicalConflicts) for (const claim of conflict.claims.items) claim.evidence.forEach((item) => validateEvidenceBacking(item, data, repoRoot));
  options.hooks?.before_output?.();
  collected.assert_stable();
  if (contextFingerprint(data) !== beforeContext) throw new Error("Review context changed during review");
  const afterProfiles = buildConventionProfiles(data, { repository_id: repositoryId, repo_root: repoRoot });
  if (profileFingerprint(afterProfiles) !== beforeProfiles) throw new Error("Review convention profiles changed during review");
  await validateSelectedProfiles(selectedProfiles, data, repoRoot, repositoryId, excludedEvidencePaths);
  collected.assert_stable();
  if (contextFingerprint(data) !== beforeContext || profileFingerprint(buildConventionProfiles(data, { repository_id: repositoryId, repo_root: repoRoot })) !== beforeProfiles) throw new Error("Review context or convention profiles changed during final backing validation");
  const withoutHash: Omit<ReviewData, "review_hash"> = {
    schema_version: 1, generator_version: REVIEW_GENERATOR_VERSION,
    repository: { repository_id: repositoryId, head_oid: collected.headOid, git_metadata_hash: collected.gitMetadataHash }, diff_hash: collected.diffHash,
    changed_files: counted(changedFiles, REVIEW_LIMITS.max_changed_paths), findings: counted(canonicalFindings, REVIEW_LIMITS.max_findings), conflicts: counted(canonicalConflicts, REVIEW_LIMITS.max_conflicts),
    diagnostics: { eligible_code_files: eligible, reviewed_code_files: reviewed, no_applicable_profile: noProfile, binary_files: collected.entries.filter((item) => item.binary).length, deletions: collected.entries.filter((item) => item.status === "deleted").length, untracked_files: collected.entries.filter((item) => item.status === "untracked").length },
    limits: REVIEW_LIMITS, context_source: data.source,
  };
  const result: ReviewData = { ...withoutHash, review_hash: hashBytes(canonicalReviewJson(withoutHash)) };
  validateReviewData(result);
  serializeReviewPublicResponse(parsed, result);
  return result;
}

export async function validateReviewDataWithContext(value: unknown, options: ReviewOptions = {}): Promise<void> {
  validateReviewData(value);
  const expected = await runDiffReview({ diff: true }, options);
  if (canonicalReviewJson(value) !== canonicalReviewJson(expected)) throw new Error("Review data does not match canonical current Git and context state");
}

function validateCounted(value: unknown, cap: number, label: string): asserts value is Counted<unknown> {
  assertExactKeys(value, ["items", "observed_count", "omitted_count"], label);
  if (!Array.isArray(value.items) || value.items.length > cap) throw new Error(`${label}.items is invalid`);
  assertInteger(value.observed_count, `${label}.observed_count`); assertInteger(value.omitted_count, `${label}.omitted_count`);
  if (value.observed_count - value.items.length !== value.omitted_count || value.items.length !== Math.min(value.observed_count, cap)) throw new Error(`${label} count accounting is invalid`);
}
function validateEvidence(value: unknown, label: string): asserts value is Evidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !["entity_id", "path", "start_line", "end_line", "relation"].includes(key)) || !Object.hasOwn(row, "entity_id")) throw new Error(`${label} has unknown or missing schema keys`);
  assertString(row.entity_id, `${label}.entity_id`, 1000);
  if (row.path !== undefined) { assertString(row.path, `${label}.path`, 1024); normalizeRepoPath(row.path); }
  if ((row.start_line === undefined) !== (row.end_line === undefined)) throw new Error(`${label} line bounds are invalid`);
  if (row.start_line !== undefined) { assertInteger(row.start_line, `${label}.start_line`, 1); assertInteger(row.end_line, `${label}.end_line`, row.start_line); }
  if (row.relation !== undefined) { assertExactKeys(row.relation, ["from", "to", "type"], `${label}.relation`); assertString(row.relation.from, `${label}.relation.from`, 1000); assertString(row.relation.to, `${label}.relation.to`, 1000); assertEnum(row.relation.type, RELATION_TYPES, `${label}.relation.type`); }
}
function validateEvidenceCounted(value: unknown, label: string): void {
  validateCounted(value, REVIEW_LIMITS.max_evidence_per_finding_or_conflict, label);
  value.items.forEach((item, index) => validateEvidence(item, `${label}.items[${index}]`));
  const keys = (value.items as Evidence[]).map(canonicalKey);
  if (new Set(keys).size !== keys.length || [...(value.items as Evidence[])].sort(evidenceCompare).some((item, index) => canonicalKey(item) !== keys[index])) throw new Error(`${label} is not canonical`);
}
export function validateReviewData(value: unknown): asserts value is ReviewData {
  assertExactKeys(value, ["changed_files", "conflicts", "context_source", "diagnostics", "diff_hash", "findings", "generator_version", "limits", "repository", "review_hash", "schema_version"], "Review data");
  if (value.schema_version !== 1 || value.generator_version !== REVIEW_GENERATOR_VERSION || typeof value.review_hash !== "string" || !SHA256_PATTERN.test(value.review_hash) || typeof value.diff_hash !== "string" || !SHA256_PATTERN.test(value.diff_hash)) throw new Error("Review version or hashes are invalid");
  assertExactKeys(value.repository, ["git_metadata_hash", "head_oid", "repository_id"], "Review repository"); assertString(value.repository.repository_id, "Review repository ID", 100); if (!/^[A-Za-z0-9._-]{1,100}$/u.test(value.repository.repository_id) || typeof value.repository.head_oid !== "string" || !OID_PATTERN.test(value.repository.head_oid) || typeof value.repository.git_metadata_hash !== "string" || !SHA256_PATTERN.test(value.repository.git_metadata_hash)) throw new Error("Review repository identity is invalid");
  assertExactKeys(value.limits, Object.keys(REVIEW_LIMITS), "Review limits"); for (const [key, expected] of Object.entries(REVIEW_LIMITS)) if (value.limits[key] !== expected) throw new Error(`Review limit ${key} is invalid`);
  validateCounted(value.changed_files, REVIEW_LIMITS.max_changed_paths, "Review changed files");
  for (const [index, item] of value.changed_files.items.entries()) {
    const label = `Review changed files.items[${index}]`; assertExactKeys(item, ["added_lines", "binary", "deleted_lines", "diff_utf8_bytes", "old_path", "path", "profiles", "status"], label); assertString(item.path, `${label}.path`, 1024); normalizeRepoPath(item.path); if (item.old_path !== null) { assertString(item.old_path, `${label}.old_path`, 1024); normalizeRepoPath(item.old_path); }
    assertEnum(item.status, ["added", "modified", "deleted", "renamed", "type_changed", "untracked"] as const, `${label}.status`); if (typeof item.binary !== "boolean" || ((item.status === "renamed") !== (item.old_path !== null))) throw new Error(`${label} status is invalid`);
    assertInteger(item.diff_utf8_bytes, `${label}.diff_utf8_bytes`, 0, REVIEW_LIMITS.max_file_diff_utf8_bytes); assertInteger(item.added_lines, `${label}.added_lines`); assertInteger(item.deleted_lines, `${label}.deleted_lines`);
    if ((item.binary && (item.added_lines !== 0 || item.deleted_lines !== 0)) || (item.status === "deleted" && item.added_lines !== 0) || (item.status === "untracked" && item.deleted_lines !== 0)) throw new Error(`${label} line accounting is invalid`);
    if (!Array.isArray(item.profiles) || item.profiles.length > 256) throw new Error(`${label}.profiles is invalid`);
    for (const profile of item.profiles) { assertExactKeys(profile, ["language", "profile_hash", "profile_id", "selection_tier", "subsystem_id", "subsystem_path"], `${label}.profile`); if (typeof profile.profile_id !== "string" || !PROFILE_ID_PATTERN.test(profile.profile_id) || typeof profile.profile_hash !== "string" || !SHA256_PATTERN.test(profile.profile_hash)) throw new Error(`${label}.profile identity is invalid`); assertString(profile.language, `${label}.language`, 1000); assertString(profile.subsystem_id, `${label}.subsystem_id`, 1000); assertString(profile.subsystem_path, `${label}.subsystem_path`, 1024); if (profile.subsystem_path !== ".") normalizeRepoPath(profile.subsystem_path); if (!([`module:${profile.subsystem_path}`, `project:${profile.subsystem_path}`, `path:${profile.subsystem_path}`] as unknown[]).includes(profile.subsystem_id)) throw new Error(`${label}.profile subsystem identity is invalid`); assertEnum(profile.selection_tier, ["active_authority", "same_file", "directory_module", "feature_graph", "repository_fallback"] as const, `${label}.selection_tier`); }
    if (!isCodePath(item.path) && item.profiles.length > 0) throw new Error(`${label}.profiles cannot apply to a non-code path`);
    const profileIds = (item.profiles as ProfileRef[]).map((profile) => profile.profile_id);
    if (new Set(profileIds).size !== profileIds.length || [...profileIds].sort(compareText).some((id, profileIndex) => id !== profileIds[profileIndex])) throw new Error(`${label}.profiles are not canonical`);
  }
  const changed = value.changed_files.items as ChangedFile[]; if (new Set(changed.map((item) => item.path)).size !== changed.length || [...changed].sort((a, b) => compareText(a.path, b.path)).some((item, index) => item.path !== changed[index].path) || changed.reduce((sum, item) => sum + item.diff_utf8_bytes, 0) > REVIEW_LIMITS.max_total_diff_utf8_bytes) throw new Error("Review changed paths are not canonical");
  validateCounted(value.findings, REVIEW_LIMITS.max_findings, "Review findings");
  for (const [index, finding] of value.findings.items.entries()) {
    const label = `Review findings.items[${index}]`; assertExactKeys(finding, ["category", "confidence", "enforcement", "evidence", "id", "location", "message", "path", "profile", "reason"], label); if (typeof finding.id !== "string" || !/^review:[a-f0-9]{32}$/u.test(finding.id)) throw new Error(`${label}.id is invalid`); assertString(finding.path, `${label}.path`, 1024); normalizeRepoPath(finding.path); assertEnum(finding.category, ["duplicate_helper", "shared_abstraction_bypass", "error_convention", "logging_convention", "testing_convention"] as const, `${label}.category`); assertEnum(finding.enforcement, ["deterministic", "heuristic"] as const, `${label}.enforcement`); assertInteger(finding.confidence, `${label}.confidence`, 0, 100); if ((finding.enforcement === "deterministic") !== (finding.confidence === 100)) throw new Error(`${label} confidence is incoherent`); assertString(finding.message, `${label}.message`, 1000); assertString(finding.reason, `${label}.reason`, 2000); assertExactKeys(finding.location, ["end_line", "start_line"], `${label}.location`); assertInteger(finding.location.start_line, `${label}.start_line`, 1); assertInteger(finding.location.end_line, `${label}.end_line`, finding.location.start_line); assertExactKeys(finding.profile, ["profile_hash", "profile_id"], `${label}.profile`); if (typeof finding.profile.profile_id !== "string" || !PROFILE_ID_PATTERN.test(finding.profile.profile_id) || typeof finding.profile.profile_hash !== "string" || !SHA256_PATTERN.test(finding.profile.profile_hash)) throw new Error(`${label}.profile is invalid`); validateEvidenceCounted(finding.evidence, `${label}.evidence`);
    const copy = structuredClone(finding) as Finding; const id = copy.id; delete (copy as Partial<Finding>).id; if (id !== findingId(copy as Omit<Finding, "id">)) throw new Error(`${label}.id hash is invalid`);
    const typedFinding = finding as unknown as Finding;
    if (typedFinding.evidence.items.length === 0) throw new Error(`${label}.evidence is empty`);
    const owner = changed.find((item) => item.path === typedFinding.path);
    const profileRef = owner?.profiles.find((profile) => profile.profile_id === typedFinding.profile.profile_id && profile.profile_hash === typedFinding.profile.profile_hash);
    if (!owner || owner.binary || owner.status === "deleted" || !profileRef || (typedFinding.enforcement === "deterministic" && profileRef.selection_tier !== "active_authority") || typedFinding.evidence.items.some((item) => item.path !== undefined && changed.some((changedFile) => changedFile.path === item.path || changedFile.old_path === item.path))) throw new Error(`${label}.profile or evidence is not applicable to its changed path`);
  }
  const findingItems = value.findings.items as Finding[];
  if (new Set(findingItems.map((item) => item.id)).size !== findingItems.length || [...findingItems].sort((a, b) => compareText(a.path, b.path) || a.location.start_line - b.location.start_line || compareText(a.enforcement, b.enforcement) || compareText(a.category, b.category) || compareText(a.id, b.id)).some((item, index) => item.id !== findingItems[index].id)) throw new Error("Review findings are not canonical");
  validateCounted(value.conflicts, REVIEW_LIMITS.max_conflicts, "Review conflicts");
  for (const [index, conflict] of value.conflicts.items.entries()) {
    const label = `Review conflicts.items[${index}]`; assertExactKeys(conflict, ["claims", "id", "key", "message", "path", "profile"], label); if (typeof conflict.id !== "string" || !/^review-conflict:[a-f0-9]{32}$/u.test(conflict.id)) throw new Error(`${label}.id is invalid`); assertString(conflict.path, `${label}.path`, 1024); normalizeRepoPath(conflict.path); assertString(conflict.key, `${label}.key`, 100); if (!/^review\.forbid\.(?:duplicate_helper|shared_abstraction_bypass|error_convention|logging_convention|testing_convention)$/u.test(conflict.key)) throw new Error(`${label}.key is invalid`); assertString(conflict.message, `${label}.message`, 1000); assertExactKeys(conflict.profile, ["profile_hash", "profile_id"], `${label}.profile`); if (typeof conflict.profile.profile_id !== "string" || !PROFILE_ID_PATTERN.test(conflict.profile.profile_id) || typeof conflict.profile.profile_hash !== "string" || !SHA256_PATTERN.test(conflict.profile.profile_hash)) throw new Error(`${label}.profile is invalid`); validateCounted(conflict.claims, REVIEW_LIMITS.max_evidence_per_finding_or_conflict, `${label}.claims`); if (conflict.claims.observed_count < 2 || conflict.claims.items.length < 2) throw new Error(`${label}.claims is not a conflict`);
    for (const claim of conflict.claims.items) { assertExactKeys(claim, ["evidence", "priority", "source_id", "source_type", "value_hash"], `${label}.claim`); assertString(claim.source_id, `${label}.source_id`, 1000); assertEnum(claim.source_type, ["Rule", "ADR"] as const, `${label}.source_type`); if ((claim.source_type === "Rule" ? !/^rule[.:]/u.test(claim.source_id) : !/^adr[.:]/u.test(claim.source_id)) || typeof claim.value_hash !== "string" || !SHA256_PATTERN.test(claim.value_hash)) throw new Error(`${label}.claim is invalid`); assertInteger(claim.priority, `${label}.priority`, 0, 1000); if (!Array.isArray(claim.evidence) || claim.evidence.length !== 1) throw new Error(`${label}.evidence is invalid`); claim.evidence.forEach((item, evidenceIndex) => validateEvidence(item, `${label}.evidence[${evidenceIndex}]`)); if (claim.evidence[0].entity_id !== claim.source_id) throw new Error(`${label}.evidence source is incoherent`); }
    const claims = conflict.claims.items as ReviewConflict["claims"]["items"];
    const sortedClaims = [...claims].sort((left, right) => right.priority - left.priority || compareText(left.value_hash, right.value_hash) || compareText(left.source_type, right.source_type) || compareText(left.source_id, right.source_id));
    if (new Set(claims.map(canonicalKey)).size !== claims.length || new Set(claims.map((claim) => claim.source_id)).size !== claims.length || new Set(claims.map((claim) => claim.value_hash)).size < 2 || sortedClaims.some((claim, claimIndex) => canonicalKey(claim) !== canonicalKey(claims[claimIndex]))) throw new Error(`${label}.claims are not canonical`);
    const copy = structuredClone(conflict) as ReviewConflict; const id = copy.id; delete (copy as Partial<ReviewConflict>).id;
    if (id !== `review-conflict:${hashBytes(canonicalReviewJson(copy)).slice(0, 32)}`) throw new Error(`${label}.id hash is invalid`);
  }
  const conflictItems = value.conflicts.items as ReviewConflict[];
  if (new Set(conflictItems.map((item) => item.id)).size !== conflictItems.length || [...conflictItems].sort((a, b) => compareText(a.path, b.path) || compareText(a.key, b.key) || compareText(a.id, b.id)).some((item, index) => item.id !== conflictItems[index].id)) throw new Error("Review conflicts are not canonical");
  for (const conflict of conflictItems) {
    const owner = changed.find((item) => item.path === conflict.path); const profile = owner?.profiles.find((item) => item.profile_id === conflict.profile.profile_id && item.profile_hash === conflict.profile.profile_hash);
    if (!owner || !profile || profile.selection_tier !== "active_authority" || conflict.claims.items.some((claim) => claim.evidence.some((item) => item.path !== undefined && changed.some((changedFile) => changedFile.path === item.path || changedFile.old_path === item.path)))) throw new Error("Review conflict profile or evidence is not applicable");
    const suppressedCategory = /^review\.forbid\.(.+)$/u.exec(conflict.key)?.[1];
    if (suppressedCategory && findingItems.some((finding) => finding.path === conflict.path && finding.enforcement === "deterministic" && finding.category === suppressedCategory)) throw new Error("Review deterministic finding guesses through an active conflict");
  }
  assertExactKeys(value.diagnostics, ["binary_files", "deletions", "eligible_code_files", "no_applicable_profile", "reviewed_code_files", "untracked_files"], "Review diagnostics"); for (const [key, item] of Object.entries(value.diagnostics)) assertInteger(item, `Review diagnostics.${key}`);
  if (value.diagnostics.binary_files !== changed.filter((item) => item.binary).length || value.diagnostics.deletions !== changed.filter((item) => item.status === "deleted").length || value.diagnostics.untracked_files !== changed.filter((item) => item.status === "untracked").length || value.diagnostics.eligible_code_files !== changed.filter((item) => isCodePath(item.path)).length || value.diagnostics.reviewed_code_files !== changed.filter((item) => isCodePath(item.path) && item.profiles.length > 0).length || value.diagnostics.no_applicable_profile !== changed.filter((item) => isCodePath(item.path) && item.profiles.length === 0).length) throw new Error("Review diagnostics are incoherent");
  assertEnum(value.context_source, ["cache", "ryu"] as const, "Review context source");
  const copy = structuredClone(value) as Record<string, unknown>; delete copy.review_hash; if (hashBytes(canonicalReviewJson(copy)) !== value.review_hash) throw new Error("Review hash mismatch"); assertSafeVisible(value);
}

function serializeEnvelope(value: unknown, max: number): string {
  assertSafeVisible(value); const output = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(output, "utf8") > max) throw new Error("Review public response exceeds the version-1 byte limit");
  return output;
}
export function serializeReviewPublicResponse(input: ReviewParams, data: ReviewData): string { validateReviewData(data); return serializeEnvelope({ ok: true, command: "review", schema_version: 1, generator_version: REVIEW_GENERATOR_VERSION, input: { diff: input.diff }, context_source: data.context_source, data }, REVIEW_LIMITS.max_json_response_utf8_bytes); }
export function serializeReviewPublicError(error: unknown): string { return serializeEnvelope({ ok: false, command: "review", schema_version: 1, generator_version: REVIEW_GENERATOR_VERSION, input: { diff: true }, error: { code: "INVALID_ARGS", message: sanitizeReviewPublicError(error) } }, REVIEW_LIMITS.max_json_response_utf8_bytes); }
export function sanitizeReviewPublicError(error: unknown): string { const raw = error instanceof Error ? error.message : String(error); const allowed = new Set(["Review requires exactly --diff", "Review arguments contain an unknown or repeated flag", "Review changed path count exceeds the version-1 limit", "Review per-file diff input exceeds the version-1 limit", "Review total diff input exceeds the version-1 limit", "Review public response exceeds the version-1 byte limit"]); return allowed.has(raw) ? raw : "Review failed safely"; }
export function formatReviewPublicText(data: ReviewData): string {
  validateReviewData(data);
  const lines = [`review: schema=1 diff_hash=${data.diff_hash} review_hash=${data.review_hash}`, `changed=${data.changed_files.items.length}/${data.changed_files.observed_count} findings=${data.findings.items.length}/${data.findings.observed_count} conflicts=${data.conflicts.items.length}/${data.conflicts.observed_count}`];
  for (const finding of data.findings.items) lines.push(`${finding.enforcement} ${finding.category} ${finding.path}:${finding.location.start_line} ${finding.message}`);
  for (const conflict of data.conflicts.items) lines.push(`conflict ${conflict.key} ${conflict.path} claims=${conflict.claims.items.length}/${conflict.claims.observed_count}`);
  assertSafeVisible(lines); const output = `${lines.join("\n")}\n`; if (Buffer.byteLength(output, "utf8") > REVIEW_LIMITS.max_text_response_utf8_bytes) throw new Error("Review public response exceeds the version-1 byte limit"); return output;
}
