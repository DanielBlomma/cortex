export type GovernManagedCli = "claude" | "codex" | "copilot";

const MANAGED_PATHS: Record<
  GovernManagedCli,
  Partial<Record<NodeJS.Platform, string>>
> = {
  claude: {
    darwin: "/Library/Application Support/ClaudeCode/managed-settings.json",
    linux: "/etc/claude-code/managed-settings.json",
  },
  codex: {
    darwin: "/Library/Application Support/Codex/requirements.toml",
    linux: "/etc/codex/requirements.toml",
  },
  copilot: {
    darwin: "/usr/local/bin/copilot",
    linux: "/usr/local/bin/copilot",
  },
};

export function getGovernManagedPath(
  cli: GovernManagedCli,
  os: NodeJS.Platform,
): string {
  const path = MANAGED_PATHS[cli][os];
  if (!path) {
    throw new Error(`govern install for ${cli} not yet supported on ${os}`);
  }
  return path;
}
