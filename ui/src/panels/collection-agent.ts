// `npm run catalog` builds the snapshot's agents with these too, so an agent read live looks like one of the snapshot.

/// The paths the host fetches; anything else stays out of a collection.
export const PLAIN_PATH = /^[\w.-]+(\/[\w.-]+)*$/

const ACRONYMS = new Set(['ai', 'api', 'aws', 'ci', 'cd', 'cli', 'crm', 'css', 'dx', 'gcp', 'html', 'ios', 'llm', 'mcp', 'ml', 'php', 'qa', 'saas', 'sdk', 'seo', 'sql', 'sre', 'tdd', 'ui', 'ux'])

const plain = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : null)

const displayName = (slug: string) =>
  slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
    .join(' ')

/// The first sentence of a description, short enough for a table cell.
function firstSentence(description: string) {
  const sentence = /^(.{20,160}?[.!?])(\s|$)/.exec(description)?.[1] ?? description
  return sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence
}

export interface AgentEntry {
  slug: string
  name: string
  title: string
  group: string
  path: string
}

/// The agent in the file `path`, from the folder `group` and the file name `file`; none without a description.
export function agentEntry(path: string, group: string, file: string, name: unknown, description: unknown): AgentEntry | null {
  const about = plain(description)
  if (!about || !PLAIN_PATH.test(path)) return null
  return { slug: file, name: displayName(plain(name) ?? file), title: firstSentence(about), group: group.replace(/[-_]+/g, ' ').trim(), path }
}

/// The same agent turns up in several folders; a copy is left out, a different one by the same name gets its group in the slug.
export function distinctAgents<T extends { slug: string; group: string }>(agents: T[], content: (agent: T) => string): T[] {
  const slugs = new Map<string, string>()
  return agents.filter((agent) => {
    const known = slugs.get(agent.slug)
    if (known === content(agent)) return false
    if (known) agent.slug = `${agent.slug}-${agent.group.replace(/ /g, '-')}`
    slugs.set(agent.slug, content(agent))
    return true
  })
}
