import path from "node:path";
import { loadProjectCliModule } from "./project-runtime.mjs";

export async function runStageCommandShim(args) {
  const target = process.env.CORTEX_PROJECT_ROOT?.trim() || process.cwd();
  process.env.CORTEX_PROJECT_ROOT = path.resolve(target);
  const mod = await loadProjectCliModule("stage");
  await mod.runStageCommand(args);
}
