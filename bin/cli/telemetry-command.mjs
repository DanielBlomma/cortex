import { loadProjectCliModule } from "./project-runtime.mjs";

export async function runTelemetryCommand(args) {
  const sub = args[0] || "help";
  if (sub === "test") {
    const mod = await loadProjectCliModule("telemetry-test");
    const code = await mod.runTelemetryTest();
    process.exit(code);
  }
  if (sub === "help" || sub === "--help" || sub === "-h") {
    console.log("Usage:");
    console.log(
      "  cortex telemetry test    Smoke-test the push pipeline end-to-end",
    );
    return;
  }
  throw new Error(`Unknown telemetry subcommand: ${sub}`);
}
