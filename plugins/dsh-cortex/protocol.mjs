import { Buffer } from 'node:buffer'

export const MAX_QUERY_BYTES = 8 * 1024
export const MAX_STDOUT_BYTES = 2 * 1024 * 1024
export const MAX_STDERR_BYTES = 64 * 1024
export const MAX_TIMEOUT_MS = 15_000
export const TERMINATION_GRACE_MS = 1_000
export const MAX_ERROR_CODE_BYTES = 64
export const MAX_ERROR_MESSAGE_BYTES = 2 * 1024

export const RESPONSE_PRESETS = Object.freeze(['full', 'compact', 'minimal'])
export const IMPACT_PROFILES = Object.freeze([
  'all',
  'config_only',
  'config_to_sql',
  'code_only',
  'sql_only',
])
export const IMPACT_SORTS = Object.freeze([
  'impact_score',
  'shortest_path',
  'semantic_score',
  'graph_score',
  'trust_score',
])
export const RELATION_TYPES = Object.freeze([
  'CALLS',
  'CALLS_SQL',
  'IMPORTS',
  'USES_CONFIG_KEY',
  'USES_RESOURCE_KEY',
  'USES_SETTING_KEY',
  'USES_CONFIG',
  'TRANSFORMS_CONFIG',
  'PART_OF',
])
export const RESULT_DOMAINS = Object.freeze([
  'code',
  'config',
  'resource',
  'settings',
  'sql',
  'project',
])
export const RESULT_ENTITY_TYPES = Object.freeze([
  'File',
  'Chunk',
  'Module',
  'Project',
  'ADR',
  'Rule',
])

const FAILURE_MESSAGES = Object.freeze({
  MISSING_EXECUTION_IDENTITY: 'Cortex requires the exact calling Harness agent. Retry from an active agent session.',
  INVALID_WORKSPACE: 'Cortex requires an existing absolute Harness workspace directory. Reopen the agent in a valid workspace.',
  RUNTIME_UNAVAILABLE: 'The package-owned Cortex runtime could not be started. Reinstall the exact Cortex Harness bundle.',
  TIMEOUT: 'Cortex retrieval exceeded its local execution deadline. Narrow the query and retry.',
  CANCELED: 'Cortex retrieval was canceled. Retry when the caller is ready.',
  NON_ZERO_EXIT: "The Cortex command exited unsuccessfully. Run 'cortex doctor' in the Harness workspace.",
  OUTPUT_LIMIT: 'The Cortex command exceeded its bounded output limit. Request fewer results or omit source content.',
  MALFORMED_JSON: 'The Cortex command returned malformed JSON. Verify the installed Cortex bundle version.',
  PROTOCOL_MISMATCH: 'The Cortex command returned an incompatible response. Verify the installed Cortex bundle version.',
})

export class CortexProviderError extends Error {
  constructor(code, workspace) {
    const base = FAILURE_MESSAGES[code] ?? FAILURE_MESSAGES.PROTOCOL_MISMATCH
    const location = typeof workspace === 'string' && workspace.length > 0
      ? ` Workspace: ${workspace}`
      : ''
    super(`${base}${location}`)
    this.name = 'CortexProviderError'
    this.code = Object.hasOwn(FAILURE_MESSAGES, code) ? code : 'PROTOCOL_MISMATCH'
    if (location) this.workspace = workspace
  }
}

export function requireSignal(signal) {
  if (signal === undefined || signal === null
    || typeof signal.aborted !== 'boolean'
    || typeof signal.addEventListener !== 'function'
    || typeof signal.removeEventListener !== 'function') {
    throw new CortexProviderError('MISSING_EXECUTION_IDENTITY')
  }
  return signal
}

export function requireText(value, label = 'value') {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} is required`)
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_QUERY_BYTES) {
    throw new TypeError(`${label} must not exceed ${MAX_QUERY_BYTES} UTF-8 bytes`)
  }
  return value
}

export function optionalText(value, label) {
  if (value === undefined) return undefined
  return requireText(value, label)
}

export function optionalBoolean(value, label) {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`)
  return value
}

export function optionalInteger(value, label, max) {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new TypeError(`${label} must be an integer from 1 to ${max}`)
  }
  return value
}

export function optionalEnum(value, label, allowed) {
  if (value === undefined) return undefined
  if (!allowed.includes(value)) {
    throw new TypeError(`${label} must be one of ${allowed.join(', ')}`)
  }
  return value
}

export function optionalEnumList(value, label, allowed) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`)
  }
  const unique = []
  for (const entry of value) {
    optionalEnum(entry, label, allowed)
    if (!unique.includes(entry)) unique.push(entry)
  }
  return unique
}

export function pushFlag(argv, flag, value) {
  if (value === undefined || value === false) return
  argv.push(flag)
  if (value !== true) argv.push(String(value))
}

export function validateEnvelope(value, expectedCommand) {
  if (!isPlainRecord(value)
    || value.command !== expectedCommand
    || typeof value.ok !== 'boolean') {
    throw new CortexProviderError('PROTOCOL_MISMATCH')
  }
  if (value.ok === true) {
    if (!isPlainRecord(value.data)) throw new CortexProviderError('PROTOCOL_MISMATCH')
    return value
  }
  if (!isPlainRecord(value.error)
    || !isBoundedText(value.error.code, MAX_ERROR_CODE_BYTES)
    || !isBoundedText(value.error.message, MAX_ERROR_MESSAGE_BYTES)) {
    throw new CortexProviderError('PROTOCOL_MISMATCH')
  }
  return value
}

export function parseEnvelope(text, expectedCommand) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new CortexProviderError('MALFORMED_JSON')
  }
  return validateEnvelope(parsed, expectedCommand)
}

function isPlainRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isBoundedText(value, maxBytes) {
  return typeof value === 'string'
    && value.length > 0
    && Buffer.byteLength(value, 'utf8') <= maxBytes
}
