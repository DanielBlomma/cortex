import test from 'node:test'
import assert from 'node:assert/strict'

import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

import { loadPackagedSkills } from '../skills.mjs'
import { createCortexTools } from '../tools.mjs'

const signal = new AbortController().signal

async function mount() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  return ctx
}

async function mintAgent(ctx, id, cwd) {
  const agent = { id, session: { header: { cwd } } }
  let scope
  await ctx.plugin(Object.assign((inner) => {
    scope = createScope(inner, agent)
    Object.defineProperty(agent, 'ctx', { value: scope.ctx })
  }, { inject: ['tools', 'systemPrompt', 'skills'] }))
  return { agent, scope }
}

function service(label) {
  const result = (command) => Promise.resolve({ ok: true, command, data: { label } })
  return {
    search: () => result('search'),
    related: () => result('related'),
    impact: () => result('impact'),
    rules: () => result('rules'),
  }
}

async function execute(ctx, agent, name, args) {
  return ctx.tools.execute({
    signal,
    callId: CallId(`${agent?.id ?? 'none'}-${name}`),
    name,
    arguments: args,
    ...(agent === undefined ? {} : { agent }),
  })
}

test('real Harness registries isolate same-name Cortex tools and skills by agent scope', async () => {
  const ctx = await mount()
  const first = await mintAgent(ctx, 'first', '/repo/first')
  const second = await mintAgent(ctx, 'second', '/repo/second')

  for (const tool of createCortexTools(first.agent, service('first'))) {
    first.scope.ctx.tools.register(tool)
  }
  for (const tool of createCortexTools(second.agent, service('second'))) {
    second.scope.ctx.tools.register(tool)
  }
  for (const skill of loadPackagedSkills()) {
    first.scope.ctx.skills.register(skill)
    second.scope.ctx.skills.register(skill)
  }

  assert.deepEqual(
    ctx.tools.schemas(first.agent).map((tool) => tool.name).filter((name) => name.startsWith('cortex_')),
    ['cortex_search', 'cortex_related', 'cortex_impact', 'cortex_rules'],
  )
  assert.deepEqual(
    ctx.tools.schemas(second.agent).map((tool) => tool.name).filter((name) => name.startsWith('cortex_')),
    ['cortex_search', 'cortex_related', 'cortex_impact', 'cortex_rules'],
  )
  assert.equal(ctx.tools.get('cortex_search'), undefined)

  const firstResult = await execute(ctx, first.agent, 'cortex_search', { query: 'same query' })
  const secondResult = await execute(ctx, second.agent, 'cortex_search', { query: 'same query' })
  const subjectless = await execute(ctx, undefined, 'cortex_search', { query: 'same query' })
  assert.equal(firstResult.value.data.label, 'first')
  assert.equal(secondResult.value.data.label, 'second')
  assert.equal(subjectless.isError, true)

  const firstSkills = await ctx.skills.snapshot({ scope: first.agent, cwd: '/repo/first', signal })
  const secondSkills = await ctx.skills.snapshot({ scope: second.agent, cwd: '/repo/second', signal })
  assert.equal(firstSkills.skills.length, 5)
  assert.equal(secondSkills.skills.length, 5)
  assert.equal((await ctx.skills.snapshot()).skills.length, 0)

  await first.scope.dispose()
  assert.equal(ctx.tools.get('cortex_search', first.agent), undefined)
  assert.notEqual(ctx.tools.get('cortex_search', second.agent), undefined)
  assert.equal((await ctx.skills.snapshot({ scope: first.agent })).skills.length, 0)
  assert.equal((await ctx.skills.snapshot({ scope: second.agent })).skills.length, 5)

  await second.scope.dispose()
})
