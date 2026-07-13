import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { walkProjectFiles } from "./walk.js";
import { resolveChangedReviewFiles } from "../reviews/changed-files.js";
import type { EnterpriseConfig } from "../../core/config.js";
import type { TelemetryCollector } from "../../core/telemetry/collector.js";
import type { AuditWriter } from "../../core/audit/writer.js";
import type { PolicyStore } from "../../core/policy/store.js";
import { enforceInjectionPolicy, buildViolationPayload } from "../../core/policy/enforce.js";
import type { InjectionMatch } from "../../core/policy/injection.js";
import { getLastPush } from "../telemetry/sync.js";
import { syncFromCloud, syncFromLocal, getLastSync } from "../policy/sync.js";
import { queueViolation } from "../violations/push.js";
import { getReviewPushContext, queueReviewResult } from "../reviews/push.js";
import { partitionReviewPolicies } from "../reviews/policy-selection.js";
import { recordQueuedReviewTrustState } from "../reviews/trust-state.js";
import { buildPatternReviewContext } from "../reviews/pattern-context.js";
import { pushWorkflowSnapshot } from "../workflow/push.js";
import { OUTBOUND_DATA_BOUNDARY } from "../privacy/boundary.js";
import {
  addWorkflowNote,
  addWorkflowTodo,
  approveWorkflow,
  completeWorkflowTodo,
  loadWorkflowState,
  recordWorkflowReview,
  recordWorkflowUpdate,
  reviewWorkflowPlan,
  setWorkflowPlan,
  startWorkflowImplementation,
  type WorkflowReviewedFileSnapshot,
} from "../workflow/state.js";
import { queryAuditLog } from "../../core/audit/query.js";
import { checkAccess, getAccessDeniedMessage, type Role } from "../../core/rbac/check.js";
import { runValidators } from "../../core/validators/engine.js";
import "../../core/validators/builtins.js";
import { recordToolActivity } from "../index.js";

type ToolPayload = Record<string, unknown>;

const VALID_ROLES = new Set<Role>(["admin", "developer", "readonly"]);

export function buildContextReviewAuditInput(input: {
  scope: "all" | "changed";
  include_passed: boolean;
  include_pattern_evidence: boolean;
  pattern_query?: string;
  pattern_top_k: number;
  pattern_limit: number;
}): Record<string, unknown> {
  return {
    scope: input.scope,
    include_passed: input.include_passed,
    include_pattern_evidence: input.include_pattern_evidence,
    pattern_query_present: Boolean(input.pattern_query),
    pattern_query_length: input.pattern_query?.length ?? 0,
    pattern_top_k: input.pattern_top_k,
    pattern_limit: input.pattern_limit,
  };
}

function snapshotReviewedFiles(
  projectRoot: string,
  changedFiles: string[] | undefined,
): WorkflowReviewedFileSnapshot[] | null {
  if (!changedFiles) return null;

  return [...new Set(changedFiles)]
    .sort()
    .map((file): WorkflowReviewedFileSnapshot => {
      const abs = join(projectRoot, file);
      try {
        const stat = statSync(abs);
        if (!stat.isFile()) {
          return { path: file, exists: false, hash: null };
        }
        const hash = createHash("sha256")
          .update(readFileSync(abs))
          .digest("hex");
        return { path: file, exists: true, hash };
      } catch {
        return { path: file, exists: false, hash: null };
      }
    });
}

function buildToolResult(data: ToolPayload) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
  };
}

function accessDenied(role: Role, action: string) {
  return buildToolResult({
    error: getAccessDeniedMessage(role, action),
    role,
    action,
  });
}

async function pushWorkflowStateIfConfigured(
  config: EnterpriseConfig,
  state: ReturnType<typeof loadWorkflowState>
): Promise<void> {
  const baseUrl = (config.enterprise.base_url || config.enterprise.endpoint).trim();
  const apiKey = config.enterprise.api_key.trim();
  if (!baseUrl || !apiKey) return;
  const result = await pushWorkflowSnapshot(baseUrl, apiKey, state);
  if (!result.success) {
    process.stderr.write(
      `[cortex-enterprise] Workflow snapshot push failed: ${result.error ?? "unknown error"}\n`
    );
  }
}

export function registerEnterpriseTools(
  server: McpServer,
  collector: TelemetryCollector,
  auditWriter: AuditWriter | null,
  config: EnterpriseConfig,
  contextDir: string,
  policyStore: PolicyStore,
  version: string,
): void {
  const roleCandidate = config.rbac.enabled ? config.rbac.default_role : "admin";
  const role: Role = VALID_ROLES.has(roleCandidate as Role)
    ? (roleCandidate as Role)
    : "readonly";
  if (!VALID_ROLES.has(roleCandidate as Role) && config.rbac.enabled) {
    process.stderr.write(`[cortex-enterprise] Invalid RBAC role '${roleCandidate}', falling back to 'readonly'\n`);
  }

  // ── telemetry.status ──
  server.registerTool(
    "telemetry.status",
    {
      description: "Return telemetry configuration and current aggregated metrics.",
      inputSchema: z.object({}),
    },
    async () => {
      if (config.rbac.enabled && !checkAccess(role, "telemetry.status")) {
        return accessDenied(role, "telemetry.status");
      }

      const metrics = collector.getMetrics();
      const lastPush = getLastPush();

      recordToolActivity({
        timestamp: new Date().toISOString(),
        tool: "telemetry.status",
        input: {},
        result_count: 1,
        entities_returned: [],
        rules_applied: [],
        duration_ms: 0,
        event_type: "tool_call",
        evidence_level: "diagnostic",
        resource_type: "telemetry",
      });

      return buildToolResult({
        enabled: config.telemetry.enabled,
        endpoint: config.telemetry.endpoint || null,
        interval_minutes: config.telemetry.interval_minutes,
        metrics,
        last_push: lastPush,
        boundary: OUTBOUND_DATA_BOUNDARY,
      });
    },
  );

  // ── audit.query ──
  server.registerTool(
    "audit.query",
    {
      description: "Search the enterprise audit log by date range, tool name, and limit.",
      inputSchema: z.object({
        from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
        to: z.string().optional().describe("End date (YYYY-MM-DD)"),
        tool: z.string().optional().describe("Filter by tool name"),
        event_type: z.string().optional().describe("Filter by audit event type"),
        evidence_level: z.string().optional().describe("Filter by evidence level"),
        status: z.enum(["success", "error"]).optional().describe("Filter by status"),
        session_id: z.string().optional().describe("Filter by session id"),
        limit: z.number().int().positive().max(500).default(50),
      }),
    },
    async (input) => {
      if (config.rbac.enabled && !checkAccess(role, "audit.query")) {
        return accessDenied(role, "audit.query");
      }

      const parsed = z.object({
        from: z.string().optional(),
        to: z.string().optional(),
        tool: z.string().optional(),
        event_type: z.string().optional(),
        evidence_level: z.string().optional(),
        status: z.enum(["success", "error"]).optional(),
        session_id: z.string().optional(),
        limit: z.number().int().positive().max(500).default(50),
      }).parse(input ?? {});

      const entries = queryAuditLog(contextDir, parsed);

      recordToolActivity({
        timestamp: new Date().toISOString(),
        tool: "audit.query",
        input: parsed as Record<string, unknown>,
        result_count: entries.length,
        entities_returned: [],
        rules_applied: [],
        duration_ms: 0,
        event_type: "tool_call",
        evidence_level: "diagnostic",
        resource_type: "audit",
      });

      return buildToolResult({
        count: entries.length,
        entries,
      });
    },
  );

  // ── policy.list ──
  server.registerTool(
    "policy.list",
    {
      description: "List all active policies (org + local merged). Org rules override local rules with same ID.",
      inputSchema: z.object({
        source: z.enum(["all", "org", "local"]).default("all").describe("Filter by policy source"),
      }),
    },
    async (input) => {
      if (config.rbac.enabled && !checkAccess(role, "policy.list")) {
        return accessDenied(role, "policy.list");
      }

      const parsed = z.object({
        source: z.enum(["all", "org", "local"]).default("all"),
      }).parse(input ?? {});

      let policies = policyStore.getMergedPolicies();

      if (parsed.source !== "all") {
        policies = policies.filter(p => p.source === parsed.source);
      }

      recordToolActivity({
        timestamp: new Date().toISOString(),
        tool: "policy.list",
        input: parsed as Record<string, unknown>,
        result_count: policies.length,
        entities_returned: policies.map(p => p.id),
        rules_applied: [],
        duration_ms: 0,
        event_type: "tool_call",
        evidence_level: "diagnostic",
        resource_type: "policy",
      });

      return buildToolResult({
        count: policies.length,
        policies: policies.map(p => ({
          id: p.id,
          description: p.description,
          priority: p.priority,
          scope: p.scope,
          enforce: p.enforce,
          source: p.source,
        })),
      });
    },
  );

  // ── policy.sync ──
  server.registerTool(
    "policy.sync",
    {
      description: "Trigger manual policy sync. Connected: pulls from cloud API. Air-gapped: reloads local org-rules.yaml.",
      inputSchema: z.object({}),
    },
    async () => {
      if (config.rbac.enabled && !checkAccess(role, "policy.sync")) {
        return accessDenied(role, "policy.sync");
      }

      let result;
      if (config.policy.endpoint && config.policy.api_key) {
        result = await syncFromCloud(config.policy.endpoint, config.policy.api_key, policyStore);
      } else {
        result = syncFromLocal(policyStore);
      }

      recordToolActivity({
        timestamp: new Date().toISOString(),
        tool: "policy.sync",
        input: {},
        result_count: result.synced,
        entities_returned: [],
        rules_applied: [],
        duration_ms: 0,
        event_type: "policy_sync",
        evidence_level: "required",
        resource_type: "policy",
        metadata: { synced: result.synced },
      });

      return buildToolResult(result as unknown as ToolPayload);
    },
  );

  // ── enterprise.status ──
  server.registerTool(
    "enterprise.status",
    {
      description: "Return Cortex Enterprise overview: version, feature status, and policy health.",
      inputSchema: z.object({}),
    },
    async () => {
      if (config.rbac.enabled && !checkAccess(role, "enterprise.status")) {
        return accessDenied(role, "enterprise.status");
      }

      const lastSyncResult = getLastSync();
      const policies = policyStore.getMergedPolicies();

      recordToolActivity({
        timestamp: new Date().toISOString(),
        tool: "enterprise.status",
        input: {},
        result_count: policies.length,
        entities_returned: [],
        rules_applied: [],
        duration_ms: 0,
        event_type: "tool_call",
        evidence_level: "diagnostic",
        resource_type: "policy",
      });

      return buildToolResult({
        edition: "enterprise",
        version,
        features: {
          telemetry: config.telemetry.enabled ? "active" : "disabled",
          policy_sync: config.policy.enabled ? "active" : "disabled",
          audit_log: config.audit.enabled ? "active" : "disabled",
          rbac: config.rbac.enabled ? `active (role: ${role})` : "disabled",
        },
        policies: {
          total: policies.length,
          org: policies.filter(p => p.source === "org").length,
          local: policies.filter(p => p.source === "local").length,
          last_sync: lastSyncResult,
        },
        workflow: loadWorkflowState(contextDir),
      });
    },
  );

  // ── workflow.status ──
  server.registerTool(
    "workflow.status",
    {
      description:
        "Return the governed workflow state persisted in .context/workflow/state.json.",
      inputSchema: z.object({}),
    },
    async () => {
      if (config.rbac.enabled && !checkAccess(role, "workflow.status")) {
        return accessDenied(role, "workflow.status");
      }

      const state = loadWorkflowState(contextDir);

      recordToolActivity({
        timestamp: new Date().toISOString(),
        tool: "workflow.status",
        input: {},
        result_count: 1,
        entities_returned: [],
        rules_applied: [],
        duration_ms: 0,
        event_type: "tool_call",
        evidence_level: "diagnostic",
        resource_type: "workflow",
        metadata: {
          phase: state.phase,
        },
      });

      return buildToolResult(state as unknown as ToolPayload);
    },
  );

  // ── workflow.plan ──
  server.registerTool(
    "workflow.plan",
    {
      description:
        "Create or update the implementation plan. Resets approval until the plan is reviewed again.",
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        summary: z.string().min(1).max(5000),
        tasks: z.array(z.string().min(1).max(500)).max(50).default([]),
      }),
    },
    async (input) => {
      if (config.rbac.enabled && !checkAccess(role, "workflow.plan")) {
        return accessDenied(role, "workflow.plan");
      }

      const parsed = z.object({
        title: z.string().min(1).max(200),
        summary: z.string().min(1).max(5000),
        tasks: z.array(z.string().min(1).max(500)).max(50).default([]),
      }).parse(input ?? {});

      const state = setWorkflowPlan(contextDir, parsed);
      await pushWorkflowStateIfConfigured(config, state);

      recordToolActivity({
        timestamp: new Date().toISOString(),
        tool: "workflow.plan",
        input: parsed as Record<string, unknown>,
        result_count: state.plan.tasks.length,
        entities_returned: [],
        rules_applied: [],
        duration_ms: 0,
        event_type: "workflow_transition",
        evidence_level: "required",
        resource_type: "workflow",
        metadata: {
          phase: state.phase,
          plan_status: state.plan.status,
        },
      });

      return buildToolResult(state as unknown as ToolPayload);
    },
  );

  // ── workflow.review_plan ──
  server.registerTool(
    "workflow.review_plan",
    {
      description:
        "Review and approve or reject the current plan before implementation starts.",
      inputSchema: z.object({
        approved: z.boolean(),
        notes: z.string().max(5000).optional(),
      }),
    },
    async (input) => {
      if (config.rbac.enabled && !checkAccess(role, "workflow.review_plan")) {
        return accessDenied(role, "workflow.review_plan");
      }

      const parsed = z.object({
        approved: z.boolean(),
        notes: z.string().max(5000).optional(),
      }).parse(input ?? {});

      const result = reviewWorkflowPlan(contextDir, parsed);
      if (!result.ok) {
        return buildToolResult({
          error: result.error,
          workflow: result.state,
        });
      }

      await pushWorkflowStateIfConfigured(config, result.state);

      recordToolActivity({
        timestamp: new Date().toISOString(),
        tool: "workflow.review_plan",
        input: parsed as Record<string, unknown>,
        result_count: 1,
        entities_returned: [],
        rules_applied: [],
        duration_ms: 0,
        event_type: "workflow_transition",
        evidence_level: "required",
        resource_type: "workflow",
        metadata: {
          approved: parsed.approved,
          phase: result.state.phase,
          plan_status: result.state.plan.status,
        },
      });

      return buildToolResult(result.state as unknown as ToolPayload);
    },
  );

  // ── workflow.start ──
  server.registerTool(
    "workflow.start",
    {
      description:
        "Mark the workflow as actively implementing after the plan has been approved.",
      inputSchema: z.object({}),
    },
    async () => {
      if (config.rbac.enabled && !checkAccess(role, "workflow.start")) {
        return accessDenied(role, "workflow.start");
      }

      const result = startWorkflowImplementation(contextDir);
      if (!result.ok) {
        return buildToolResult({
          error: result.error,
          workflow: result.state,
        });
      }

      await pushWorkflowStateIfConfigured(config, result.state);

      recordToolActivity({
        timestamp: new Date().toISOString(),
        tool: "workflow.start",
        input: {},
        result_count: 1,
        entities_returned: [],
        rules_applied: [],
        duration_ms: 0,
        event_type: "workflow_transition",
        evidence_level: "required",
        resource_type: "workflow",
        metadata: {
          phase: result.state.phase,
        },
      });

      return buildToolResult(result.state as unknown as ToolPayload);
    },
  );

  // ── workflow.update ──
  server.registerTool(
    "workflow.update",
    {
      description:
        "Record an implementation or iteration update without mutating the plan itself.",
      inputSchema: z.object({
        summary: z.string().min(1).max(5000),
        phase: z.enum(["implementation", "iterating", "plan_review"]).optional(),
      }),
    },
    async (input) => {
      if (config.rbac.enabled && !checkAccess(role, "workflow.update")) {
        return accessDenied(role, "workflow.update");
      }

      const parsed = z.object({
        summary: z.string().min(1).max(5000),
        phase: z.enum(["implementation", "iterating", "plan_review"]).optional(),
      }).parse(input ?? {});

      const state = recordWorkflowUpdate(contextDir, parsed);
      await pushWorkflowStateIfConfigured(config, state);

      recordToolActivity({
        timestamp: new Date().toISOString(),
        tool: "workflow.update",
        input: parsed as Record<string, unknown>,
        result_count: 1,
        entities_returned: [],
        rules_applied: [],
        duration_ms: 0,
        event_type: "workflow_transition",
        evidence_level: "required",
        resource_type: "workflow",
        metadata: {
          phase: state.phase,
        },
      });

      return buildToolResult(state as unknown as ToolPayload);
    },
  );

  // ── workflow.note ──
  server.registerTool(
    "workflow.note",
    {
      description: "Persist a durable workflow note in .context/workflow/state.json.",
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        details: z.string().min(1).max(5000),
      }),
    },
    async (input) => {
      if (config.rbac.enabled && !checkAccess(role, "workflow.note")) {
        return accessDenied(role, "workflow.note");
      }

      const parsed = z.object({
        title: z.string().min(1).max(200),
        details: z.string().min(1).max(5000),
      }).parse(input ?? {});

      const state = addWorkflowNote(contextDir, parsed);
      await pushWorkflowStateIfConfigured(config, state);

      recordToolActivity({
        timestamp: new Date().toISOString(),
        tool: "workflow.note",
        input: parsed as Record<string, unknown>,
        result_count: state.notes.length,
        entities_returned: [],
        rules_applied: [],
        duration_ms: 0,
        event_type: "workflow_transition",
        evidence_level: "required",
        resource_type: "workflow",
        metadata: {
          note_count: state.notes.length,
          phase: state.phase,
        },
      });

      return buildToolResult(state as unknown as ToolPayload);
    },
  );

  // ── workflow.todo ──
  server.registerTool(
    "workflow.todo",
    {
      description: "Add or complete workflow TODOs persisted in .context.",
      inputSchema: z.object({
        action: z.enum(["add", "complete"]),
        id: z.number().int().positive().optional(),
        title: z.string().min(1).max(200).optional(),
        details: z.string().max(5000).optional(),
      }),
    },
    async (input) => {
      if (config.rbac.enabled && !checkAccess(role, "workflow.todo")) {
        return accessDenied(role, "workflow.todo");
      }

      const parsed = z.object({
        action: z.enum(["add", "complete"]),
        id: z.number().int().positive().optional(),
        title: z.string().min(1).max(200).optional(),
        details: z.string().max(5000).optional(),
      }).parse(input ?? {});

      if (parsed.action === "add") {
        if (!parsed.title) {
          return buildToolResult({ error: "title is required when action=add" });
        }
        const state = addWorkflowTodo(contextDir, {
          title: parsed.title,
          details: parsed.details,
        });
        await pushWorkflowStateIfConfigured(config, state);

        recordToolActivity({
          timestamp: new Date().toISOString(),
          tool: "workflow.todo",
          input: parsed as Record<string, unknown>,
          result_count: state.todos.length,
          entities_returned: [],
          rules_applied: [],
          duration_ms: 0,
          event_type: "workflow_transition",
          evidence_level: "required",
          resource_type: "workflow",
          metadata: {
            action: "add",
            open_todos: state.todos.filter((todo) => todo.status === "open").length,
          },
        });

        return buildToolResult(state as unknown as ToolPayload);
      }

      if (!parsed.id) {
        return buildToolResult({ error: "id is required when action=complete" });
      }

      const result = completeWorkflowTodo(contextDir, parsed.id);
      if (!result.ok) {
        return buildToolResult({
          error: result.error,
          workflow: result.state,
        });
      }
      await pushWorkflowStateIfConfigured(config, result.state);

      recordToolActivity({
        timestamp: new Date().toISOString(),
        tool: "workflow.todo",
        input: parsed as Record<string, unknown>,
        result_count: result.state.todos.length,
        entities_returned: [],
        rules_applied: [],
        duration_ms: 0,
        event_type: "workflow_transition",
        evidence_level: "required",
        resource_type: "workflow",
        metadata: {
          action: "complete",
          completed_id: parsed.id,
          open_todos: result.state.todos.filter((todo) => todo.status === "open").length,
        },
      });

      return buildToolResult(result.state as unknown as ToolPayload);
    },
  );

  // ── workflow.approve ──
  server.registerTool(
    "workflow.approve",
    {
      description:
        "Approve the workflow only after the plan is approved and the latest code review passes.",
      inputSchema: z.object({
        notes: z.string().max(5000).optional(),
      }),
    },
    async (input) => {
      if (config.rbac.enabled && !checkAccess(role, "workflow.approve")) {
        return accessDenied(role, "workflow.approve");
      }

      const parsed = z.object({
        notes: z.string().max(5000).optional(),
      }).parse(input ?? {});

      const result = approveWorkflow(contextDir, parsed.notes);
      if (!result.ok) {
        return buildToolResult({
          error: result.error,
          workflow: result.state,
        });
      }

      await pushWorkflowStateIfConfigured(config, result.state);

      recordToolActivity({
        timestamp: new Date().toISOString(),
        tool: "workflow.approve",
        input: parsed as Record<string, unknown>,
        result_count: 1,
        entities_returned: [],
        rules_applied: [],
        duration_ms: 0,
        event_type: "approval",
        evidence_level: "required",
        resource_type: "workflow",
        metadata: {
          approval_status: result.state.approval.status,
        },
      });

      return buildToolResult(result.state as unknown as ToolPayload);
    },
  );

  // ── security.scan ──
  server.registerTool(
    "security.scan",
    {
      description:
        "Scan text for prompt injection attempts. Returns a risk score and matched patterns. " +
        "Only active when the prompt-injection-defense policy is enforced.",
      inputSchema: z.object({
        text: z.string().min(1).max(50_000).describe("Text to scan for prompt injection"),
        file_path: z.string().max(500).optional().describe("Source file path (for violation reporting)"),
      }),
    },
    async (input) => {
      if (config.rbac.enabled && !checkAccess(role, "policy.list")) {
        return accessDenied(role, "security.scan");
      }

      const parsed = z.object({
        text: z.string().min(1).max(50_000),
        file_path: z.string().max(500).optional(),
      }).parse(input ?? {});

      const policies = policyStore.getMergedPolicies();
      const result = enforceInjectionPolicy(parsed.text, policies, { sanitize: true });

      // Queue violation for push to cortex-web
      if (!result.allowed && result.scan.matches.length > 0) {
        const violation = buildViolationPayload(result.scan.matches, {
          filePath: parsed.file_path,
        });
        queueViolation(violation);
      }

      const rulesApplied = result.allowed ? [] : [result.ruleId];

      recordToolActivity({
        timestamp: new Date().toISOString(),
        tool: "security.scan",
        input: { text_length: parsed.text.length, file_path: parsed.file_path },
        result_count: result.scan.matches.length,
        entities_returned: [],
        rules_applied: rulesApplied,
        duration_ms: 0,
        event_type: "security_scan",
        evidence_level: result.allowed ? "diagnostic" : "required",
        resource_type: "policy",
        metadata: {
          flagged: result.scan.flagged,
          score: result.scan.score,
          allowed: result.allowed,
        },
      });

      return buildToolResult({
        flagged: result.scan.flagged,
        score: result.scan.score,
        allowed: result.allowed,
        policy_active: !result.allowed || result.scan.score > 0 ? true : policies.some(p => p.id === "prompt-injection-defense" && p.enforce),
        matches: result.scan.matches.map((m: InjectionMatch) => ({
          pattern: m.pattern,
          category: m.category,
          matched: m.matched,
          position: m.position,
          weight: m.weight,
        })),
        sanitized: result.sanitized ?? null,
      });
    },
  );

  // ── context.review ──
  server.registerTool(
    "context.review",
    {
      description:
        "Run enterprise policy validators against the current project. " +
        "Checks enforced policies (test coverage, file size, external API calls, code review) " +
        "and returns pass/fail results plus non-blocking repo-local pattern evidence.",
      inputSchema: z.object({
        scope: z.enum(["all", "changed"]).default("changed")
          .describe("'changed' validates only git-modified files; 'all' validates everything"),
        include_passed: z.boolean().default(true)
          .describe("Include passing validators in results"),
        include_pattern_evidence: z.boolean().default(true)
          .describe("Include bounded, local-only repo pattern context without changing pass/fail"),
        pattern_query: z.string().trim().min(1).max(1000).optional()
          .describe("Optional shared pattern query; omitted queries are derived per target"),
        pattern_top_k: z.number().int().min(1).max(5).default(2)
          .describe("Maximum evidence items returned per locality tier and target"),
        pattern_limit: z.number().int().min(1).max(25).default(10)
          .describe("Maximum review targets analyzed for pattern evidence"),
      }),
    },
    async (input) => {
      if (config.rbac.enabled && !checkAccess(role, "context.review")) {
        return accessDenied(role, "context.review");
      }

      const parsed = z.object({
        scope: z.enum(["all", "changed"]).default("changed"),
        include_passed: z.boolean().default(true),
        include_pattern_evidence: z.boolean().default(true),
        pattern_query: z.string().trim().min(1).max(1000).optional(),
        pattern_top_k: z.number().int().min(1).max(5).default(2),
        pattern_limit: z.number().int().min(1).max(25).default(10),
      }).parse(input ?? {});

      const projectRoot = process.env.CORTEX_PROJECT_ROOT?.trim() || process.cwd();

      // Resolve the file set for this review.
      //
      // scope=changed (default): ask git for the diff. If the working copy
      //   is not a git repo — or git otherwise fails — fall back to
      //   walking the project so the review doesn't silently pass
      //   everything with an empty file list (pre-0.9.1 regression).
      //
      // scope=all: always walk the project. Explicit opt-in for whole-
      //   project review; no git dependency.
      let changedFiles: string[] | undefined;
      if (parsed.scope === "changed") {
        changedFiles = resolveChangedReviewFiles(projectRoot) ?? walkProjectFiles(projectRoot);
      } else {
        changedFiles = walkProjectFiles(projectRoot);
      }

      // Build enforced policies list, carrying type + config so the
      // engine can dispatch to generic evaluators for cortex-web custom
      // rules. Predefined rules leave type/config null and route to the
      // name-based validator registry.
      const policies = policyStore.getMergedPolicies();
      const {
        enforced,
        skipped: skippedPolicies,
      } = partitionReviewPolicies(policies);

      const now = new Date().toISOString();

      const output = await runValidators(enforced, {
        contextDir,
        projectRoot,
        changedFiles,
      }, config.validators);
      const patternReview = await buildPatternReviewContext({
        files: changedFiles ?? [],
        enabled: parsed.include_pattern_evidence,
        query: parsed.pattern_query,
        topK: parsed.pattern_top_k,
        limit: parsed.pattern_limit,
      });
      const patternSummary = patternReview.summary as Record<string, unknown>;

      // Filter out passed if requested
      const results = parsed.include_passed
        ? output.results
        : output.results.filter((r) => !r.pass);

      // Queue failures as violations
      for (const r of output.results) {
        if (!r.pass) {
          queueViolation({
            rule_id: r.policy_id,
            severity: r.severity,
            message: r.message.slice(0, 2000),
            metadata: r.detail ? JSON.stringify({ detail: r.detail }).slice(0, 5000) : undefined,
            occurred_at: now,
          });
        }
          queueReviewResult({
            policy_id: r.policy_id,
            pass: r.pass,
          severity: r.severity,
          message: r.message,
          detail: r.detail,
          reviewed_at: now,
        });
      }

      recordToolActivity({
        timestamp: now,
        tool: "context.review",
        input: buildContextReviewAuditInput(parsed),
        result_count: output.results.length,
        entities_returned: output.results.map((r) => r.policy_id),
        rules_applied: output.results.filter((r) => !r.pass).map((r) => r.policy_id),
        duration_ms: 0,
        event_type: "review_result",
        evidence_level: "required",
        resource_type: "review",
        metadata: {
          scope: parsed.scope,
          passed: output.summary.passed,
          failed: output.summary.failed,
          warnings: output.results.filter((r) => !r.pass && r.severity === "warning").length,
          skipped: skippedPolicies.length,
          pattern_analyzed: patternSummary.analyzed ?? 0,
          pattern_local_evidence: patternSummary.local_evidence ?? 0,
          pattern_repo_fallback: patternSummary.repo_fallback ?? 0,
          pattern_omitted: patternSummary.omitted ?? 0,
        },
      });

      const reviewedFiles = snapshotReviewedFiles(projectRoot, changedFiles);
      const workflowState = recordWorkflowReview(contextDir, {
        scope: parsed.scope,
        output,
        reviewed_files: reviewedFiles,
      });
      const lastReview = workflowState.last_review;
      const reviewedAt = lastReview?.reviewed_at ?? now;
      if (lastReview) {
        writeFileSync(
          join(contextDir, "review-status.json"),
          `${JSON.stringify({
            reviewed: lastReview.status === "passed",
            reviewer: "context.review",
            timestamp: reviewedAt,
            scope: parsed.scope,
            reviewed_files: reviewedFiles,
          }, null, 2)}\n`,
          "utf8",
        );
      }
      const trustState = recordQueuedReviewTrustState(
        {
          contextDir,
          projectRoot,
          repo: getReviewPushContext().repo,
          instance_id: getReviewPushContext().instance_id,
          session_id: getReviewPushContext().session_id,
          task_id: process.env.CORTEX_ACTIVE_TASK_ID?.trim() || undefined,
        },
        {
          reviewedAt,
          summary: {
            total: output.summary.total,
            passed: output.summary.passed,
            failed: output.summary.failed,
            warnings: output.summary.warnings,
            skipped: skippedPolicies.length,
          },
          skippedPolicies: skippedPolicies,
        },
      );
      const workflowWithTrust = loadWorkflowState(contextDir);
      await pushWorkflowStateIfConfigured(config, workflowWithTrust);

      return buildToolResult({
        scope: parsed.scope,
        results,
        skipped_policies: skippedPolicies,
        summary: {
          ...output.summary,
          skipped: skippedPolicies.length,
        },
        workflow: workflowWithTrust,
        workflow_source: trustState.workflow.source,
        delivery: trustState.delivery,
        trust_warnings: trustState.trust_warnings,
        pattern_review: patternReview,
      });
    },
  );
}
