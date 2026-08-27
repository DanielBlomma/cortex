import test from 'node:test'
import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  CortexCliRunner,
  buildImpactArgs,
  buildRulesArgs,
  resolveCortexCliEntry,
} from '../plugins/dsh-cortex/provider.mjs'
import {
  CortexProviderError,
  MAX_ERROR_MESSAGE_BYTES,
  MAX_QUERY_BYTES,
  parseEnvelope,
} from '../plugins/dsh-cortex/protocol.mjs'
import { createCortexTools } from '../plugins/dsh-cortex/tools.mjs'
import { apply as applyTools } from '../plugins/dsh-cortex/tools.mjs'
import { loadPackagedSkills } from '../plugins/dsh-cortex/skills.mjs'

function agent(cwd, id = cwd) {
  return { id, session: { header: { cwd } } }
}

function reader(text, lossy = false) {
  return { readFrom: () => ({ text, lossy, nextOffset: Buffer.byteLength(text) }) }
}

function settledSubprocess(handler) {
  const calls = []
  return {
    calls,
    spawn(spec) {
      calls.push(spec)
      const result = handler(spec)
      return {
        pid: 123,
        collected: {
          stdout: reader(result.stdout ?? '', result.stdoutLossy ?? false),
          stderr: reader(result.stderr ?? '', result.stderrLossy ?? false),
        },
        done: Promise.resolve({ exitCode: result.exitCode ?? 0, signal: result.signal ?? null }),
        terminate() {},
        waitForExit: async () => true,
      }
    },
  }
}

function success(command, data = { results: [] }) {
  return JSON.stringify({ ok: true, command, data })
}

test('provider binds each invocation to the exact canonical agent workspace and package entry', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-dsh-provider-'))
  t.after(() => fs.rm(temporary, { recursive: true, force: true }))
  const first = path.join(temporary, 'first')
  const second = path.join(temporary, 'second')
  await Promise.all([fs.mkdir(first), fs.mkdir(second)])
  const subprocess = settledSubprocess((spec) => ({ stdout: success(spec.argv[2]) }))
  const cliEntry = path.join(temporary, 'package', 'bin', 'cortex.mjs')
  const runner = new CortexCliRunner(subprocess, {}, cliEntry)

  await Promise.all([
    runner.search(agent(first, 'a'), { query: 'alpha' }, new AbortController().signal),
    runner.rules(agent(second, 'b'), {}, new AbortController().signal),
  ])

  const expectedRoots = await Promise.all([fs.realpath(first), fs.realpath(second)])
  assert.deepEqual(subprocess.calls.map((call) => call.cwd).sort(), expectedRoots.sort())
  for (const call of subprocess.calls) {
    assert.equal(call.argv[0], process.execPath)
    assert.equal(call.argv[1], cliEntry)
    assert.equal(getEventListeners(call.signal, 'abort').length, 0)
    const jsonIndex = call.argv.indexOf('--json')
    const delimiterIndex = call.argv.indexOf('--')
    assert.notEqual(jsonIndex, -1)
    assert.equal(delimiterIndex === -1 ? jsonIndex === call.argv.length - 1 : jsonIndex < delimiterIndex, true)
    assert.equal(call.env, undefined)
    assert.equal(call.graceMs, 1_000)
    assert.deepEqual(call.stdio, {
      stdin: 'ignore',
      stdout: { maxBytes: 2 * 1024 * 1024 },
      stderr: { maxBytes: 64 * 1024 },
    })
  }
})

test('provider fails closed before spawn for missing, relative, deleted, and non-directory workspaces', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-dsh-invalid-'))
  t.after(() => fs.rm(temporary, { recursive: true, force: true }))
  const file = path.join(temporary, 'file')
  await fs.writeFile(file, 'not a directory')
  const subprocess = settledSubprocess(() => ({ stdout: success('rules', { rules: [] }) }))
  const runner = new CortexCliRunner(subprocess, {}, path.join(temporary, 'bin', 'cortex.mjs'))

  for (const candidate of [undefined, 'relative', path.join(temporary, 'deleted'), file]) {
    await assert.rejects(
      runner.rules(agent(candidate), {}, new AbortController().signal),
      (error) => error instanceof CortexProviderError && error.code === 'INVALID_WORKSPACE',
    )
  }
  assert.equal(subprocess.calls.length, 0)
})

test('provider rejects bounded-output and response-protocol failures without echoing child data', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-dsh-protocol-'))
  t.after(() => fs.rm(temporary, { recursive: true, force: true }))
  const secret = 'do-not-echo-secret'
  const cases = [
    [{ stdout: JSON.stringify({ ok: false, command: 'rules', error: { code: 'INVALID_ARGS', message: secret } }), exitCode: 1 }, 'NON_ZERO_EXIT'],
    [{ stdout: `{${secret}` }, 'MALFORMED_JSON'],
    [{ stdout: `${success('rules')}\n${success('rules')}` }, 'MALFORMED_JSON'],
    [{ stdout: success('search') }, 'PROTOCOL_MISMATCH'],
    [{ stdout: JSON.stringify({ ok: true, command: 'rules', data: [] }) }, 'PROTOCOL_MISMATCH'],
    [{ stdout: success('rules'), stderrLossy: true }, 'OUTPUT_LIMIT'],
  ]
  for (const [result, code] of cases) {
    const subprocess = settledSubprocess(() => result)
    const runner = new CortexCliRunner(subprocess, {}, path.join(temporary, 'bin', 'cortex.mjs'))
    await assert.rejects(
      runner.rules(agent(temporary), {}, new AbortController().signal),
      (error) => {
        assert.equal(error.code, code)
        assert.doesNotMatch(error.message, new RegExp(secret))
        return true
      },
    )
  }
})

test('failure envelopes require bounded code and message fields', () => {
  assert.equal(parseEnvelope(JSON.stringify({
    ok: false,
    command: 'rules',
    error: { code: 'INVALID_ARGS', message: 'invalid request' },
  }), 'rules').ok, false)
  for (const error of [
    undefined,
    { code: '', message: 'invalid request' },
    { code: 'INVALID_ARGS', message: '' },
    { code: 'INVALID_ARGS', message: 'x'.repeat(MAX_ERROR_MESSAGE_BYTES + 1) },
  ]) {
    assert.throws(
      () => parseEnvelope(JSON.stringify({ ok: false, command: 'rules', error }), 'rules'),
      (failure) => failure.code === 'PROTOCOL_MISMATCH',
    )
  }
})

test('provider timeout terminates and awaits a surviving tree after direct child settlement', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-dsh-timeout-'))
  t.after(() => fs.rm(temporary, { recursive: true, force: true }))
  let terminateCalls = 0
  let waitCalls = 0
  let fusedSignal
  let markWaitStarted
  let releaseWait
  let markTerminationStarted
  const waitStarted = new Promise((resolve) => { markWaitStarted = resolve })
  const waitReleased = new Promise((resolve) => { releaseWait = resolve })
  const terminationStarted = new Promise((resolve) => { markTerminationStarted = resolve })
  const subprocess = {
    spawn(spec) {
      fusedSignal = spec.signal
      return {
        pid: 456,
        collected: { stdout: reader(''), stderr: reader('') },
        done: Promise.resolve({ exitCode: 0, signal: null }),
        terminate() {
          terminateCalls += 1
          markTerminationStarted()
        },
        async waitForExit() {
          waitCalls += 1
          markWaitStarted()
          await waitReleased
          return true
        },
      }
    },
  }
  const runner = new CortexCliRunner(subprocess, { timeoutMs: 5 }, path.join(temporary, 'bin', 'cortex.mjs'))
  const caller = new AbortController()
  let settled = false
  const pending = runner.rules(agent(temporary), {}, caller.signal)
  pending.then(() => { settled = true }, () => { settled = true })

  await waitStarted
  await terminationStarted
  assert.equal(terminateCalls, 1)
  assert.equal(waitCalls, 1)
  assert.equal(settled, false)
  assert.equal(caller.signal.aborted, false)
  releaseWait()

  await assert.rejects(pending, (error) => error.code === 'TIMEOUT')
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0)
  assert.equal(getEventListeners(fusedSignal, 'abort').length, 0)
})

test('provider caller abort terminates and awaits a surviving tree after direct child settlement', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-dsh-late-cancel-'))
  t.after(() => fs.rm(temporary, { recursive: true, force: true }))
  let terminateCalls = 0
  let waitCalls = 0
  let fusedSignal
  let markWaitStarted
  let releaseWait
  let markTerminationStarted
  const waitStarted = new Promise((resolve) => { markWaitStarted = resolve })
  const waitReleased = new Promise((resolve) => { releaseWait = resolve })
  const terminationStarted = new Promise((resolve) => { markTerminationStarted = resolve })
  const subprocess = {
    spawn(spec) {
      fusedSignal = spec.signal
      return {
        pid: 789,
        collected: {
          stdout: reader(success('rules', { rules: [] })),
          stderr: reader(''),
        },
        done: Promise.resolve({ exitCode: 0, signal: null }),
        terminate() {
          terminateCalls += 1
          markTerminationStarted()
        },
        async waitForExit() {
          waitCalls += 1
          markWaitStarted()
          await waitReleased
          return true
        },
      }
    },
  }
  const cancellation = new AbortController()
  const runner = new CortexCliRunner(subprocess, {}, path.join(temporary, 'bin', 'cortex.mjs'))
  const pending = runner.rules(agent(temporary), {}, cancellation.signal)
  let settled = false
  pending.then(() => { settled = true }, () => { settled = true })

  await waitStarted
  cancellation.abort(new Error('caller canceled during tree wait'))
  await terminationStarted
  assert.equal(terminateCalls, 1)
  assert.equal(waitCalls, 1)
  assert.equal(settled, false)
  releaseWait()

  await assert.rejects(pending, (error) => error.code === 'CANCELED')
  assert.equal(getEventListeners(cancellation.signal, 'abort').length, 0)
  assert.equal(getEventListeners(fusedSignal, 'abort').length, 0)
})

test('tool definitions enforce exact agent identity and expose no workspace selector', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-dsh-tools-'))
  t.after(() => fs.rm(temporary, { recursive: true, force: true }))
  const owner = agent(temporary, 'owner')
  const calls = []
  const service = {
    search: async (...args) => { calls.push(args); return { ok: true, command: 'search', data: {} } },
    related: async () => ({ ok: true, command: 'related', data: {} }),
    impact: async () => ({ ok: true, command: 'impact', data: {} }),
    rules: async () => ({ ok: true, command: 'rules', data: {} }),
  }
  const tools = createCortexTools(owner, service)
  assert.deepEqual(tools.map((tool) => tool.name), [
    'cortex_search',
    'cortex_related',
    'cortex_impact',
    'cortex_rules',
  ])
  for (const tool of tools) {
    const names = Object.keys(tool.parameters.properties ?? {})
    assert.equal(names.some((key) => /cwd|root|workspace|executable|command/i.test(key)), false)
  }
  const signal = new AbortController().signal
  await tools[0].execute({ query: 'owner query' }, { agent: owner, signal })
  assert.equal(calls.length, 1)
  await assert.rejects(
    tools[0].execute({ query: 'foreign query' }, { agent: agent(temporary, 'foreign'), signal }),
    (error) => error.code === 'MISSING_EXECUTION_IDENTITY',
  )
})

test('public argument builders preserve CLI maxima and reject oversized or ambiguous input', () => {
  assert.deepEqual(buildImpactArgs({ entity_id: 'file:a', depth: 4, top_k: 20 }), [
    '--entity-id', 'file:a', '--depth', '4', '--top-k', '20',
  ])
  assert.throws(() => buildImpactArgs({ entity_id: 'file:a', query: 'also' }), /exactly one/)
  assert.throws(() => buildImpactArgs({ entity_id: 'file:a', depth: 5 }), /1 to 4/)
  assert.deepEqual(buildImpactArgs({ query: '--no-edges', top_k: 1 }), [
    '--top-k', '1', '--', '--no-edges',
  ])
  assert.deepEqual(buildImpactArgs({ query: '-leading value; $(literal)' }), [
    '--query', '-leading value; $(literal)',
  ])
  assert.throws(() => buildImpactArgs({ entity_id: '--query' }), /must not start with --/)
  assert.throws(() => buildRulesArgs({ scope: '--include-inactive' }), /must not start with --/)
  const subprocess = settledSubprocess(() => ({ stdout: success('search') }))
  const runner = new CortexCliRunner(subprocess, {}, path.join(os.tmpdir(), 'bin', 'cortex.mjs'))
  assert.throws(
    () => runner.search(agent(os.tmpdir()), { query: 'x'.repeat(MAX_QUERY_BYTES + 1) }, new AbortController().signal),
    /8192 UTF-8 bytes/,
  )
})

test('required mode guards only its exact agent and caches only successful readiness', async () => {
  const owner = agent(os.tmpdir(), 'owner')
  let readinessCalls = 0
  let readinessError = new Error('not ready')
  let readinessGate
  let preStep
  let disposed = 0
  const registrations = []
  const listeners = new Map()
  const service = {
    rules: async () => {
      readinessCalls += 1
      if (readinessError !== undefined) throw readinessError
      if (readinessGate !== undefined) await readinessGate
      return { ok: true, command: 'rules', data: {} }
    },
  }
  owner.ctx = {
    inject(_services, callback) {
      callback({
        cortexContext: service,
        tools: { register: (tool) => registrations.push(tool) },
        on(name, listener) { if (name === 'agent/pre-step') preStep = listener },
      })
      return { async dispose() { disposed += 1 } }
    },
  }
  const ctx = {
    agents: { list: () => [owner] },
    logger: { warn() {} },
    on(name, listener) { listeners.set(name, listener) },
    effect(callback) { this.cleanup = callback() },
  }
  applyTools(ctx, { required: true })
  assert.equal(registrations.length, 4)

  await assert.rejects(
    preStep({ agent: owner, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] })),
    /not ready/,
  )
  readinessError = undefined
  let releaseReadiness
  let markReadinessStarted
  const readinessStarted = new Promise((resolve) => { markReadinessStarted = resolve })
  readinessGate = new Promise((resolve) => {
    releaseReadiness = resolve
    markReadinessStarted()
  })
  const cancellation = new AbortController()
  const canceledReadiness = preStep(
    { agent: owner, signal: cancellation.signal },
    async () => ({ kind: 'enter', messages: [] }),
  )
  await readinessStarted
  cancellation.abort(new Error('readiness canceled'))
  releaseReadiness()
  await assert.rejects(canceledReadiness, (error) => error.code === 'CANCELED')
  readinessGate = undefined
  assert.deepEqual(
    await preStep({ agent: owner, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] })),
    { kind: 'enter', messages: [] },
  )
  await preStep({ agent: owner, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal(readinessCalls, 3)
  await assert.rejects(
    preStep({ agent: agent(os.tmpdir(), 'foreign'), signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] })),
    (error) => error.code === 'MISSING_EXECUTION_IDENTITY',
  )

  listeners.get('agent/disposed')({ agent: owner })
  await Promise.resolve()
  assert.equal(disposed, 1)
})

test('bundle resolves the exact direct Cortex dependency and loads all canonical skills', () => {
  assert.match(resolveCortexCliEntry(), /@danielblomma[\\/]cortex-mcp[\\/].*bin[\\/]cortex\.mjs$/)
  assert.deepEqual(loadPackagedSkills().map((skill) => skill.name), [
    'change-impact',
    'context-review',
    'pattern-review',
    'repo-research',
    'using-cortex',
  ])
})
