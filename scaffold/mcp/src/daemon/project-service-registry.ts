import { existsSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export type ProjectServiceHandle = {
  stop(): void | Promise<void>;
};

export type ProjectServiceFactory = (
  cwd: string,
) => ReadonlyArray<ProjectServiceHandle>;

export type HostServiceFactory = (
  cwd: string,
  credentialId: string,
) => ReadonlyArray<ProjectServiceHandle>;

export type ProjectServiceRegistryOptions = {
  credentialIdForCwd?: (cwd: string) => string | null;
  hostFactory?: HostServiceFactory;
};

export function normalizeProjectCwd(cwd: string): string | null {
  if (!cwd.trim()) return null;
  const candidate = resolve(cwd);
  try {
    if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
      return null;
    }
    if (!existsSync(join(candidate, ".context"))) {
      return null;
    }
    return realpathSync(candidate);
  } catch {
    return null;
  }
}

/**
 * Owns background services for every project observed by the per-user daemon.
 * Request-time handlers already carry cwd in their payloads; this registry
 * gives the periodic services the same project isolation.
 */
export class ProjectServiceRegistry {
  private readonly projects = new Map<
    string,
    ReadonlyArray<ProjectServiceHandle>
  >();
  private hostCredentialId: string | null = null;
  private hostHandles: ReadonlyArray<ProjectServiceHandle> = [];

  constructor(
    private readonly factory: ProjectServiceFactory,
    private readonly options: ProjectServiceRegistryOptions = {},
  ) {}

  register(cwd: string): boolean {
    const normalized = normalizeProjectCwd(cwd);
    if (!normalized || this.projects.has(normalized)) return false;
    const credentialId =
      this.options.credentialIdForCwd?.(normalized) ?? "project-local";
    if (!credentialId) return false;
    if (
      this.hostCredentialId &&
      this.hostCredentialId !== credentialId
    ) {
      return false;
    }
    if (!this.hostCredentialId) {
      this.hostCredentialId = credentialId;
      this.hostHandles =
        this.options.hostFactory?.(normalized, credentialId) ?? [];
    }
    const handles = this.factory(normalized);
    this.projects.set(normalized, handles);
    return true;
  }

  has(cwd: string): boolean {
    const normalized = normalizeProjectCwd(cwd);
    return normalized ? this.projects.has(normalized) : false;
  }

  projectCwds(): string[] {
    return Array.from(this.projects.keys());
  }

  async stopAll(): Promise<void> {
    const handles = [
      ...Array.from(this.projects.values()).flat(),
      ...this.hostHandles,
    ];
    this.projects.clear();
    this.hostHandles = [];
    this.hostCredentialId = null;
    await Promise.allSettled(
      handles.map((handle) => Promise.resolve(handle.stop())),
    );
  }

  size(): number {
    return this.projects.size;
  }

  activeCredentialId(): string | null {
    return this.hostCredentialId;
  }
}
