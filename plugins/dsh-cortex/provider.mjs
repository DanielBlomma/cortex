import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

import {
  CortexProviderError,
  IMPACT_PROFILES,
  IMPACT_SORTS,
  MAX_STDERR_BYTES,
  MAX_STDOUT_BYTES,
  MAX_TIMEOUT_MS,
  RELATION_TYPES,
  RESPONSE_PRESETS,
  RESULT_DOMAINS,
  RESULT_ENTITY_TYPES,
  TERMINATION_GRACE_MS,
  optionalBoolean,
  optionalEnum,
  optionalEnumList,
  optionalInteger,
  optionalText,
  parseEnvelope,
  pushFlag,
  requireSignal,
  requireText,
} from './protocol.mjs'

export const name = 'cortex-context'
export const inject = ['subprocess']
export const Config = z.object({
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMEOUT_MS).default(MAX_TIMEOUT_MS),
})

export class CortexContextService extends Service {
  constructor(ctx) {
    super(ctx, 'cortexContext')
  }

  search(_agent, _request, _signal) {
    throw new Error('CortexContextService.search is not implemented')
  }

  related(_agent, _request, _signal) {
    throw new Error('CortexContextService.related is not implemented')
  }

  impact(_agent, _request, _signal) {
    throw new Error('CortexContextService.impact is not implemented')
  }

  rules(_agent, _request, _signal) {
    throw new Error('CortexContextService.rules is not implemented')
  }
}

export class CortexCliRunner {
  constructor(subprocess, config = {}, cliEntry = resolveCortexCliEntry()) {
    if (subprocess === undefined || typeof subprocess.spawn !== 'function') {
      throw new TypeError('cortex-context requires ctx.subprocess')
    }
    const timeoutMs = config.timeoutMs ?? MAX_TIMEOUT_MS
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new TypeError(`cortex-context timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`)
    }
    if (typeof cliEntry !== 'string' || !path.isAbsolute(cliEntry)) {
      throw new TypeError('cortex-context requires an absolute package-owned Cortex entry')
    }
    this.subprocess = subprocess
    this.timeoutMs = timeoutMs
    this.cliEntry = cliEntry
  }

  search(agent, request, signal) {
    return this.run(agent, 'search', buildSearchArgs(request), signal)
  }

  related(agent, request, signal) {
    return this.run(agent, 'related', buildRelatedArgs(request), signal)
  }

  impact(agent, request, signal) {
    return this.run(agent, 'impact', buildImpactArgs(request), signal)
  }

  rules(agent, request, signal) {
    return this.run(agent, 'rules', buildRulesArgs(request), signal)
  }

  async run(agent, command, args, callerSignal) {
    requireSignal(callerSignal)
    if (callerSignal.aborted) throw new CortexProviderError('CANCELED')
    const workspace = await canonicalWorkspace(agent)
    if (callerSignal.aborted) throw new CortexProviderError('CANCELED', workspace)

    const deadline = new AbortController()
    const timer = setTimeout(() => {
      deadline.abort(new CortexProviderError('TIMEOUT', workspace))
    }, this.timeoutMs)
    const fused = fuseSignals(callerSignal, deadline.signal)
    let handle
    let disposeTerminationObserver
    try {
      handle = this.subprocess.spawn({
        argv: [process.execPath, this.cliEntry, command, ...withJsonFlag(args)],
        cwd: workspace,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: MAX_STDOUT_BYTES },
          stderr: { maxBytes: MAX_STDERR_BYTES },
        },
        graceMs: TERMINATION_GRACE_MS,
        signal: fused.signal,
      })
      const terminate = () => { handle.terminate() }
      fused.signal.addEventListener('abort', terminate, { once: true })
      disposeTerminationObserver = () => { fused.signal.removeEventListener('abort', terminate) }
      if (fused.signal.aborted) terminate()

      let outcome
      try {
        outcome = await handle.done
      } finally {
        await handle.waitForExit()
      }
      if (fused.signal.aborted) {
        if (callerSignal.aborted) throw new CortexProviderError('CANCELED', workspace)
        throw new CortexProviderError('TIMEOUT', workspace)
      }
      const stdout = readCollected(handle.collected?.stdout)
      const stderr = readCollected(handle.collected?.stderr)
      if (stdout.lossy || stderr.lossy) {
        throw new CortexProviderError('OUTPUT_LIMIT', workspace)
      }
      if (outcome.signal !== null) {
        throw new CortexProviderError('NON_ZERO_EXIT', workspace)
      }
      if (outcome.exitCode !== 0) {
        try {
          const failure = parseEnvelope(stdout.text, command)
          if (failure.ok !== false) throw new CortexProviderError('PROTOCOL_MISMATCH', workspace)
        } catch (error) {
          if (error instanceof CortexProviderError && error.code === 'PROTOCOL_MISMATCH') throw error
        }
        throw new CortexProviderError('NON_ZERO_EXIT', workspace)
      }
      try {
        const envelope = parseEnvelope(stdout.text, command)
        if (envelope.ok !== true) throw new CortexProviderError('PROTOCOL_MISMATCH', workspace)
        return envelope
      } catch (error) {
        if (error instanceof CortexProviderError) {
          throw new CortexProviderError(error.code, workspace)
        }
        throw error
      }
    } catch (error) {
      if (error instanceof CortexProviderError) throw error
      if (callerSignal.aborted) throw new CortexProviderError('CANCELED', workspace)
      if (deadline.signal.aborted) throw new CortexProviderError('TIMEOUT', workspace)
      throw new CortexProviderError('RUNTIME_UNAVAILABLE', workspace)
    } finally {
      clearTimeout(timer)
      disposeTerminationObserver?.()
      fused.dispose()
    }
  }
}

export class CortexContextProvider extends CortexContextService {
  static inject = ['subprocess']
  static Config = Config

  constructor(ctx, config = {}) {
    super(ctx)
    this.runner = new CortexCliRunner(ctx.subprocess, config)
  }

  search(agent, request, signal) {
    return this.runner.search(agent, request, signal)
  }

  related(agent, request, signal) {
    return this.runner.related(agent, request, signal)
  }

  impact(agent, request, signal) {
    return this.runner.impact(agent, request, signal)
  }

  rules(agent, request, signal) {
    return this.runner.rules(agent, request, signal)
  }
}

export function apply(ctx, config = {}) {
  return new CortexContextProvider(ctx, config)
}

export function resolveCortexCliEntry() {
  const url = import.meta.resolve('@danielblomma/cortex-mcp')
  if (!url.startsWith('file:')) {
    throw new CortexProviderError('RUNTIME_UNAVAILABLE')
  }
  const entry = fileURLToPath(url)
  if (path.basename(entry) !== 'cortex.mjs' || path.basename(path.dirname(entry)) !== 'bin') {
    throw new CortexProviderError('RUNTIME_UNAVAILABLE')
  }
  return entry
}

export async function canonicalWorkspace(agent) {
  let cwd
  try {
    cwd = agent?.session?.header?.cwd
  } catch {
    throw new CortexProviderError('MISSING_EXECUTION_IDENTITY')
  }
  if (typeof cwd !== 'string' || cwd.length === 0 || !path.isAbsolute(cwd)) {
    throw new CortexProviderError('INVALID_WORKSPACE')
  }
  try {
    const canonical = await realpath(cwd)
    const metadata = await stat(canonical)
    if (!metadata.isDirectory()) throw new Error('not a directory')
    return canonical
  } catch {
    throw new CortexProviderError('INVALID_WORKSPACE')
  }
}

export function buildSearchArgs(request = {}) {
  const query = requireText(request.query, 'query')
  const argv = []
  pushFlag(argv, '--top-k', optionalInteger(request.top_k, 'top_k', 20))
  pushFlag(argv, '--preset', optionalEnum(request.response_preset, 'response_preset', RESPONSE_PRESETS))
  pushFlag(argv, '--include-deprecated', optionalBoolean(request.include_deprecated, 'include_deprecated'))
  pushFlag(argv, '--include-scores', optionalBoolean(request.include_scores, 'include_scores'))
  pushFlag(argv, '--include-matched-rules', optionalBoolean(request.include_matched_rules, 'include_matched_rules'))
  pushFlag(argv, '--include-content', optionalBoolean(request.include_content, 'include_content'))
  argv.push('--', query)
  return argv
}

export function buildRelatedArgs(request = {}) {
  const entityId = requireText(request.entity_id, 'entity_id')
  const argv = []
  pushFlag(argv, '--depth', optionalInteger(request.depth, 'depth', 3))
  pushFlag(argv, '--preset', optionalEnum(request.response_preset, 'response_preset', RESPONSE_PRESETS))
  pushFlag(argv, '--include-edges', optionalBoolean(request.include_edges, 'include_edges'))
  pushFlag(argv, '--include-entity-metadata', optionalBoolean(request.include_entity_metadata, 'include_entity_metadata'))
  argv.push('--', entityId)
  return argv
}

export function buildImpactArgs(request = {}) {
  const entityId = optionalOptionValue(request.entity_id, 'entity_id')
  const query = optionalText(request.query, 'query')
  if ((entityId === undefined) === (query === undefined)) {
    throw new TypeError('exactly one of entity_id or query is required')
  }
  const argv = []
  const includeEdges = optionalBoolean(request.include_edges, 'include_edges')
  const delimitedQuery = entityId === undefined && query.startsWith('--')
  if (!delimitedQuery) {
    pushFlag(argv, entityId === undefined ? '--query' : '--entity-id', entityId ?? query)
  }
  pushFlag(argv, '--depth', optionalInteger(request.depth, 'depth', 4))
  pushFlag(argv, '--top-k', optionalInteger(request.top_k, 'top_k', 20))
  pushFlag(argv, '--preset', optionalEnum(request.response_preset, 'response_preset', RESPONSE_PRESETS))
  pushFlag(argv, '--include-scores', optionalBoolean(request.include_scores, 'include_scores'))
  pushFlag(argv, '--include-reasons', optionalBoolean(request.include_reasons, 'include_reasons'))
  pushFlag(argv, '--verbose-paths', optionalBoolean(request.verbose_paths, 'verbose_paths'))
  pushFlag(argv, '--no-edges', includeEdges === false)
  pushFlag(argv, '--max-path-hops-shown', optionalInteger(request.max_path_hops_shown, 'max_path_hops_shown', 8))
  pushFlag(argv, '--profile', optionalEnum(request.profile, 'profile', IMPACT_PROFILES))
  pushFlag(argv, '--sort-by', optionalEnum(request.sort_by, 'sort_by', IMPACT_SORTS))
  pushCsv(argv, '--relation-types', optionalEnumList(request.relation_types, 'relation_types', RELATION_TYPES))
  pushCsv(argv, '--path-must-include', optionalEnumList(request.path_must_include, 'path_must_include', RELATION_TYPES))
  pushCsv(argv, '--path-must-exclude', optionalEnumList(request.path_must_exclude, 'path_must_exclude', RELATION_TYPES))
  pushCsv(argv, '--result-domains', optionalEnumList(request.result_domains, 'result_domains', RESULT_DOMAINS))
  pushCsv(argv, '--result-entity-types', optionalEnumList(request.result_entity_types, 'result_entity_types', RESULT_ENTITY_TYPES))
  if (delimitedQuery) argv.push('--', query)
  return argv
}

export function buildRulesArgs(request = {}) {
  const argv = []
  pushFlag(argv, '--scope', optionalOptionValue(request.scope, 'scope'))
  pushFlag(argv, '--include-inactive', optionalBoolean(request.include_inactive, 'include_inactive'))
  return argv
}

function pushCsv(argv, flag, values) {
  if (values !== undefined) pushFlag(argv, flag, values.join(','))
}

function optionalOptionValue(value, label) {
  const text = optionalText(value, label)
  if (text?.startsWith('--')) {
    throw new TypeError(`${label} must not start with --`)
  }
  return text
}

function withJsonFlag(args) {
  const delimiter = args.indexOf('--')
  if (delimiter === -1) return [...args, '--json']
  return [...args.slice(0, delimiter), '--json', ...args.slice(delimiter)]
}

function readCollected(reader) {
  if (reader === undefined || typeof reader.readFrom !== 'function') {
    throw new CortexProviderError('PROTOCOL_MISMATCH')
  }
  const result = reader.readFrom(0)
  return {
    text: typeof result?.text === 'string' ? result.text : '',
    lossy: result?.lossy !== false,
  }
}

function fuseSignals(caller, deadline) {
  const controller = new AbortController()
  const dispose = () => {
    caller.removeEventListener('abort', abortFromCaller)
    deadline.removeEventListener('abort', abortFromDeadline)
  }
  const abortFromCaller = () => {
    if (!controller.signal.aborted) controller.abort(caller.reason)
    dispose()
  }
  const abortFromDeadline = () => {
    if (!controller.signal.aborted) controller.abort(deadline.reason)
    dispose()
  }
  if (caller.aborted) abortFromCaller()
  else if (deadline.aborted) abortFromDeadline()
  else {
    caller.addEventListener('abort', abortFromCaller, { once: true })
    deadline.addEventListener('abort', abortFromDeadline, { once: true })
  }
  return { signal: controller.signal, dispose }
}

export default CortexContextProvider
