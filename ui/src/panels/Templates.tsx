import { useEffect, useMemo, useState } from 'react'
import { Bot, Building2, ExternalLink, FileArchive, FolderGit2, FolderOpen, LoaderCircle, Package, Search, Sparkles, Star } from 'lucide-react'

import DataTable, { type Column, type Filter } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type FoundSkills, type FoundTemplate, type ProjectLink, type Snapshot, errorMessage, githubAccess, openProjectLink, readCompanyPackage, searchSkills, searchTemplates, setGithubToken } from '@/lib/client'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'
import { CATALOG_DATE, CLIPMART_CATEGORIES, TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from './catalog'
import { CLIPMART_DATE, CLIPMART_TEMPLATES } from './clipmart'
import { type Collection, COLLECTIONS_DATE, openSkillRepository, useCollections } from './collections'
import { levels } from './hierarchy'
import { CLIPMART_ICON, ownerIcon } from './icons'
import TemplateDetails, { type Picked } from './TemplateDetails'

/// What a row offers: a whole company, or agents and skills to put one together from.
type Kind = 'company' | 'agents' | 'skills'

/// One line of the table: a company of the catalog, of Clipmart or found on GitHub, or a collection; what a source does not tell is null.
interface Row {
  key: string
  /// A repository with skills the search found is read only when it is picked.
  picked: Picked | { kind: 'skills'; found: FoundSkills }
  kinds: Kind[]
  name: string
  description: string
  /// The avatar of the repository's owner, or the site's own icon.
  icon: string | null
  /// Where it comes from, as the badge beside the name shows it.
  source: string
  category: TemplateCategory | null
  /// Clipmart counts no stars.
  stars: number | null
  updated: string
  agents: number
  skills: number
  teams: number
  levels: number | null
  /// Everything the search looks into: also the agents, teams and skills with their descriptions where they are known.
  text: string
}

const CATALOG_REPOSITORY = 'paperclipai/companies'
const CLIPMART_SITE = 'clipmart.ai'

const CATALOG_ROWS: Row[] = TEMPLATES.map((template) => ({
  key: `catalog:${template.id}`,
  picked: { kind: 'catalog', template },
  kinds: ['company'],
  name: template.name,
  description: template.description,
  icon: ownerIcon(template.source),
  source: CATALOG_REPOSITORY,
  category: template.category,
  stars: template.stars,
  updated: template.sourceUpdated,
  agents: template.agents.length,
  skills: template.skills.length,
  teams: template.teams.length,
  levels: levels(template.agents),
  text: [
    template.name,
    template.description,
    ...template.goals,
    ...template.agents.flatMap((agent) => [agent.name, agent.title ?? '']),
    ...template.teams.flatMap((team) => [team.name, team.description ?? '']),
    ...template.skills.flatMap((skill) => [skill.name, skill.description ?? '']),
  ]
    .join('\n')
    .toLocaleLowerCase(),
}))

const CLIPMART_ROWS: Row[] = CLIPMART_TEMPLATES.map((template) => ({
  key: `clipmart:${template.id}`,
  picked: { kind: 'clipmart', template },
  kinds: ['company'],
  name: template.name,
  description: template.tagline ? `${template.tagline} ${template.description}` : template.description,
  icon: CLIPMART_ICON,
  source: CLIPMART_SITE,
  category: template.category,
  stars: null,
  updated: template.created,
  agents: template.agents.length,
  skills: template.skills.length,
  teams: 0,
  levels: levels(template.agents),
  text: [template.name, template.tagline ?? '', template.description, template.author, ...template.tags, ...template.goals, ...template.agents.flatMap((agent) => [agent.name, ...agent.responsibilities]), ...template.skills].join('\n').toLocaleLowerCase(),
}))

const collectionRow = (collection: Collection): Row => ({
  key: `collection:${collection.id}`,
  picked: { kind: 'collection', collection },
  kinds: [...(collection.agents.length ? ['agents' as const] : []), ...(collection.skills.length ? ['skills' as const] : [])],
  name: collection.name,
  description: collection.description,
  icon: ownerIcon(collection.id),
  source: collection.id,
  category: null,
  stars: collection.stars,
  updated: collection.updated,
  agents: collection.agents.length,
  skills: collection.skills.length,
  teams: 0,
  // Single agents report to no one among themselves.
  levels: collection.agents.length ? 1 : null,
  text: [
    collection.name,
    collection.description,
    collection.id,
    ...collection.agents.flatMap((agent) => [agent.name, agent.title ?? '', agent.group]),
    ...collection.skills.flatMap((skill) => [skill.name, skill.description ?? '', skill.group]),
  ]
    .join('\n')
    .toLocaleLowerCase(),
})

/// Copies of catalog packages fill much of what GitHub finds; the table shows the original only.
const CATALOG_SLUGS = new Set(TEMPLATES.map((template) => template.id))

function foundRow(found: FoundTemplate): Row {
  return {
    key: `github:${found.url}`,
    picked: { kind: 'github', found },
    kinds: ['company'],
    name: found.name,
    description: found.description,
    icon: found.avatar,
    source: found.repository,
    category: null,
    stars: found.stars,
    updated: found.updated,
    agents: found.agents.length,
    skills: found.skills,
    teams: found.teams,
    levels: levels(found.agents),
    text: [found.name, found.description, found.repository].join('\n').toLocaleLowerCase(),
  }
}

function foundSkillsRow(found: FoundSkills): Row {
  return {
    key: `skills:${found.repository}`,
    picked: { kind: 'skills', found },
    kinds: ['skills'],
    name: found.repository.split('/')[1],
    description: found.description,
    icon: found.avatar,
    source: found.repository,
    category: null,
    stars: found.stars,
    updated: found.updated,
    agents: 0,
    skills: found.skills,
    teams: 0,
    levels: null,
    text: [found.repository, found.description].join('\n').toLocaleLowerCase(),
  }
}

// The page's language, which the app sets, formats numbers and dates the way its readers expect.
const stars = (count: number) => new Intl.NumberFormat(document.documentElement.lang, { notation: 'compact', maximumFractionDigits: 1 }).format(count)
const day = (date: string) => new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(date))
const dollars = (amount: number) => new Intl.NumberFormat(document.documentElement.lang, { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(amount)
const CATEGORIES = [...TEMPLATE_CATEGORIES, ...CLIPMART_CATEGORIES]
const categoryLabel = (row: Row) => {
  if (row.picked.kind === 'collection') return t('Sammlung')
  const known = CATEGORIES.find(({ id }) => id === row.category)
  return known ? t(known.label) : 'GitHub'
}

/// The icon of a row's source, or one for what it offers when the source has none.
function SourceIcon({ icon, kinds, className }: { icon: string | null; kinds: Kind[]; className?: string }) {
  if (icon) return <img src={icon} alt="" className={cn('size-8 shrink-0 rounded-md border bg-muted object-cover', className)} />
  const Fallback = kinds.includes('company') ? Building2 : kinds.includes('agents') ? Bot : Sparkles
  return (
    <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground', className)}>
      <Fallback aria-hidden className="size-4" />
    </span>
  )
}

/// What a template holds and how popular it is, in one line.
function Summary({ row }: { row: Row }) {
  const clipmart = row.picked.kind === 'clipmart' ? row.picked.template : null
  const collection = row.picked.kind === 'collection' ? row.picked.collection : null
  return (
    <>
      <span>{row.skills === 1 ? t('{agents} Agenten · 1 Skill', { agents: row.agents }) : t('{agents} Agenten · {skills} Skills', { agents: row.agents, skills: row.skills })}</span>
      {row.teams > 0 && <span>{row.teams === 1 ? t('1 Team') : t('{count} Teams', { count: row.teams })}</span>}
      {row.levels !== null && row.levels > 1 && <span>{t('{count} Ebenen', { count: row.levels })}</span>}
      {row.stars !== null && (
        <span className="flex items-center gap-1" title={t('Sterne des Quell-Repos auf GitHub')}>
          <Star aria-hidden className="size-3" /> {stars(row.stars)}
        </span>
      )}
      {collection && <span>{collection.license}</span>}
      {clipmart ? (
        <>
          <span>{t('Von {author}', { author: clipmart.author })}</span>
          <span>{t('~{cost} KI-Kosten und {low} bis {high} Umsatz im Monat, geschätzt von Clipmart', { cost: dollars(clipmart.monthlyCost), low: dollars(clipmart.monthlyRevenue[0]), high: dollars(clipmart.monthlyRevenue[1]) })}</span>
          {row.updated && <span>{t('Auf Clipmart seit {date}', { date: day(row.updated) })}</span>}
        </>
      ) : (
        row.updated && <span>{t('Quelle aktualisiert {date}', { date: day(row.updated) })}</span>
      )}
    </>
  )
}

// Built at render time, so the headers follow the language the app speaks right now.
function columns(): Column<Row>[] {
  return [
    {
      id: 'name',
      header: t('Vorlage'),
      sort: (row) => row.name,
      className: 'min-w-80',
      cell: (row) => (
        <div className="flex min-w-0 items-start gap-3">
          <SourceIcon icon={row.icon} kinds={row.kinds} className="mt-0.5" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2 font-medium">
              <span className="truncate">{row.name}</span>
              <span className="truncate rounded-full border px-1.5 text-[11px] font-normal text-muted-foreground">{row.source}</span>
            </span>
            <span className="line-clamp-2 text-xs text-muted-foreground">{row.description}</span>
          </div>
        </div>
      ),
    },
    { id: 'category', header: t('Kategorie'), sort: categoryLabel, className: 'whitespace-nowrap', cell: (row) => <span className="rounded-full border px-2 py-0.5 text-xs">{categoryLabel(row)}</span> },
    { id: 'agents', header: t('Agenten'), sort: (row) => row.agents, descFirst: true, align: 'end', cell: (row) => row.agents || '–' },
    { id: 'skills', header: t('Skills'), sort: (row) => row.skills, descFirst: true, align: 'end', cell: (row) => row.skills || '–' },
    { id: 'teams', header: t('Teams'), sort: (row) => row.teams, descFirst: true, align: 'end', cell: (row) => row.teams || '–' },
    { id: 'levels', header: t('Ebenen'), sort: (row) => row.levels, descFirst: true, align: 'end', cell: (row) => row.levels ?? '–' },
    {
      id: 'stars',
      header: t('Sterne'),
      sort: (row) => row.stars,
      descFirst: true,
      align: 'end',
      cell: (row) =>
        row.stars === null ? (
          '–'
        ) : (
          <span className="inline-flex items-center gap-1" title={t('Sterne des Quell-Repos auf GitHub')}>
            <Star aria-hidden className="size-3 text-muted-foreground" /> {stars(row.stars)}
          </span>
        ),
    },
    { id: 'updated', header: t('Aktualisiert'), sort: (row) => row.updated || null, descFirst: true, align: 'end', className: 'whitespace-nowrap', cell: (row) => (row.updated ? day(row.updated) : '–') },
  ]
}

/// The day a number of months ago, as YYYY-MM-DD like the rows' dates.
function monthsAgo(months: number) {
  const day = new Date()
  day.setUTCMonth(day.getUTCMonth() - months)
  return day.toISOString().slice(0, 10)
}

function filters(collections: Collection[]): Filter<Row>[] {
  const within = (months: number) => (row: Row) => row.updated !== '' && row.updated >= monthsAgo(months)
  return [
    {
      id: 'source',
      label: t('Quelle'),
      column: 'name',
      options: [
        { id: 'paperclip', label: CATALOG_REPOSITORY, test: (row) => row.picked.kind === 'catalog' },
        { id: 'clipmart', label: CLIPMART_SITE, test: (row) => row.picked.kind === 'clipmart' },
        ...collections.map((collection) => ({ id: collection.id, label: collection.id, test: (row: Row) => row.picked.kind === 'collection' && row.picked.collection.id === collection.id })),
        { id: 'github', label: t('Andere Repos auf GitHub'), test: (row) => row.picked.kind === 'github' || row.picked.kind === 'skills' },
      ],
    },
    { id: 'category', label: t('Kategorie'), column: 'category', options: CATEGORIES.map(({ id, label }) => ({ id, label: t(label), test: (row: Row) => row.category === id })) },
    {
      id: 'size',
      label: t('Größe'),
      column: 'agents',
      options: [
        { id: 'small', label: t('Bis 10 Agenten'), test: (row) => row.agents <= 10 },
        { id: 'medium', label: t('11 bis 50'), test: (row) => row.agents > 10 && row.agents <= 50 },
        { id: 'large', label: t('Über 50'), test: (row) => row.agents > 50 },
      ],
    },
    {
      id: 'skills',
      label: t('Skills'),
      column: 'skills',
      options: [
        { id: 'with', label: t('Mit Skills'), test: (row) => row.skills > 0 },
        { id: 'without', label: t('Ohne Skills'), test: (row) => row.skills === 0 },
      ],
    },
    { id: 'teams', label: t('Teams'), column: 'teams', options: [{ id: 'with', label: t('Mit Teams'), test: (row) => row.teams > 0 }] },
    { id: 'levels', label: t('Ebenen'), column: 'levels', options: [{ id: 'hierarchy', label: t('Mit Hierarchie'), test: (row) => (row.levels ?? 0) > 1 }] },
    {
      id: 'stars',
      label: t('Sterne'),
      column: 'stars',
      single: true,
      options: [10, 100, 1000, 10000].map((count) => ({ id: String(count), label: t('Ab {count} Sternen', { count: stars(count) }), test: (row: Row) => (row.stars ?? 0) >= count })),
    },
    {
      id: 'updated',
      label: t('Aktualisiert'),
      column: 'updated',
      single: true,
      options: [
        { id: 'month', label: t('Letzter Monat'), test: within(1) },
        { id: 'half-year', label: t('Letzte 6 Monate'), test: within(6) },
        { id: 'year', label: t('Letztes Jahr'), test: within(12) },
        { id: 'older', label: t('Älter als ein Jahr'), test: (row) => row.updated !== '' && !within(12)(row) },
      ],
    },
  ]
}

const open = (link: ProjectLink) => void openProjectLink(link).catch((e: unknown) => toast.error(errorMessage(e)))

/// A package of the user's own, e.g. a Clipmart download, opened as a ZIP file or a folder.
function OwnPackage({ onOpen }: { onOpen: (picked: Picked) => void }) {
  const [reading, setReading] = useState(false)

  function read(archive: boolean) {
    setReading(true)
    readCompanyPackage(archive)
      .then((files) => {
        if (!files) return
        const company = typeof files['COMPANY.md'] === 'string' ? files['COMPANY.md'] : ''
        const name = /^name:\s*["']?(.+?)["']?\s*$/m.exec(company)?.[1] ?? t('Eigenes Paket')
        onOpen({ kind: 'package', name, files })
      })
      .catch((e: unknown) => toast.error(errorMessage(e)))
      .finally(() => setReading(false))
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={reading}>
          {reading ? <LoaderCircle className="animate-spin" /> : <Package />} {t('Eigenes Paket')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-2 p-3">
        <span className="text-xs text-muted-foreground">{t('Ein Firmenpaket als ZIP oder Ordner, etwa von Clipmart heruntergeladen. Paperclip prüft es vor dem Import.')}</span>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={reading} onClick={() => read(true)}>
            <FileArchive /> {t('ZIP-Datei …')}
          </Button>
          <Button size="sm" variant="outline" disabled={reading} onClick={() => read(false)}>
            <FolderOpen /> {t('Ordner …')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/// The search on GitHub: a token first, then the packages it finds join the table.
function GithubSearch({ query, searching, searched, onSearch, onStored }: { query: string; searching: boolean; searched: boolean; onSearch: () => void; onStored: () => void }) {
  const [access, setAccess] = useState<'stored' | 'cli' | null | undefined>(undefined)
  const [token, setToken] = useState('')

  useEffect(() => {
    githubAccess()
      .then(setAccess)
      .catch(() => setAccess(null))
  }, [])

  function store(next: string) {
    setGithubToken(next)
      .then(githubAccess)
      .then((access) => {
        setAccess(access)
        setToken('')
        if (next.trim()) onStored()
      })
      .catch((e: unknown) => toast.error(errorMessage(e)))
  }

  if (access === undefined) return null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" title={t('Weitere Vorlagen auf GitHub')}>
          {searching ? <LoaderCircle className="animate-spin" /> : <FolderGit2 />} GitHub
          {!access && <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-2 p-3">
        <span className="text-sm font-medium">{t('Weitere Vorlagen auf GitHub')}</span>
        {access ? (
          <>
            <span className="text-xs text-muted-foreground">{searched ? t('Treffer auf GitHub sind in der Liste.') : t('Auf GitHub nach weiteren Vorlagen suchen, mit dem Suchbegriff oben.')}</span>
            {access === 'cli' && <span className="text-xs text-muted-foreground">{t('Die Suche nutzt die Anmeldung der GitHub CLI.')}</span>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={searching} onClick={onSearch}>
                {searching ? <LoaderCircle className="animate-spin" /> : <Search />} {query.trim() ? t('Auf GitHub suchen: {query}', { query: query.trim() }) : t('Auf GitHub suchen')}
              </Button>
              {access === 'stored' && (
                <Button size="sm" variant="ghost" onClick={() => store('')}>
                  {t('Token entfernen')}
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">{t('Für die Suche braucht GitHub ein Token. Lesezugriff auf öffentliche Repos reicht; Windows bewahrt es in der Anmeldeinformationsverwaltung auf.')}</span>
            <span className="text-xs text-muted-foreground">{t('Mit der GitHub CLI braucht es kein Token hier: einmal „gh auth login“ ausführen.')}</span>
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                store(token)
              }}
            >
              <Input type="password" autoComplete="off" aria-label={t('GitHub-Token')} placeholder={t('GitHub-Token')} value={token} onChange={(event) => setToken(event.target.value)} className="font-mono" />
              <Button type="submit" size="sm" disabled={token.trim() === ''}>
                {t('Speichern')}
              </Button>
            </form>
            <Button variant="link" size="sm" className="self-start px-0" onClick={() => open('github_tokens')}>
              <ExternalLink /> {t('Token auf GitHub erstellen')}
            </Button>
          </>
        )}
        <Button variant="link" size="sm" className="self-start px-0" title={t('Die Website von GitHub findet auch Repos, die die Suche der App nicht kennt; ihre Codesuche verlangt eine Anmeldung.')} onClick={() => open({ github_search: query })}>
          <ExternalLink /> {t('Im Browser suchen')}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function Catalog({ onPick, onOpen }: { onPick: (row: Row, picked: Picked) => void; onOpen: (picked: Picked) => void }) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<Kind | 'all'>('all')
  const [found, setFound] = useState<FoundTemplate[] | null>(null)
  const [foundSkills, setFoundSkills] = useState<FoundSkills[]>([])
  const [searching, setSearching] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)

  // GitHub allows few code searches a minute, so the skills follow the packages instead of running beside them.
  const search = (words: string) => searchTemplates(words).then((packages) => {
    setFound(packages)
    return searchSkills(words).then(setFoundSkills)
  })

  const searchGithub = (words = query) => {
    setSearching(true)
    search(words)
      .catch((e: unknown) => toast.error(errorMessage(e)))
      .finally(() => setSearching(false))
  }

  function pick(row: Row) {
    if (row.picked.kind !== 'skills') return onPick(row, row.picked)
    const { found } = row.picked
    setOpening(found.repository)
    openSkillRepository(found)
      .then((collection) => onPick(collectionRow(collection), { kind: 'collection', collection }))
      .catch((e: unknown) => toast.error(errorMessage(e)))
      .finally(() => setOpening(null))
  }

  // With a token at hand, GitHub's packages join the table right away instead of waiting for a search.
  useEffect(() => {
    githubAccess()
      .then((access) => {
        if (!access) return
        setSearching(true)
        return search('')
      })
      .catch((e: unknown) => toast.error(errorMessage(e)))
      .finally(() => setSearching(false))
  }, [])

  const collections = useCollections()
  const collectionRows = useMemo(() => collections.map(collectionRow), [collections])
  const known = new Set(collections.map((collection) => collection.id.toLowerCase()))
  const rows = [
    ...CATALOG_ROWS,
    ...CLIPMART_ROWS,
    ...collectionRows,
    ...(found ?? []).filter((hit) => !CATALOG_SLUGS.has(hit.slug)).map(foundRow),
    ...foundSkills.filter((hit) => !known.has(hit.repository.toLowerCase())).map(foundSkillsRow),
  ]
  const count = (wanted: Kind) => rows.filter((row) => row.kinds.includes(wanted)).length
  const kinds: { id: Kind | 'all'; label: string; count: number }[] = [
    { id: 'all', label: t('Alle'), count: rows.length },
    { id: 'company', label: t('Firmen'), count: count('company') },
    { id: 'agents', label: t('Agenten'), count: count('agents') },
    { id: 'skills', label: t('Skills'), count: count('skills') },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={kind} onValueChange={(next) => next && setKind(next as Kind | 'all')} aria-label={t('Art')}>
          {kinds.map((option) => (
            <ToggleGroupItem key={option.id} value={option.id} className="gap-1.5 px-3">
              {option.label}
              <span className="text-xs text-muted-foreground tabular-nums">{option.count}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {kind !== 'company' && kind !== 'all' && <span className="text-xs text-muted-foreground">{t('Einzelne Agenten und Skills ohne eigene Firma, zum Zusammenstellen einer neuen.')}</span>}
        {opening && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <LoaderCircle aria-hidden className="size-3 animate-spin" /> {t('Liest {template} …', { template: opening })}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <OwnPackage onOpen={onOpen} />
          <GithubSearch query={query} searching={searching} searched={found !== null} onSearch={() => searchGithub()} onStored={() => searchGithub('')} />
        </div>
      </div>
      <DataTable
        rows={kind === 'all' ? rows : rows.filter((row) => row.kinds.includes(kind))}
        rowKey={(row) => row.key}
        columns={columns()}
        filters={filters(collections)}
        text={(row) => row.text}
        searchLabel={t('Vorlage, Agent oder Skill suchen …')}
        initialSort={{ column: 'stars', desc: true }}
        query={query}
        onQueryChange={setQuery}
        onSubmitQuery={() => found !== null && searchGithub()}
        onRowClick={pick}
        className="min-h-[24rem] flex-1"
      />
      <p className="text-xs text-muted-foreground">
        {t('Aus dem Katalog github.com/paperclipai/companies, MIT-Lizenz.')} {t('Sterne und Daten von GitHub, Stand {date}.', { date: day(CATALOG_DATE) })}{' '}
        {t('Dazu die kostenlosen Vorlagen von clipmart.ai, Stand {date}; Kosten und Umsätze schätzt die Seite.', { date: day(CLIPMART_DATE) })}{' '}
        {t('Sammlungen von Agenten und Skills auf GitHub unter ihrer eigenen Lizenz, Stand {date}.', { date: day(COLLECTIONS_DATE) })}
        {found !== null && ` ${t('Treffer auf GitHub stammen von ihren Autoren; vor dem Import ansehen.')}`}
      </p>
    </div>
  )
}

/// Ready-made companies of the catalog, Clipmart and GitHub, and collections of agents and skills; picking one shows it in full
/// and imports it, or, for a collection, leads to the wizard.
export default function Templates({ snapshot, onDone, onCompose }: { snapshot: Snapshot; onDone: () => void; onCompose: () => void }) {
  // A package of the user's own has no row: what it holds is known only once Paperclip read it.
  const [picked, setPicked] = useState<{ picked: Picked; row: Row | null; key: string } | null>(null)
  return (
    <>
      {/* The table stays mounted behind the details, so its filters and what GitHub found are still there on the way back. */}
      <div className={cn('flex min-h-0 flex-1 flex-col', picked !== null && 'hidden')}>
        <Catalog onPick={(row, chosen) => setPicked({ picked: chosen, row, key: row.key })} onOpen={(own) => setPicked({ picked: own, row: null, key: `package:${Date.now()}` })} />
      </div>
      {picked && (
        <TemplateDetails
          key={picked.key}
          picked={picked.picked}
          snapshot={snapshot}
          icon={picked.row && <SourceIcon icon={picked.row.icon} kinds={picked.row.kinds} className="size-10" />}
          summary={picked.row && <Summary row={picked.row} />}
          onBack={() => setPicked(null)}
          onDone={onDone}
          onCompose={onCompose}
        />
      )}
    </>
  )
}
