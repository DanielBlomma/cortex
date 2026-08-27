import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'

import { CortexCliRunner } from '../provider.mjs'

async function localRuntime() {
  const ctx = new Context()
  await ctx.plugin(SubprocessLocal)
  return ctx.subprocess
}

function agent(cwd) {
  return { id: cwd, session: { header: { cwd } } }
}

async function waitForFile(file, attempts = 300) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.access(file)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  assert.fail(`timed out waiting for child start marker: ${file}`)
}

async function writeSettledLeaderFixture(temporary) {
  const binDirectory = path.join(temporary, 'bin')
  await fs.mkdir(binDirectory)
  const entry = path.join(binDirectory, 'cortex.mjs')
  const pidFile = path.join(temporary, 'descendant.pid')
  const readyFile = path.join(temporary, 'descendant.ready')
  const descendant = [
    "import { writeFileSync } from 'node:fs'",
    "import path from 'node:path'",
    "process.on('SIGTERM', () => {})",
    "writeFileSync(path.join(process.cwd(), 'descendant.pid'), String(process.pid))",
    "writeFileSync(path.join(process.cwd(), 'descendant.ready'), 'ready')",
    "setInterval(() => {}, 1000)",
  ].join(';')
  await fs.writeFile(entry, [
    "import { spawn } from 'node:child_process'",
    "import { existsSync } from 'node:fs'",
    "import path from 'node:path'",
    `spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' })`,
    "const ready = path.join(process.cwd(), 'descendant.ready')",
    "const poll = setInterval(() => {",
    "  if (!existsSync(ready)) return",
    "  clearInterval(poll)",
    "  process.exit(0)",
    "}, 5)",
    '',
  ].join('\n'))
  return { entry, pidFile, readyFile }
}

function observingSubprocess(subprocess) {
  let handle
  return {
    spawn(spec) {
      handle = subprocess.spawn(spec)
      return handle
    },
    async directDone() {
      assert.notEqual(handle, undefined)
      return handle.done
    },
  }
}

async function readLivePid(pidFile) {
  const pid = Number(await fs.readFile(pidFile, 'utf8'))
  assert.equal(Number.isSafeInteger(pid), true)
  process.kill(pid, 0)
  return pid
}

function killIfAlive(pid) {
  if (!Number.isSafeInteger(pid)) return
  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

test('real Harness subprocess preserves all four exact package-owned Cortex CLI envelopes', async () => {
  const subprocess = await localRuntime()
  const runner = new CortexCliRunner(subprocess)
  const workspace = path.resolve(import.meta.dirname, '../../..')
  const owner = agent(workspace)
  const rules = await runner.rules(owner, {}, new AbortController().signal)
  const search = await runner.search(owner, {
    query: 'WO-057 session-scoped Cortex provider',
    top_k: 1,
  }, new AbortController().signal)
  const entityId = search.data.results?.[0]?.id
  assert.equal(typeof entityId, 'string')
  const [related, impact, flagLikeImpact] = await Promise.all([
    runner.related(owner, { entity_id: entityId, depth: 1 }, new AbortController().signal),
    runner.impact(owner, { entity_id: entityId, depth: 1, top_k: 1 }, new AbortController().signal),
    runner.impact(owner, { query: '--no-edges', top_k: 1 }, new AbortController().signal),
  ])

  for (const [command, result] of Object.entries({ rules, search, related, impact })) {
    assert.equal(result.ok, true)
    assert.equal(result.command, command)
    assert.equal(typeof result.data, 'object')
    assert.notEqual(result.data, null)
  }
  assert.equal(flagLikeImpact.ok, true)
  assert.equal(flagLikeImpact.command, 'impact')
  assert.ok(Array.isArray(rules.data.rules))
  assert.ok(rules.data.rules.some((rule) => rule.id === 'rule.context_budget'))
})

test('real Harness subprocess timeout kills a descendant process tree', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-dsh-tree-'))
  t.after(() => fs.rm(temporary, { recursive: true, force: true }))
  const binDirectory = path.join(temporary, 'bin')
  await fs.mkdir(binDirectory)
  const entry = path.join(binDirectory, 'cortex.mjs')
  const pidFile = path.join(temporary, 'descendant.pid')
  await fs.writeFile(entry, [
    "import { spawn } from 'node:child_process'",
    "import { writeFileSync } from 'node:fs'",
    "import path from 'node:path'",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
    "writeFileSync(path.join(process.cwd(), 'descendant.pid'), String(child.pid))",
    "setInterval(() => {}, 1000)",
    '',
  ].join('\n'))
  const subprocess = await localRuntime()
  const runner = new CortexCliRunner(subprocess, { timeoutMs: 2_000 }, entry)

  const pending = runner.rules(agent(temporary), {}, new AbortController().signal)
  await waitForFile(pidFile)
  await assert.rejects(
    pending,
    (error) => error.code === 'TIMEOUT',
  )
  const descendantPid = Number(await fs.readFile(pidFile, 'utf8'))
  assert.equal(Number.isSafeInteger(descendantPid), true)
  assert.throws(() => process.kill(descendantPid, 0), /ESRCH/)
})

test('caller cancellation kills the real Harness descendant process tree', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-dsh-cancel-'))
  t.after(() => fs.rm(temporary, { recursive: true, force: true }))
  const binDirectory = path.join(temporary, 'bin')
  await fs.mkdir(binDirectory)
  const entry = path.join(binDirectory, 'cortex.mjs')
  const pidFile = path.join(temporary, 'descendant.pid')
  await fs.writeFile(entry, [
    "import { spawn } from 'node:child_process'",
    "import { writeFileSync } from 'node:fs'",
    "import path from 'node:path'",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
    "writeFileSync(path.join(process.cwd(), 'descendant.pid'), String(child.pid))",
    "setInterval(() => {}, 1000)",
    '',
  ].join('\n'))
  const subprocess = await localRuntime()
  const runner = new CortexCliRunner(subprocess, {}, entry)
  const cancellation = new AbortController()
  const pending = runner.rules(agent(temporary), {}, cancellation.signal)
  await waitForFile(pidFile)
  cancellation.abort(new Error('caller canceled'))
  await assert.rejects(pending, (error) => error.code === 'CANCELED')
  const descendantPid = Number(await fs.readFile(pidFile, 'utf8'))
  assert.throws(() => process.kill(descendantPid, 0), /ESRCH/)
})

test('caller cancellation kills a TERM-trapping descendant after the leader exits zero', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-dsh-settled-cancel-'))
  const { entry, pidFile, readyFile } = await writeSettledLeaderFixture(temporary)
  let descendantPid
  t.after(async () => {
    killIfAlive(descendantPid)
    await fs.rm(temporary, { recursive: true, force: true })
  })
  const observed = observingSubprocess(await localRuntime())
  const runner = new CortexCliRunner(observed, {}, entry)
  const cancellation = new AbortController()
  const pending = runner.rules(agent(temporary), {}, cancellation.signal)

  await waitForFile(readyFile)
  assert.deepEqual(await observed.directDone(), { exitCode: 0, signal: null })
  descendantPid = await readLivePid(pidFile)
  cancellation.abort(new Error('caller canceled after leader exit'))

  await assert.rejects(pending, (error) => error.code === 'CANCELED')
  assert.throws(() => process.kill(descendantPid, 0), /ESRCH/)
})

test('provider timeout kills a TERM-trapping descendant after the leader exits zero', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-dsh-settled-timeout-'))
  const { entry, pidFile, readyFile } = await writeSettledLeaderFixture(temporary)
  let descendantPid
  t.after(async () => {
    killIfAlive(descendantPid)
    await fs.rm(temporary, { recursive: true, force: true })
  })
  const observed = observingSubprocess(await localRuntime())
  const runner = new CortexCliRunner(observed, { timeoutMs: 2_000 }, entry)
  const pending = runner.rules(agent(temporary), {}, new AbortController().signal)

  await waitForFile(readyFile)
  assert.deepEqual(await observed.directDone(), { exitCode: 0, signal: null })
  descendantPid = await readLivePid(pidFile)

  await assert.rejects(pending, (error) => error.code === 'TIMEOUT')
  assert.throws(() => process.kill(descendantPid, 0), /ESRCH/)
})
