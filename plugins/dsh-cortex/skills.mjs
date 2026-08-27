import { readFileSync } from 'node:fs'

export const name = 'cortex-skills'
export const inject = ['agents', 'skills']

const SKILL_NAMES = Object.freeze([
  'change-impact',
  'context-review',
  'pattern-review',
  'repo-research',
  'using-cortex',
])

export function loadPackagedSkills() {
  return SKILL_NAMES.map((expectedName) => {
    const url = new URL(`./skills/${expectedName}/SKILL.md`, import.meta.url)
    const text = readFileSync(url, 'utf8')
    return parseSkill(text, expectedName)
  })
}

export function apply(ctx) {
  const definitions = loadPackagedSkills()
  const fibers = new Map()
  const pendingDisposals = new Set()

  const install = (agent) => {
    if (fibers.has(agent)) return
    const fiber = agent.ctx.inject(['skills'], (scope) => {
      for (const definition of definitions) scope.skills.register(definition)
    })
    fibers.set(agent, fiber)
  }

  const dispose = (agent) => {
    const fiber = fibers.get(agent)
    if (fiber === undefined) return
    fibers.delete(agent)
    const task = fiber.dispose().catch(() => {
      ctx.logger.warn('cortex-skills: agent contribution cleanup failed')
    })
    pendingDisposals.add(task)
    void task.finally(() => pendingDisposals.delete(task))
  }

  for (const agent of ctx.agents.list()) install(agent)
  ctx.on('agent/created', ({ agent }) => install(agent))
  ctx.on('agent/disposed', ({ agent }) => dispose(agent))
  ctx.effect(() => async () => {
    const active = [...fibers.values()]
    fibers.clear()
    await Promise.all([...active.map((fiber) => fiber.dispose()), ...pendingDisposals])
  }, 'cortex-skills: agent contributions')
}

function parseSkill(text, expectedName) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(text)
  if (match === null) throw new Error(`cortex-skills: ${expectedName} has invalid frontmatter`)
  const metadata = new Map()
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    metadata.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  const skillName = metadata.get('name')
  const description = metadata.get('description')
  if (skillName !== expectedName || typeof description !== 'string' || description.length === 0) {
    throw new Error(`cortex-skills: ${expectedName} metadata mismatch`)
  }
  return Object.freeze({
    name: skillName,
    description,
    source: 'bundled',
    provider: 'dsh-cortex',
    content: match[2],
  })
}

export default { name, inject, apply }
