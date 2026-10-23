import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ExternalLink, FolderGit2, LoaderCircle, Search, Star } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type FoundTemplate, type ProjectLink, errorMessage, githubTokenStored, openProjectLink, searchTemplates, setGithubToken } from '@/lib/client'
import { cn } from '@/lib/utils'
import { type Message, t } from '@/i18n'
import { CATALOG_DATE, PROVIDERS, PROVIDERS_DATE, type Provider, TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from './catalog'
import { levels } from './hierarchy'
import TemplateDetails, { type Picked } from './TemplateDetails'

type Order = 'stars' | 'updated' | 'name' | 'agents' | 'skills'

const ORDERS: { id: Order; label: Message }[] = [
  { id: 'stars', label: 'Beliebtheit' },
  { id: 'updated', label: 'Zuletzt aktualisiert' },
  { id: 'name', label: 'Name' },
  { id: 'agents', label: 'Agenten' },
  { id: 'skills', label: 'Skills' },
]

type Size = 'small' | 'medium' | 'large'

const SIZES: { id: Size; label: Message; fits: (agents: number) => boolean }[] = [
  { id: 'small', label: 'Bis 10 Agenten', fits: (agents) => agents <= 10 },
  { id: 'medium', label: '11 bis 50', fits: (agents) => agents > 10 && agents <= 50 },
  { id: 'large', label: 'Über 50', fits: (agents) => agents > 50 },
]

type Content = 'hierarchy' | 'teams' | 'skills' | 'open'

const CONTENTS: { id: Content; label: Message }[] = [
  { id: 'hierarchy', label: 'Mit Hierarchie' },
  { id: 'teams', label: 'Mit Teams' },
  { id: 'skills', label: 'Mit Skills' },
  { id: 'open', label: 'Ohne Zugangsdaten' },
]

/// One line of the list, from the catalog or found on GitHub; what a found package does not tell is null.
interface Row {
  key: string
  picked: Picked
  name: string
  description: string
  category: TemplateCategory | null
  stars: number
  updated: string
  agents: number
  skills: number
  teams: number
  levels: number | null
  needsSecrets: boolean | null
  /// Everything the search looks into: for the catalog also its agents, teams and skills with their descriptions.
  text: string
}

const CATALOG_ROWS: Row[] = TEMPLATES.map((template) => ({
  key: `catalog:${template.id}`,
  picked: { kind: 'catalog', template },
  name: template.name,
  description: template.description,
  category: template.category,
  stars: template.stars,
  updated: template.sourceUpdated,
  agents: template.agents.length,
  skills: template.skills.length,
  teams: template.teams.length,
  levels: levels(template.agents),
  needsSecrets: template.inputs.some((input) => input.required),
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

function foundRow(found: FoundTemplate): Row {
  return {
    key: `github:${found.url}`,
    picked: { kind: 'github', found },
    name: found.name,
    description: found.description,
    category: null,
    stars: found.stars,
    updated: found.updated,
    agents: found.agents,
    skills: found.skills,
    teams: found.teams,
    levels: null,
    needsSecrets: null,
    text: [found.name, found.description, found.repository].join('\n').toLocaleLowerCase(),
  }
}

const COMPARE: Record<Order, (a: Row, b: Row) => number> = {
  stars: (a, b) => b.stars - a.stars,
  updated: (a, b) => b.updated.localeCompare(a.updated) || b.stars - a.stars,
  name: (a, b) => a.name.localeCompare(b.name),
  agents: (a, b) => b.agents - a.agents || b.stars - a.stars,
  skills: (a, b) => b.skills - a.skills || b.stars - a.stars,
}

const HAS: Record<Content, (row: Row) => boolean> = {
  hierarchy: (row) => (row.levels ?? 0) > 1,
  teams: (row) => row.teams > 0,
  skills: (row) => row.skills > 0,
  open: (row) => row.needsSecrets === false,
}

// The page's language, which the app sets, formats numbers and dates the way its readers expect.
const stars = (count: number) => new Intl.NumberFormat(document.documentElement.lang, { notation: 'compact', maximumFractionDigits: 1 }).format(count)
const day = (date: string) => new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(date))

/// What a template holds and how popular it is, in one line.
function Summary({ row }: { row: Row }) {
  return (
    <>
      <span>{row.skills === 1 ? t('{agents} Agenten · 1 Skill', { agents: row.agents }) : t('{agents} Agenten · {skills} Skills', { agents: row.agents, skills: row.skills })}</span>
      {row.teams > 0 && <span>{row.teams === 1 ? t('1 Team') : t('{count} Teams', { count: row.teams })}</span>}
      {row.levels !== null && row.levels > 1 && <span>{t('{count} Ebenen', { count: row.levels })}</span>}
      <span className="flex items-center gap-1" title={t('Sterne des Quell-Repos auf GitHub')}>
        <Star aria-hidden className="size-3" /> {stars(row.stars)}
      </span>
      {row.updated && <span>{t('Quelle aktualisiert {date}', { date: day(row.updated) })}</span>}
    </>
  )
}

type Source = 'paperclip' | 'github' | Provider['id']
type Cost = 'free' | 'paid'

const open = (link: ProjectLink) => void openProjectLink(link).catch((e: unknown) => toast.error(errorMessage(e)))

function ProviderCard({ provider }: { provider: Provider }) {
  return (
    <li className="flex flex-col gap-1 px-4 py-3">
      <span className="flex items-center gap-2 text-sm font-medium">
        {provider.name}
        <span className="rounded-full border px-1.5 text-[11px] font-normal text-muted-foreground">{provider.paid ? t('Kostenpflichtig') : t('Kostenlos')}</span>
      </span>
      <span className="text-xs text-muted-foreground">{t(provider.description, { count: provider.templates })}</span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {!provider.importable && <span className="text-amber-700 dark:text-amber-400">{t('Nicht in dieses Paperclip importierbar')}</span>}
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => open(provider.id)}>
          <ExternalLink /> {t('Auf der Website ansehen')}
        </Button>
      </span>
    </li>
  )
}

/// The search on GitHub: a token first, then the packages it finds join the list.
function GithubSearch({ query, searching, searched, onSearch }: { query: string; searching: boolean; searched: boolean; onSearch: () => void }) {
  const [stored, setStored] = useState<boolean | null>(null)
  const [token, setToken] = useState('')

  useEffect(() => {
    githubTokenStored()
      .then(setStored)
      .catch(() => setStored(false))
  }, [])

  function store(next: string) {
    setGithubToken(next)
      .then(() => {
        setStored(next.trim() !== '')
        setToken('')
      })
      .catch((e: unknown) => toast.error(errorMessage(e)))
  }

  if (stored === null) return null
  if (!stored) {
    return (
      <li className="flex flex-col gap-2 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          <FolderGit2 aria-hidden className="size-4" /> {t('Weitere Vorlagen auf GitHub')}
        </span>
        <span className="text-xs text-muted-foreground">{t('Für die Suche braucht GitHub ein Token. Lesezugriff auf öffentliche Repos reicht; Windows bewahrt es in der Anmeldeinformationsverwaltung auf.')}</span>
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
      </li>
    )
  }
  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
      <FolderGit2 aria-hidden className="size-4" />
      <span className="flex-1">{searched ? t('Treffer auf GitHub sind in der Liste.') : t('Auf GitHub nach weiteren Vorlagen suchen, mit dem Suchbegriff oben.')}</span>
      <Button size="sm" variant="outline" disabled={searching} onClick={onSearch}>
        {searching ? <LoaderCircle className="animate-spin" /> : <Search />} {query.trim() ? t('Auf GitHub suchen: {query}', { query: query.trim() }) : t('Auf GitHub suchen')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => store('')}>
        {t('Token entfernen')}
      </Button>
    </li>
  )
}

function Catalog({ onPick }: { onPick: (row: Row) => void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<TemplateCategory | null>(null)
  const [order, setOrder] = useState<Order>('stars')
  const [source, setSource] = useState<Source | null>(null)
  const [cost, setCost] = useState<Cost | null>(null)
  const [size, setSize] = useState<Size | null>(null)
  const [contents, setContents] = useState<ReadonlySet<Content>>(new Set())
  const [found, setFound] = useState<FoundTemplate[] | null>(null)
  const [searching, setSearching] = useState(false)

  function searchGithub() {
    setSearching(true)
    searchTemplates(query)
      .then(setFound)
      .catch((e: unknown) => toast.error(errorMessage(e)))
      .finally(() => setSearching(false))
  }

  const needle = query.trim().toLocaleLowerCase()
  const free = cost !== 'paid'
  const sized = SIZES.find(({ id }) => id === size)
  const rows = [...((source === null || source === 'paperclip') && free ? CATALOG_ROWS : []), ...((source === null || source === 'github') && free && category === null ? (found ?? []).map(foundRow) : [])]
  const shown = rows
    .filter((row) => (category === null || row.category === category) && (sized === undefined || sized.fits(row.agents)) && [...contents].every((content) => HAS[content](row)) && (needle === '' || row.text.includes(needle)))
    .sort(COMPARE[order])
  const filtered = size !== null || contents.size > 0
  const providers = PROVIDERS.filter((provider) => category === null && !filtered && (source === null || source === provider.id) && (cost === null || (cost === 'paid') === provider.paid) && (needle === '' || `${provider.name} ${t(provider.description, { count: provider.templates })}`.toLocaleLowerCase().includes(needle)))
  const sources: { id: Source; label: string; count: number | null }[] = [
    { id: 'paperclip', label: t('Paperclip-Katalog'), count: TEMPLATES.length },
    { id: 'github', label: 'GitHub', count: found?.length ?? null },
    ...PROVIDERS.map((provider) => ({ id: provider.id, label: provider.name, count: provider.templates })),
  ]
  const chip = (active: boolean) => cn('rounded-full border px-2.5 py-0.5 text-xs', active ? 'border-transparent bg-primary text-primary-foreground' : 'hover:bg-accent')
  const toggle = (content: Content) =>
    setContents((current) => {
      const next = new Set(current)
      if (!next.delete(content)) next.add(content)
      return next
    })

  return (
    <>
      <div className="flex flex-col gap-3">
        <form
          className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-ring/50"
          onSubmit={(event) => {
            event.preventDefault()
            if (found !== null || source === 'github') searchGithub()
          }}
        >
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Vorlage, Agent oder Skill suchen …')}
            aria-label={t('Vorlage, Agent oder Skill suchen …')}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </form>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t('Kategorie')}</span>
          <button type="button" className={chip(category === null)} onClick={() => setCategory(null)}>
            {t('Alle')} {TEMPLATES.length}
          </button>
          {TEMPLATE_CATEGORIES.map(({ id, label }) => (
            <button key={id} type="button" className={chip(category === id)} onClick={() => setCategory(id)}>
              {t(label)} {TEMPLATES.filter((template) => template.category === id).length}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t('Anbieter')}</span>
          <button type="button" className={chip(source === null)} onClick={() => setSource(null)}>
            {t('Alle')}
          </button>
          {sources.map(({ id, label, count }) => (
            <button key={id} type="button" className={chip(source === id)} onClick={() => setSource(id)}>
              {label} {count}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t('Größe')}</span>
          <button type="button" className={chip(size === null)} onClick={() => setSize(null)}>
            {t('Alle')}
          </button>
          {SIZES.map(({ id, label }) => (
            <button key={id} type="button" className={chip(size === id)} onClick={() => setSize(id)}>
              {t(label)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t('Inhalt')}</span>
          {CONTENTS.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={contents.has(id)} className={chip(contents.has(id))} onClick={() => toggle(id)}>
              {t(label)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t('Kosten')}</span>
          {([null, 'free', 'paid'] as const).map((id) => (
            <button key={id ?? 'all'} type="button" className={chip(cost === id)} onClick={() => setCost(id)}>
              {id === null ? t('Alle') : id === 'free' ? t('Kostenlos') : t('Kostenpflichtig')}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t('Sortieren')}</span>
          {ORDERS.map(({ id, label }) => (
            <button key={id} type="button" className={chip(order === id)} onClick={() => setOrder(id)}>
              {t(label)}
            </button>
          ))}
        </div>
      </div>

      <ul className="-mx-4 flex flex-col divide-y border-y">
        {shown.map((row) => (
          <li key={row.key}>
            <button type="button" onClick={() => onPick(row)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-accent/60">
              <span className="flex items-center gap-2 text-sm font-medium">
                {row.name}
                {row.picked.kind === 'github' && <span className="truncate rounded-full border px-1.5 text-[11px] font-normal text-muted-foreground">{row.picked.found.repository}</span>}
              </span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{row.description}</span>
              <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <Summary row={row} />
                {row.needsSecrets && <span className="text-amber-700 dark:text-amber-400">{t('Braucht Zugangsdaten')}</span>}
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 && providers.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">{t('Keine Treffer')}</li>}
        {(source === null || source === 'github') && free && category === null && <GithubSearch query={query} searching={searching} searched={found !== null} onSearch={searchGithub} />}
        {providers.length > 0 && (
          <li className="bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">
            {t('Weitere Anbieter')} · {t('Stand {date}. Die App lädt von diesen Seiten nichts; der Link öffnet den Browser.', { date: day(PROVIDERS_DATE) })}
          </li>
        )}
        {providers.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {t('Aus dem Katalog github.com/paperclipai/companies, MIT-Lizenz.')} {t('Sterne und Daten von GitHub, Stand {date}.', { date: day(CATALOG_DATE) })}
        {found !== null && ` ${t('Treffer auf GitHub stammen von ihren Autoren; vor dem Import ansehen.')}`}
      </p>
    </>
  )
}

/// Ready-made companies: Paperclip's catalog, packages found on GitHub and further providers; picking one shows it in full and imports it.
export default function Templates({ onDone }: { onDone: () => void }) {
  const [picked, setPicked] = useState<Row | null>(null)
  return (
    <>
      {/* The list stays mounted behind the details, so its filters and what GitHub found are still there on the way back. */}
      <div className={cn('flex flex-col gap-6', picked !== null && 'hidden')}>
        <Catalog onPick={setPicked} />
      </div>
      {picked && <TemplateDetails key={picked.key} picked={picked.picked} summary={<Summary row={picked} />} onBack={() => setPicked(null)} onDone={onDone} />}
    </>
  )
}
