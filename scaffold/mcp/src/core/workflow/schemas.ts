import { z } from "zod";

/**
 * Schemas for the Cortex Harness workflow engine.
 *
 * See docs/harness-vision.md for the design. In short:
 *
 *   .agents/<task-id>/
 *     plan.md            # frontmatter + body
 *     review.md
 *     changes.md
 *     mutation-report.md
 *     security-report.md
 *     state.json         # current run state
 *
 * All artifacts are markdown with YAML frontmatter; state.json is the only
 * JSON file. Both are tracked in git so a PR carries the evidence trail.
 */

const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
    "Must be lowercase alphanumeric with hyphens (no leading/trailing hyphen)",
  );

/**
 * Static definition of a single stage in a workflow. Authored at the
 * organization level (in cortex-web later) and synced down to projects.
 */
export const stageDefinitionSchema = z.object({
  name: slugSchema,
  artifact: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*\.md$/),
  /** Stage names this stage may read artifacts from. Empty = no inputs. */
  reads: z.array(slugSchema).default([]),
  /** Required frontmatter fields the produced artifact must populate. */
  required_fields: z.array(z.string().min(1)).default([]),
  /** Capability key the stage runs under. References a separate capability registry. */
  capability: z.string().min(1).optional(),
  /** Human-readable summary surfaced in dashboards and audit. */
  description: z.string().min(1).max(500),
});

export type StageDefinition = z.infer<typeof stageDefinitionSchema>;

/**
 * A complete workflow: ordered stages plus a stable identifier.
 */
export const workflowDefinitionSchema = z.object({
  id: slugSchema,
  description: z.string().min(1).max(500),
  version: z.number().int().min(1),
  stages: z.array(stageDefinitionSchema).min(1),
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

/**
 * Status of a single stage inside a run.
 */
export const stageStatusSchema = z.enum([
  "pending",
  "in_progress",
  "complete",
  "blocked",
  "failed",
]);

export type StageStatus = z.infer<typeof stageStatusSchema>;

/**
 * Per-stage record inside state.json. Holds outcome metadata that the next
 * stage's envelope composer needs without re-parsing every artifact.
 */
export const stageRecordSchema = z.object({
  name: slugSchema,
  status: stageStatusSchema,
  artifact: z.string().min(1).optional(),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  /** Frontmatter outcome surfaced for fast lookup (e.g. approved=true on review). */
  outcome: z.record(z.string(), z.unknown()).optional(),
});

export type StageRecord = z.infer<typeof stageRecordSchema>;

/**
 * The full state of one workflow run, persisted as
 * .agents/<task-id>/state.json. Written only on stage boundaries so it
 * never churns mid-tick.
 */
export const runStateSchema = z.object({
  schema_version: z.literal(1),
  task_id: slugSchema,
  workflow_id: slugSchema,
  workflow_version: z.number().int().min(1),
  task_description: z.string().min(1).max(2000),
  current_stage: slugSchema.nullable(),
  outcome: z.enum(["in_progress", "complete", "failed", "blocked"]),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
  stages: z.array(stageRecordSchema).min(1),
});

export type RunState = z.infer<typeof runStateSchema>;

/**
 * The required-by-convention frontmatter shape every stage artifact carries.
 * Stages may add additional structured fields; these four are the ones the
 * harness itself relies on.
 */
export const stageArtifactFrontmatterSchema = z
  .object({
    stage: slugSchema,
    status: stageStatusSchema,
    /** Sister-artifacts this artifact references (relative filenames). */
    references: z.array(z.string().min(1)).default([]),
    /** ISO 8601; injected by the harness, not the agent. */
    written_at: z.string().datetime(),
  })
  .passthrough();

export type StageArtifactFrontmatter = z.infer<typeof stageArtifactFrontmatterSchema>;
