import fs from "node:fs";

let _isWSL = null;

export function isWSL() {
  if (_isWSL !== null) return _isWSL;
  try {
    const version = fs.readFileSync("/proc/version", "utf8");
    _isWSL = /microsoft|wsl/i.test(version);
  } catch {
    _isWSL = false;
  }
  return _isWSL;
}

export function windowsToWslPath(winPath) {
  const match = winPath.match(/^([A-Za-z]):[/\\](.*)/);
  if (!match) return winPath;
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, "/").replace(/\/+$/, "");
  return `/mnt/${drive}/${rest}`;
}

export function normalizeProjectRoot(rawPath) {
  if (!isWSL()) return rawPath;
  if (/^[A-Za-z]:[/\\]/.test(rawPath)) {
    return windowsToWslPath(rawPath);
  }
  return rawPath;
}
