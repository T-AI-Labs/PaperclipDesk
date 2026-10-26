import { useEffect, useSyncExternalStore } from 'react'

import { type FoundSkills, type GithubFile, type TemplateAgent, type TemplateSkill, errorMessage, githubBranch, githubFiles } from '@/lib/client'
import { toast } from '@/lib/notifications'
import { t } from '@/i18n'

import { PLAIN_PATH, agentEntry, distinctAgents } from './collection-agent'
import snapshot from './collections.json'
import type { Files } from './wizard/compose'

/// An agent of a snapshot carries its SHA-256, one read from a branch the Git blob SHA the branch named.
export type CollectionAgent = TemplateAgent &
  GithubFile & {
    /// The folder it sits in, the collection's own category for it.
    group: string
  }

/// A skill's files carry their checksums like an agent, with paths inside the skill's folder.
export interface CollectionSkill extends TemplateSkill {
  group: string
  folder: string
  files: GithubFile[]
}

/// A repository of single agents and skills to put a company together from; it has no company of its own, so no teams
/// and one level. The texts are its own, in English.
export interface Collection {
  /// The repository as owner/name.
  id: string
  name: string
  description: string
  /// The commit the snapshot read, or the head of the branch a live collection was read from; the files come from there and nowhere else.
  commit: string
  /// For a collection read from its default branch at run time, the pattern of its agents' paths: the folder, then the file name.
  live?: string
  /// Its SPDX id; null for a repository found on GitHub that names none.
  license: string | null
  stars: number
  updated: string
  agents: CollectionAgent[]
  skills: CollectionSkill[]
}

/// The agents are Claude Code subagents and run with Claude Code in Paperclip too.
const SUBAGENT = { reportsTo: null, skills: [], adapterType: 'claude_local', model: null }

/// Read by `npm run catalog`.
const SNAPSHOT: Collection[] = snapshot.collections.map((collection) => ({
  ...collection,
  agents: collection.agents.map((agent) => ({ ...agent, ...SUBAGENT }) as CollectionAgent),
}))

export const COLLECTIONS_DATE = snapshot.date

/// The value of `key` in a Markdown file's front matter, as far as a name and a description need; `field` in github.rs reads it alike.
function frontMatter(markdown: string, key: string): string | null {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1]
  const lines = block?.split(/\r?\n/) ?? []
  const at = lines.findIndex((line) => line.startsWith(`${key}:`))
  if (at < 0) return null
  const first = lines[at].slice(key.length + 1).trim()
  const rest = lines.slice(at + 1)
  const end = rest.findIndex((line) => !/^[ \t]/.test(line) && line.trim() !== '')
  const value = first === '' || first.startsWith('>') || first.startsWith('|') ? rest.slice(0, end < 0 ? undefined : end).map((line) => line.trim()).join(' ') : first
  return value.trim().replace(/^["']+|["']+$/g, '').trim() || null
}

/// A live collection as its default branch has it now: an agent whose file did not change keeps the snapshot's texts, a new or
/// changed one is read, and one the branch dropped is gone.
async function readLive(collection: Collection, pattern: RegExp): Promise<Collection> {
  const branch = await githubBranch(collection.id)
  const before = new Map(collection.agents.map((agent) => [agent.path, agent]))
  const unchanged = (path: string, blob: string) => {
    const old = before.get(path)
    return old && 'blob' in old && old.blob === blob ? old : null
  }
  const matching = branch.files.flatMap((file) => {
    const match = pattern.exec(file.path)
    return match ? [{ ...file, group: match[1], file: match[2] }] : []
  })
  const changed = matching.filter((file) => !unchanged(file.path, file.blob) && PLAIN_PATH.test(file.path))
  const fetched = changed.length > 0 ? await githubFiles(collection.id, branch.commit, changed.map(({ path, blob }) => ({ path, blob }))) : {}
  const agents = matching.flatMap(({ path, blob, group, file }): CollectionAgent[] => {
    const old = unchanged(path, blob)
    if (old) return [{ ...old, slug: file }]
    const markdown = fetched[path]
    const entry = typeof markdown === 'string' ? agentEntry(path, group, file, frontMatter(markdown, 'name'), frontMatter(markdown, 'description')) : null
    return entry ? [{ ...entry, blob, ...SUBAGENT }] : []
  })
  return { ...collection, commit: branch.commit, updated: branch.date, agents: distinctAgents(agents, (agent) => ('blob' in agent ? agent.blob : agent.sha256)) }
}

let collections = SNAPSHOT
let started = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function put(collection: Collection) {
  collections = collections.some((known) => known.id === collection.id) ? collections.map((known) => (known.id === collection.id ? collection : known)) : [...collections, collection]
  for (const listener of listeners) listener()
}

async function readLiveCollections() {
  for (const collection of SNAPSHOT) {
    if (collection.live === undefined) continue
    try {
      put(await readLive(collection, new RegExp(collection.live)))
    } catch (e) {
      toast.error(t('{name} ließ sich nicht neu von GitHub lesen, es gilt der Stand der App: {error}', { name: collection.name, error: errorMessage(e) }))
    }
  }
}

/// Every collection; a live one as its default branch has it once GitHub answered, read once while the app runs.
export function useCollections(): Collection[] {
  useEffect(() => {
    if (started) return
    started = true
    void readLiveCollections()
  }, [])
  return useSyncExternalStore(subscribe, () => collections)
}

/// A skill's files go into the company package whole; a larger one, mostly fonts or media, stays out, as in `npm run catalog`.
const SKILL_LIMIT = 2 * 1024 * 1024

/// Reads a repository the search found from its default branch, every folder with a `SKILL.md` one skill, and keeps it
/// as a collection while the app runs, so the wizard offers its skills too.
export async function openSkillRepository(found: FoundSkills): Promise<Collection> {
  const branch = await githubBranch(found.repository)
  const plain = branch.files.filter((file) => PLAIN_PATH.test(file.path))
  const folders = plain.filter((file) => file.path.endsWith('/SKILL.md')).flatMap((skill) => {
    const folder = skill.path.slice(0, -'/SKILL.md'.length)
    const inside = plain.filter((file) => file.path.startsWith(`${folder}/`))
    return inside.reduce((size, file) => size + file.size, 0) > SKILL_LIMIT ? [] : [{ folder, skill, inside }]
  })
  const fetched = folders.length > 0 ? await githubFiles(found.repository, branch.commit, folders.map(({ skill }) => ({ path: skill.path, blob: skill.blob }))) : {}
  const slugs = new Set<string>()
  const skills = folders.flatMap(({ folder, skill, inside }): CollectionSkill[] => {
    const markdown = fetched[skill.path]
    const parts = folder.split('/')
    const slug = parts[parts.length - 1]
    if (typeof markdown !== 'string' || slugs.has(slug)) return []
    slugs.add(slug)
    return [{ slug, name: frontMatter(markdown, 'name') ?? slug, description: frontMatter(markdown, 'description'), group: (parts[parts.length - 2] ?? '').replace(/[-_]+/g, ' ').trim(), folder, files: inside.map((file) => ({ path: file.path.slice(folder.length + 1), blob: file.blob })) }]
  })
  const collection: Collection = { id: found.repository, name: found.repository, description: found.description, commit: branch.commit, license: found.license, stars: found.stars, updated: branch.date, agents: [], skills }
  put(collection)
  return collection
}

const stripFrontMatter = (markdown: string) => markdown.replace(/^---\r?\n[\s\S]*?\r?\n---[^\n]*\n?/, '').replace(/^\s*\n/, '')

/// Adds the files of the given agents and skills to `known` in the layout of a company package, fetching only what is
/// missing. An agent's subagent file becomes its `AGENTS.md`; the wizard writes its front matter.
export async function collectionFiles(collection: Collection, agents: readonly string[], skills: readonly string[], known: Files = {}): Promise<Files> {
  const files: Files = { ...known }
  const wantedAgents = collection.agents.filter((agent) => agents.includes(agent.slug) && !files[`agents/${agent.slug}/AGENTS.md`])
  const wantedSkills = collection.skills.filter((skill) => skills.includes(skill.slug) && !files[`skills/${skill.slug}/SKILL.md`])
  const pinned: GithubFile[] = [
    ...wantedAgents.map((agent) => ('blob' in agent ? { path: agent.path, blob: agent.blob } : { path: agent.path, sha256: agent.sha256 })),
    ...wantedSkills.flatMap((skill) => skill.files.map((file) => ({ ...file, path: `${skill.folder}/${file.path}` }))),
  ]
  const fetched = pinned.length > 0 ? await githubFiles(collection.id, collection.commit, pinned) : {}
  for (const agent of wantedAgents) {
    const file = fetched[agent.path]
    files[`agents/${agent.slug}/AGENTS.md`] = typeof file === 'string' ? stripFrontMatter(file) : ''
  }
  for (const skill of wantedSkills) for (const file of skill.files) files[`skills/${skill.slug}/${file.path}`] = fetched[`${skill.folder}/${file.path}`]
  const withAgents = collection.agents.filter((agent) => files[`agents/${agent.slug}/AGENTS.md`] !== undefined)
  files['.paperclip.yaml'] = ['schema: paperclip/v1', ...(withAgents.length ? ['agents:', ...withAgents.flatMap((agent) => [`  ${agent.slug}:`, '    adapter:', '      type: claude_local'])] : []), ''].join('\n')
  return files
}
