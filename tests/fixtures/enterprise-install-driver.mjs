import { runEnterpriseInstall } from "../../bin/cortex.mjs";

const exerciseDaemon = process.env.CORTEX_TEST_EXERCISE_DAEMON === "1";
const failDaemon = process.env.CORTEX_TEST_FAIL_DAEMON === "1";
const failIdentity = process.env.CORTEX_TEST_FAIL_IDENTITY === "1";

await runEnterpriseInstall(
  [
    "--api-key-stdin",
    "--no-hooks",
    ...(exerciseDaemon ? [] : ["--no-daemon"]),
  ],
  {
    stdin: process.stdin,
    requireSudoElevation: () => ({
      user: "test-user",
      uid: 1000,
      gid: 1000,
    }),
    enterpriseMod: {
      runEnterpriseSetup: async () => ({
        ok: true,
        message: "configured",
        configPath: "/private/tmp/cortex-enterprise-test.yml",
        edition: "enterprise",
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    },
    governMod: {
      runGovernInstall: async () => {
        process.stdout.write("install-event:govern-install\n");
        return {
          ok: true,
          message: "installed",
        };
      },
    },
    runAsSudoUser: async (_sudo, operation) => {
      process.stdout.write("install-event:project-user\n");
      return operation();
    },
    sudoHome: "/private/tmp",
    dropPrivileges: () => {
      process.stdout.write("install-event:privileges-dropped\n");
    },
    bindEnterpriseIdentity: () => {
      process.stdout.write("install-event:identity-bound\n");
      return !failIdentity;
    },
    runDaemonCommand: async (args) => {
      process.stdout.write(`daemon-command:${args.join(",")}\n`);
      if (failDaemon) throw new Error("injected daemon restart failure");
    },
  },
);
