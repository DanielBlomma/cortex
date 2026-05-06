import { z } from "zod";

/**
 * Capability registry for the harness. A capability is a least-privilege
 * profile referenced by a workflow stage's `capability` field. The
 * pre-tool-use hook reads the active stage's capability and uses it to
 * gate the agent's tool calls.
 *
 * The capability defines:
 *   - read_globs    paths the agent may read (empty = no restriction)
 *   - write_globs   paths the agent may modify (empty = read-only)
 *   - tools_allowed which tool names the agent may call (empty = all)
 *
 * Glob patterns use minimatch syntax. The harness ships a default set
 * keyed by the names referenced in default-workflows.ts; orgs can ship
 * additional capabilities later via cortex-web sync.
 */

const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);

export const capabilityDefinitionSchema = z.object({
  name: slugSchema,
  description: z.string().min(1).max(500),
  read_globs: z.array(z.string().min(1)).default([]),
  write_globs: z.array(z.string().min(1)).default([]),
  tools_allowed: z.array(z.string().min(1)).default([]),
});

export type CapabilityDefinition = z.infer<typeof capabilityDefinitionSchema>;

/**
 * Default capability profiles that ship with Cortex. Names match the
 * `capability` fields referenced by SECURE_BUILD_WORKFLOW.
 *
 * tools_allowed is intentionally empty for most profiles to mean
 * "no per-tool restriction beyond what the file globs already imply".
 * The hook layer checks file paths first, tool name second.
 */
export const DEFAULT_CAPABILITIES: Record<string, CapabilityDefinition> = {
  planner: {
    name: "planner",
    description:
      "Read-only profile for stages that produce planning artifacts. " +
      "Can read the whole repo and call context tools, cannot modify any files.",
    read_globs: ["**"],
    write_globs: [],
    tools_allowed: [],
  },
  reviewer: {
    name: "reviewer",
    description:
      "Read-only profile for review stages. Same access as planner; the " +
      "review artifact itself is written by the harness, not by an Edit tool.",
    read_globs: ["**"],
    write_globs: [],
    tools_allowed: [],
  },
  builder: {
    name: "builder",
    description:
      "Build profile. May edit source and test files but not config, " +
      "lockfiles, CI workflows, or anything outside the obvious app surface.",
    read_globs: ["**"],
    write_globs: ["src/**", "tests/**", "test/**", "lib/**", "app/**", "components/**"],
    tools_allowed: [],
  },
  tester: {
    name: "tester",
    description:
      "Mutation/test profile. Read-only on production code, may edit only " +
      "test files. Used by mutation-testing or coverage-improvement stages.",
    read_globs: ["**"],
    write_globs: ["tests/**", "test/**", "**/*.test.ts", "**/*.test.tsx", "**/*.test.mjs", "**/*.spec.ts"],
    tools_allowed: [],
  },
  "security-reviewer": {
    name: "security-reviewer",
    description:
      "Security review profile. Read-only across the repo. Produces a " +
      "report artifact; no source modifications allowed.",
    read_globs: ["**"],
    write_globs: [],
    tools_allowed: [],
  },
  human: {
    name: "human",
    description:
      "Sentinel capability for human approval stages. The harness does not " +
      "invoke an agent for this stage; the human writes the artifact directly. " +
      "If a tool call somehow reaches the hook under this capability, it is " +
      "blocked because no automation should be running.",
    read_globs: [],
    write_globs: [],
    tools_allowed: [],
  },
};
