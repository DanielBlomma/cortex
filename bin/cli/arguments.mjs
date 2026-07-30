import path from "node:path";

export function parseInitArgs(args) {
  let target = process.cwd();
  let force = false;
  let bootstrap = false;
  let connect = false;
  let watch = true;

  for (const arg of args) {
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--bootstrap") {
      bootstrap = true;
      continue;
    }
    if (arg === "--connect") {
      connect = true;
      continue;
    }
    if (arg === "--no-connect") {
      connect = false;
      continue;
    }
    if (arg === "--watch") {
      watch = true;
      continue;
    }
    if (arg === "--no-watch") {
      watch = false;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown init option: ${arg}`);
    }
    target = path.resolve(arg);
  }

  return { target, force, bootstrap, connect, watch };
}

export function parseConnectArgs(args) {
  let target = process.cwd();
  let skipBuild = false;

  for (const arg of args) {
    if (arg === "--skip-build") {
      skipBuild = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown connect option: ${arg}`);
    }
    target = path.resolve(arg);
  }

  return { target, skipBuild };
}
