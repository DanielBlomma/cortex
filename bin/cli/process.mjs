import { spawn } from "node:child_process";

export function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
      }
    });
  });
}

export function runCommandResult(command, args, cwd, stdio = "ignore") {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
    };

    const child = spawn(command, args, {
      cwd,
      stdio,
      env: process.env,
    });

    child.on("error", (error) => finish({ ok: false, code: null, error }));
    child.on("exit", (code) => finish({ ok: code === 0, code, error: null }));
  });
}

export function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function commandExists(command, cwd) {
  const result = await runCommandResult(command, ["--version"], cwd, "ignore");
  return result.ok;
}
