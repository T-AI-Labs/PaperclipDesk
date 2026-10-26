import type { PackageFile, TemplateAgent } from '@/lib/client'
import type { Template } from '../catalog'
import type { Collection } from '../collections'

export type Files = Record<string, PackageFile>

/// Where agents and skills come from: a catalog template or a collection, by its id.
export type Origin = Pick<Template, 'id' | 'name' | 'agents' | 'skills'>

/// A skill as an agent names it: one of a template's or collection's, or one the package only refers to, like Paperclip's own.
export interface SkillRef {
  template: string | null
  slug: string
}

export interface DraftAgent {
  /// Its slug in the new company, unique there.
  slug: string
  /// The agent of a template or collection it was taken from; null for one made in the wizard.
  origin: { template: string; slug: string } | null
  name: string
  title: string
  reportsTo: string | null
  skills: SkillRef[]
}

export interface Draft {
  name: string
  description: string
  goals: string[]
  agents: DraftAgent[]
}

export const EMPTY_DRAFT: Draft = { name: '', description: '', goals: [], agents: [] }

export function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  )
}

function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let index = 2; ; index++) if (!taken.has(`${base}-${index}`)) return `${base}-${index}`
}

function skillRefs(template: Origin, agent: TemplateAgent): SkillRef[] {
  const own = new Set(template.skills.map((skill) => skill.slug))
  return agent.skills.map((slug) => ({ template: own.has(slug) ? template.id : null, slug }))
}

/// Adds a whole template: its agents keep whom they report to among themselves, and its top reports to `boss`.
export function addTemplate(draft: Draft, template: Template, boss: string | null): Draft {
  const taken = new Set(draft.agents.map((agent) => agent.slug))
  const renamed = new Map<string, string>()
  for (const agent of template.agents) {
    const slug = uniqueSlug(agent.slug, taken)
    taken.add(slug)
    renamed.set(agent.slug, slug)
  }
  const added = template.agents.map((agent) => ({
    slug: renamed.get(agent.slug)!,
    origin: { template: template.id, slug: agent.slug },
    name: agent.name,
    title: agent.title ?? '',
    reportsTo: (agent.reportsTo && renamed.get(agent.reportsTo)) ?? boss,
    skills: skillRefs(template, agent),
  }))
  return { ...draft, agents: [...draft.agents, ...added] }
}

/// Adds one agent of a template or collection, reporting to `boss`.
export function addAgent(draft: Draft, template: Origin, agent: TemplateAgent, boss: string | null): Draft {
  const slug = uniqueSlug(agent.slug, new Set(draft.agents.map((known) => known.slug)))
  const added: DraftAgent = { slug, origin: { template: template.id, slug: agent.slug }, name: agent.name, title: agent.title ?? '', reportsTo: boss, skills: skillRefs(template, agent) }
  return { ...draft, agents: [...draft.agents, added] }
}

/// Adds an agent of the user's own, with no skills and no instructions beyond its role.
export function addOwnAgent(draft: Draft, name: string, boss: string | null): Draft {
  const slug = uniqueSlug(slugify(name), new Set(draft.agents.map((known) => known.slug)))
  return { ...draft, agents: [...draft.agents, { slug, origin: null, name, title: '', reportsTo: boss, skills: [] }] }
}

/// Removes an agent; whoever reported to it reports to its boss from now on.
export function removeAgent(draft: Draft, slug: string): Draft {
  const gone = draft.agents.find((agent) => agent.slug === slug)
  if (!gone) return draft
  return { ...draft, agents: draft.agents.filter((agent) => agent.slug !== slug).map((agent) => (agent.reportsTo === slug ? { ...agent, reportsTo: gone.reportsTo } : agent)) }
}

export function updateAgent(draft: Draft, slug: string, change: Partial<Pick<DraftAgent, 'name' | 'title' | 'reportsTo' | 'skills'>>): Draft {
  return { ...draft, agents: draft.agents.map((agent) => (agent.slug === slug ? { ...agent, ...change } : agent)) }
}

/// The agents `slug` may report to: anyone but itself and those below it, so the hierarchy never runs in a circle.
export function possibleBosses(draft: Draft, slug: string): DraftAgent[] {
  const below = new Set([slug])
  for (let grew = true; grew; ) {
    grew = false
    for (const agent of draft.agents) {
      if (agent.reportsTo !== null && below.has(agent.reportsTo) && !below.has(agent.slug)) {
        below.add(agent.slug)
        grew = true
      }
    }
  }
  return draft.agents.filter((agent) => !below.has(agent.slug))
}

/// The draft's agents in the form the org chart draws.
export function chartAgents(draft: Draft): TemplateAgent[] {
  return draft.agents.map((agent) => ({ slug: agent.slug, name: agent.name || agent.slug, title: agent.title || null, reportsTo: agent.reportsTo, skills: agent.skills.map((skill) => skill.slug) }))
}

/// The templates and collections whose files the package needs: those of its agents and of their skills.
export function usedTemplates(draft: Draft): string[] {
  const used = new Set<string>()
  for (const agent of draft.agents) {
    if (agent.origin) used.add(agent.origin.template)
    for (const skill of agent.skills) if (skill.template) used.add(skill.template)
  }
  return [...used].sort()
}

/// Drops the top-level `keys` from a front matter, with whatever belongs to them on the lines below.
function withoutKeys(frontMatter: string, keys: readonly string[]): string {
  const kept: string[] = []
  let dropping = false
  for (const line of frontMatter.split(/\r?\n/)) {
    const key = /^([^\s#-][^:]*):/.exec(line)?.[1]?.trim()
    if (key !== undefined) dropping = keys.includes(key)
    if (!dropping) kept.push(line)
  }
  return kept.join('\n').trim()
}

/// Sets top-level fields of a Markdown file's front matter and keeps the rest of it and the body as they were.
/// A JSON string or list is valid YAML, so the values need no YAML writer.
export function setFrontMatter(markdown: string, fields: Record<string, string | string[] | null>): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[^\n]*\n?/.exec(markdown)
  const body = (match ? markdown.slice(match[0].length) : markdown).replace(/^\s*\n/, '')
  const rest = match ? withoutKeys(match[1], Object.keys(fields)) : ''
  const own = Object.entries(fields)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
  return `---\n${[...own, rest].filter(Boolean).join('\n')}\n---\n\n${body}`
}

/// The settings of each agent in a `.paperclip.yaml`, as the lines below its slug.
export function agentSettings(yaml: string): Map<string, string[]> {
  const settings = new Map<string, string[]>()
  let inAgents = false
  let current: string[] | null = null
  for (const line of yaml.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inAgents = /^agents:\s*$/.test(line)
      current = null
      continue
    }
    if (!inAgents) continue
    const slug = /^ {2}(["']?)([^"'\s:]+)\1:\s*$/.exec(line)?.[2]
    if (slug !== undefined) {
      current = []
      settings.set(slug, current)
    } else if (current && (line.startsWith('    ') || line.trim() === '')) {
      current.push(line)
    }
  }
  return settings
}

/// Puts the draft together as a company package: the agents and skills come with their files from the templates they were
/// taken from, under their new slugs, and the package refers to each source for its licence.
export function compose(draft: Draft, files: Record<string, Files>, templates: readonly Template[], collections: readonly Collection[]): Files {
  const out: Files = {}
  const copy = (template: string, from: string, to: string, change?: (text: string) => string) => {
    for (const [path, file] of Object.entries(files[template] ?? {})) {
      if (!path.startsWith(`${from}/`)) continue
      const target = `${to}/${path.slice(from.length + 1)}`
      out[target] = change && typeof file === 'string' && /\/(AGENTS|SKILL)\.md$/.test(path) ? change(file) : file
    }
  }

  // A skill keeps its slug unless another template already brought a different one by that name.
  const skillSlugs = new Map<string, string>()
  const takenSkills = new Map<string, string>()
  for (const ref of draft.agents.flatMap((agent) => agent.skills)) {
    if (!ref.template) continue
    const key = `${ref.template}/${ref.slug}`
    if (skillSlugs.has(key)) continue
    const content = files[ref.template]?.[`skills/${ref.slug}/SKILL.md`]
    const holder = takenSkills.get(ref.slug)
    const same = holder !== undefined && JSON.stringify(files[holder]?.[`skills/${ref.slug}/SKILL.md`]) === JSON.stringify(content)
    const slug = holder === undefined || same ? ref.slug : `${ref.slug}-${ref.template}`
    if (holder === undefined) takenSkills.set(ref.slug, ref.template)
    skillSlugs.set(key, slug)
    if (!same) copy(ref.template, `skills/${ref.slug}`, `skills/${slug}`, slug === ref.slug ? undefined : (text) => setFrontMatter(text, { name: slug }))
  }
  const skillSlug = (ref: SkillRef) => (ref.template ? (skillSlugs.get(`${ref.template}/${ref.slug}`) ?? ref.slug) : ref.slug)

  const settings = new Map<string, Map<string, string[]>>()
  const settingsOf = (template: string) => {
    if (!settings.has(template)) {
      const yaml = files[template]?.['.paperclip.yaml']
      settings.set(template, agentSettings(typeof yaml === 'string' ? yaml : ''))
    }
    return settings.get(template)!
  }
  const agentYaml: string[] = []
  for (const agent of draft.agents) {
    const fields = { name: agent.name || agent.slug, title: agent.title || null, reportsTo: agent.reportsTo, skills: [...new Set(agent.skills.map(skillSlug))] }
    if (agent.origin) {
      copy(agent.origin.template, `agents/${agent.origin.slug}`, `agents/${agent.slug}`, (text) => setFrontMatter(text, fields))
      const own = settingsOf(agent.origin.template).get(agent.origin.slug)
      if (own?.length) agentYaml.push(`  ${agent.slug}:`, ...own)
    }
    if (!out[`agents/${agent.slug}/AGENTS.md`]) {
      const role = agent.title || agent.name || agent.slug
      out[`agents/${agent.slug}/AGENTS.md`] = setFrontMatter(`You are the ${role} of ${draft.name}.\n`, fields)
    }
  }
  out['.paperclip.yaml'] = `schema: paperclip/v1\n${agentYaml.length ? `agents:\n${agentYaml.join('\n')}\n` : ''}`

  const companySlug = slugify(draft.name) === 'agent' ? 'company' : slugify(draft.name)
  out['COMPANY.md'] = setFrontMatter(`${draft.description}\n`, { name: draft.name, description: draft.description || null, slug: companySlug, schema: 'agentcompanies/v1', version: '1.0.0', goals: draft.goals.length ? draft.goals : null })
  const used = usedTemplates(draft)
  const sources = used.map((id) => templates.find((template) => template.id === id)).filter((template) => template !== undefined)
  const taken = used.map((id) => collections.find((collection) => collection.id === id)).filter((collection) => collection !== undefined)
  out['README.md'] = [
    `# ${draft.name}`,
    '',
    draft.description,
    '',
    ...(sources.length
      ? ['Put together with PaperclipDesk from these templates of https://github.com/paperclipai/companies (MIT):', '', ...sources.map((template) => `- ${template.name} (${template.id}), based on https://github.com/${template.source}`)]
      : []),
    ...(taken.length ? ['', 'Agents and skills taken from these collections:', '', ...taken.map((collection) => `- ${collection.name}, https://github.com/${collection.id} at ${collection.commit} (${collection.license ?? 'no licence named'})`)] : []),
    '',
  ].join('\n')
  return out
}
