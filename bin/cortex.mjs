#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { runCli } from "./cli/router.mjs";
import { bullet } from "./style.mjs";

function resolveArgv1() {
  if (!process.argv[1]) return null;
  try {
    return fs.realpathSync(process.argv[1]);
  } catch {
    return process.argv[1];
  }
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(resolveArgv1()).href;

if (invokedAsScript) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(bullet("fail", message, process.stderr) + "\n");
    process.exit(1);
  });
}

export {
  buildInitialConfig,
  detectInitialSourcePaths,
  hardenEnterpriseConfigPermissions,
  isScaffoldOutOfDate,
  slugifyRepoId,
} from "./cli/scaffold.mjs";
export { runEnterpriseInstall } from "./cli/enterprise.mjs";
