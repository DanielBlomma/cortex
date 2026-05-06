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
 * Validator requirement declared by a workflow stage. Cortex enforces
 * that the agent reports having run each declared validator (via the
 * artifact's `validators_passed` frontmatter), but never executes the
 * validator itself — the agent picks the concrete tooling.
 *
 * id is a stable identifier (e.g. "mutation-score") that the agent
 * echoes back; description is human-readable context for the agent
 * rendered into the stage envelope.
 */
export const validatorRequirementSchema = z.object({
  id: slugSchema,
  description: z.string().min(1).max(500),
});

export type ValidatorRequirement = z.infer<typeof validatorRequirementSchema>;

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
  /**
   * Validators the stage requires the agent to have run. The agent
   * picks the actual tooling (e.g. stryker for mutation testing) and
   * reports the result by listing each validator's id under
   * `validators_passed` in the artifact frontmatter. Cortex enforces
   * the list-coverage contract on advance unless the call carries an
   * explicit override.
   */
  validators: z.array(validatorRequirementSchema).default([]),
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
 * Process-override record. When a stage advances despite missing or
 * failed validators, the caller must pass an override with a free-text
 * reason. The override is recorded on the StageRecord, stamped into
 * the artifact's frontmatter, and emitted as a high-evidence audit
 * event so reviewers can see the deviation in the evidence trail.
 */
export const stageOverrideSchema = z.object({
  reason: z.string().min(1).max(2000),
  skipped_validators: z.array(z.string().min(1)).default([]),
  skipped_requirements: z.array(z.string().min(1)).default([]),
});

export type StageOverride = z.infer<typeof stageOverrideSchema>;

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
  /** Validators the agent reported having run for this stage. */
  validators_passed: z.array(z.string().min(1)).default([]),
  /** Override record if the stage advanced despite missing/failed requirements. */
  override: stageOverrideSchema.optional(),
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
