import {
  chownSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const HOST_IDENTITY_FILENAME = "enterprise-host-identity.json";
const HOST_IDENTITY_VERSION = 2;

type EnterpriseHostIdentity = {
  version: 2;
  credential_id: string;
  endpoint_sha256: string;
};

type HostIdentityOwner = {
  uid: number;
  gid: number;
};

type HostIdentityOptions = {
  homeDir?: string;
  owner?: HostIdentityOwner;
};

export type EnterpriseHostIdentityStatus =
  | "unbound"
  | "match"
  | "rotation"
  | "conflict"
  | "invalid";

function configuredHomeDir(homeDir?: string): string {
  return homeDir ?? process.env.HOME?.trim() ?? homedir();
}

function hostIdentityDir(
  options: HostIdentityOptions = {},
  create = false,
): string | null {
  try {
    const home = realpathSync(configuredHomeDir(options.homeDir));
    const dir = join(home, ".cortex");
    if (existsSync(dir)) {
      const stat = lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
      if (realpathSync(dir) !== dir) return null;
      if (options.owner) {
        if (stat.uid !== options.owner.uid && stat.uid !== 0) return null;
        chownSync(dir, options.owner.uid, options.owner.gid);
        chmodSync(dir, 0o700);
      }
      return dir;
    }
    if (!create) return null;
    mkdirSync(dir, { mode: 0o700 });
    if (options.owner) {
      chownSync(dir, options.owner.uid, options.owner.gid);
    }
    chmodSync(dir, 0o700);
    return dir;
  } catch {
    return null;
  }
}

function hostIdentityPath(
  options: HostIdentityOptions = {},
  createDir = false,
): string | null {
  const dir = hostIdentityDir(options, createDir);
  return dir ? join(dir, HOST_IDENTITY_FILENAME) : null;
}

function readHostIdentity(
  options: HostIdentityOptions = {},
): EnterpriseHostIdentity | null {
  const path = hostIdentityPath(options);
  if (!path) return null;
  if (!existsSync(path)) return null;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    if (
      options.owner &&
      stat.uid !== options.owner.uid &&
      stat.uid !== 0
    ) {
      return null;
    }
    const parsed = JSON.parse(
      readFileSync(path, "utf8"),
    ) as Partial<EnterpriseHostIdentity>;
    if (
      parsed.version !== HOST_IDENTITY_VERSION ||
      typeof parsed.credential_id !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.credential_id) ||
      typeof parsed.endpoint_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.endpoint_sha256)
    ) {
      return null;
    }
    return parsed as EnterpriseHostIdentity;
  } catch {
    return null;
  }
}

/**
 * Atomically bind user-global Enterprise services and artifacts to one
 * endpoint/API-key identity. Malformed existing enrollment fails closed.
 */
export function claimEnterpriseHostIdentity(
  credentialId: string,
  endpoint: string,
  options: HostIdentityOptions = {},
): boolean {
  if (!/^[a-f0-9]{64}$/.test(credentialId)) return false;
  const endpointSha256 = createHash("sha256")
    .update(endpoint.trim().replace(/\/+$/, ""), "utf8")
    .digest("hex");
  const path = hostIdentityPath(options, true);
  if (!path) return false;
  if (existsSync(path)) {
    const existing = readHostIdentity(options);
    if (!existing || existing.endpoint_sha256 !== endpointSha256) {
      return false;
    }
    if (existing.credential_id === credentialId) {
      try {
        if (options.owner) {
          chownSync(path, options.owner.uid, options.owner.gid);
        }
        chmodSync(path, 0o600);
        return true;
      } catch {
        return false;
      }
    }
    return replaceHostIdentity(path, {
      version: HOST_IDENTITY_VERSION,
      credential_id: credentialId,
      endpoint_sha256: endpointSha256,
    }, options.owner);
  }

  try {
    writeFileSync(
      path,
      JSON.stringify(
        {
          version: HOST_IDENTITY_VERSION,
          credential_id: credentialId,
          endpoint_sha256: endpointSha256,
        },
        null,
        2,
      ) + "\n",
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    if (options.owner) {
      chownSync(path, options.owner.uid, options.owner.gid);
    }
    chmodSync(path, 0o600);
    return true;
  } catch {
    // Another process may have won the create race. Only the same identity
    // is accepted after re-reading the completed enrollment record.
    const existing = readHostIdentity(options);
    return (
      existing?.credential_id === credentialId &&
      existing.endpoint_sha256 === endpointSha256
    );
  }
}

function replaceHostIdentity(
  path: string,
  identity: EnterpriseHostIdentity,
  owner?: HostIdentityOwner,
): boolean {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(
      temporaryPath,
      JSON.stringify(identity, null, 2) + "\n",
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    if (owner) {
      chownSync(temporaryPath, owner.uid, owner.gid);
    }
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
    return true;
  } catch {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Best effort.
    }
    return false;
  }
}

export function matchesEnterpriseHostIdentity(
  credentialId: string,
  options: HostIdentityOptions = {},
): boolean {
  if (!/^[a-f0-9]{64}$/.test(credentialId)) return false;
  return readHostIdentity(options)?.credential_id === credentialId;
}

export function inspectEnterpriseHostIdentity(
  credentialId: string,
  endpoint: string,
  options: HostIdentityOptions = {},
): EnterpriseHostIdentityStatus {
  if (!/^[a-f0-9]{64}$/.test(credentialId)) return "invalid";
  let home: string;
  try {
    home = realpathSync(configuredHomeDir(options.homeDir));
  } catch {
    return "invalid";
  }
  const dir = join(home, ".cortex");
  if (!existsSync(dir)) return "unbound";
  try {
    const dirStat = lstatSync(dir);
    if (
      !dirStat.isDirectory() ||
      dirStat.isSymbolicLink() ||
      realpathSync(dir) !== dir
    ) {
      return "invalid";
    }
  } catch {
    return "invalid";
  }
  const path = join(dir, HOST_IDENTITY_FILENAME);
  if (!existsSync(path)) return "unbound";
  const existing = readHostIdentity(options);
  if (!existing) return "invalid";
  const endpointSha256 = createHash("sha256")
    .update(endpoint.trim().replace(/\/+$/, ""), "utf8")
    .digest("hex");
  if (existing.endpoint_sha256 !== endpointSha256) return "conflict";
  return existing.credential_id === credentialId ? "match" : "rotation";
}
