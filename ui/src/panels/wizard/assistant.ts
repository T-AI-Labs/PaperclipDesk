import { TEMPLATES } from '../catalog'
import { type Draft, type SkillRef, addAgent, addOwnAgent, possibleBosses, updateAgent } from './compose'

/// One round of the conversation: what the assistant asked, and what the user answered.
export interface Round {
  questions: string[]
  answers: string[]
}

export interface ProposedAgent {
  key: string
  /// A catalog agent as `template/slug`, or null for a new one.
  from: string | null
  name: string
  title: string
  reportsTo: string | null
  /// Catalog skills as `template/slug`; missing keeps a catalog agent's own.
  skills?: string[]
}

export interface Proposal {
  name: string
  description: string
  goals: string[]
  agents: ProposedAgent[]
}

export type Reply = { questions: string[] } | { proposal: Proposal }

// The descriptions only need to say what a skill is for; the whole catalog goes into every prompt.
const short = (text: string | null, length: number) => (text && text.length > length ? `${text.slice(0, length - 1)}…` : (text ?? ''))

const CATALOG_AGENTS = TEMPLATES.flatMap((template) => template.agents.map((agent) => `${template.id}/${agent.slug} | ${agent.name} | ${agent.title ?? ''} | ${agent.skills.join(', ')}`)).join('\n')
const CATALOG_SKILLS = TEMPLATES.flatMap((template) => template.skills.map((skill) => `${template.id}/${skill.slug} | ${skill.name} | ${short(skill.description, 110)}`)).join('\n')

/// The whole question for the assistant: the catalog, the conversation so far and the form of the answer.
export function prompt(description: string, rounds: Round[], language: string): string {
  const conversation = [`User: ${description}`, ...rounds.flatMap((round) => round.questions.map((question, index) => `Assistant asked: ${question}\nUser answered: ${round.answers[index]?.trim() || '(no answer)'}`))].join('\n')
  const mustPropose = rounds.length > 0
  return `Help the user set up a new company of AI agents in Paperclip. Its agents come from the catalog below or are new.
Write every question and every text you propose in ${language}; names and titles of catalog agents may stay as they are.

## Catalog agents (id | name | title | its skills)
${CATALOG_AGENTS}

## Catalog skills (id | name | what it is for)
${CATALOG_SKILLS}

## The conversation so far
${conversation}

## Your answer
${mustPropose ? '' : 'If something essential is missing for a good proposal, answer {"questions": ["…"]} with at most three short questions. Otherwise answer'}${mustPropose ? 'Answer' : ''} with a proposal:
{"proposal": {"name": "…", "description": "…", "goals": ["…"], "agents": [{"key": "short unique key", "from": "catalog agent id, or null for a new agent", "name": "…", "title": "…", "reportsTo": "key of its boss, or null for the one at the top", "skills": ["catalog skill id", "…"]}]}}
Rules: exactly one agent at the top. Prefer catalog agents and keep their skills unless the purpose needs others. Usually 3 to 12 agents, more only when the user asks. Use only ids that appear in the catalog. Give a new agent a clear title.`
}

const isText = (value: unknown): value is string => typeof value === 'string'

/// The assistant's JSON, taken from its answer even if it wrapped it in words or fences; null when it holds neither questions nor a proposal.
export function parse(answer: string): Reply | null {
  const start = answer.indexOf('{')
  const end = answer.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let value: unknown
  try {
    value = JSON.parse(answer.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const reply = value as { questions?: unknown; proposal?: Partial<Proposal> }
  if (Array.isArray(reply.questions) && reply.questions.some(isText)) return { questions: reply.questions.filter(isText).slice(0, 3) }
  const proposal = reply.proposal
  if (!proposal || !Array.isArray(proposal.agents) || proposal.agents.length === 0) return null
  const agents = proposal.agents
    .filter((agent): agent is ProposedAgent => typeof agent === 'object' && agent !== null && isText(agent.key))
    .map((agent) => ({ key: agent.key, from: isText(agent.from) ? agent.from : null, name: isText(agent.name) ? agent.name : '', title: isText(agent.title) ? agent.title : '', reportsTo: isText(agent.reportsTo) ? agent.reportsTo : null, skills: Array.isArray(agent.skills) ? agent.skills.filter(isText) : undefined }))
  return { proposal: { name: isText(proposal.name) ? proposal.name : '', description: isText(proposal.description) ? proposal.description : '', goals: Array.isArray(proposal.goals) ? proposal.goals.filter(isText) : [], agents } }
}

function catalogSkill(id: string): SkillRef | null {
  const [template, slug] = id.split('/')
  return TEMPLATES.find((known) => known.id === template)?.skills.some((skill) => skill.slug === slug) ? { template, slug } : null
}

/// Turns a proposal into a draft: catalog agents come with their files later, unknown ids become agents of the user's own,
/// and a boss that would make a circle is left out.
export function applyProposal(draft: Draft, proposal: Proposal): Draft {
  let next: Draft = { name: draft.name.trim() || proposal.name, description: proposal.description || draft.description, goals: proposal.goals.length ? proposal.goals : draft.goals, agents: [] }
  const slugs = new Map<string, string>()
  for (const proposed of proposal.agents) {
    const [templateId, agentSlug] = (proposed.from ?? '').split('/')
    const template = TEMPLATES.find((known) => known.id === templateId)
    const agent = template?.agents.find((known) => known.slug === agentSlug)
    const before = new Set(next.agents.map((known) => known.slug))
    next = template && agent ? addAgent(next, template, agent, null) : addOwnAgent(next, proposed.name || proposed.title || 'Agent', null)
    const added = next.agents.find((known) => !before.has(known.slug))!
    slugs.set(proposed.key, added.slug)
    const skills = proposed.skills?.map(catalogSkill).filter((skill) => skill !== null)
    const unique = skills && [...new Map(skills.map((skill) => [`${skill.template}/${skill.slug}`, skill])).values()]
    next = updateAgent(next, added.slug, { name: proposed.name || added.name, title: proposed.title || added.title, skills: unique ?? added.skills })
  }
  for (const proposed of proposal.agents) {
    const slug = slugs.get(proposed.key)
    const boss = proposed.reportsTo ? slugs.get(proposed.reportsTo) : undefined
    if (slug && boss && possibleBosses(next, slug).some((known) => known.slug === boss)) next = updateAgent(next, slug, { reportsTo: boss })
  }
  return next
}
