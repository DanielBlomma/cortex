import { pathToFileURL } from "node:url";

const cliEntry = process.argv[2];
if (!cliEntry) {
  throw new Error("Expected a copied Cortex CLI entry path.");
}

const { runEnterpriseInstall } = await import(pathToFileURL(cliEntry).href);

await runEnterpriseInstall(
  ["--api-key-stdin", "--no-hooks", "--no-daemon"],
  {
    stdin: process.stdin,
    requireSudoElevation: () => ({
      user: "test-user",
      uid: 1000,
      gid: 1000,
    }),
    runAsSudoUser: async (_sudo, operation) => operation(),
    sudoHome: "/private/tmp",
    dropPrivileges: () => {},
  },
);
