import { execFileSync } from "node:child_process";

function gitLines(projectRoot: string, args: string[]): string[] {
  const output = execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return output.split("\n").map((value) => value.trim()).filter(Boolean);
}

function trackedChangedFiles(projectRoot: string): string[] {
  try {
    return gitLines(projectRoot, ["diff", "--name-only", "HEAD"]);
  } catch {
    // No HEAD yet (repo without commits): every tracked file is new.
    return [
      ...gitLines(projectRoot, ["diff", "--name-only"]),
      ...gitLines(projectRoot, ["ls-files"]),
    ];
  }
}

export function resolveChangedReviewFiles(projectRoot: string): string[] | null {
  try {
    gitLines(projectRoot, ["rev-parse", "--is-inside-work-tree"]);
    const tracked = trackedChangedFiles(projectRoot);
    const untracked = gitLines(projectRoot, ["ls-files", "--others", "--exclude-standard"]);
    return [...new Set([...tracked, ...untracked])].sort();
  } catch {
    return null;
  }
}
