// Config
export { loadEnterpriseConfig, resolveEnterpriseActivation } from "./config.js";
export type {
  TelemetryConfig,
  AuditConfig,
  PolicyConfig,
  EnterpriseConfig,
  EnterpriseServiceConfig,
  EnterpriseActivation
} from "./config.js";

// Telemetry
export { TelemetryCollector } from "./telemetry/collector.js";
export type { TelemetryMetrics } from "./telemetry/collector.js";

// Audit
export { AuditWriter } from "./audit/writer.js";
export type { AuditEntry } from "./audit/writer.js";
export { queryAuditLog } from "./audit/query.js";
export type { AuditQuery } from "./audit/query.js";

// RBAC
export { checkAccess, getAccessDeniedMessage } from "./rbac/check.js";
export type { Role, RBACConfig } from "./rbac/check.js";

// Policy
export { PolicyStore } from "./policy/store.js";
export type { OrgPolicy } from "./policy/store.js";

// Prompt injection
export { scanForInjection, sanitizeContent } from "./policy/injection.js";
export type { ScanResult, InjectionMatch, InjectionCategory } from "./policy/injection.js";
export { enforceInjectionPolicy, isInjectionDefenseActive, buildViolationPayload } from "./policy/enforce.js";
export type { EnforcementResult } from "./policy/enforce.js";
