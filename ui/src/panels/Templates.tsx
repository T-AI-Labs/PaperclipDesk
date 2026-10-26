import { useState } from 'react'
import { Building2, Star } from 'lucide-react'

import DataTable, { type Column, type Filter } from '@/components/data-table'
import type { Snapshot } from '@/lib/client'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'
import { CATALOG_DATE, TEMPLATES, TEMPLATE_CATEGORIES, type Template, type TemplateCategory } from './catalog'
import { levels } from './hierarchy'
import { ownerIcon } from './icons'
import TemplateDetails from './TemplateDetails'

/// One line of the table: a company of Paperclip's catalog.
interface Row {
  key: string
  template: Template
  name: string
  description: string
  /// The avatar of the source repository's owner.
  icon: string | null
  /// Where it comes from, as the badge beside the name shows it.
  source: string
  category: TemplateCategory
  stars: number
  updated: string
  agents: number
  skills: number
  teams: number
  levels: number
  /// Everything the search looks into: also the agents, teams and skills with their descriptions.
  text: string
}

const CATALOG_REPOSITORY = 'paperclipai/companies'

const ROWS: Row[] = TEMPLATES.map((template) => ({
  key: template.id,
  template,
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

// The page's language, which the app sets, formats numbers and dates the way its readers expect.
const stars = (count: number) => new Intl.NumberFormat(document.documentElement.lang, { notation: 'compact', maximumFractionDigits: 1 }).format(count)
const day = (date: string) => new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(date))
const categoryLabel = (row: Row) => {
  const known = TEMPLATE_CATEGORIES.find(({ id }) => id === row.category)
  return known ? t(known.label) : row.category
}

/// The avatar of a row's source, or a building when the snapshot has none.
function SourceIcon({ icon, className }: { icon: string | null; className?: string }) {
  if (icon) return <img src={icon} alt="" className={cn('size-8 shrink-0 rounded-md border bg-muted object-cover', className)} />
  return (
    <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground', className)}>
      <Building2 aria-hidden className="size-4" />
    </span>
  )
}

/// What a template holds and how popular it is, in one line.
function Summary({ row }: { row: Row }) {
  return (
    <>
      <span>{row.skills === 1 ? t('{agents} Agenten · 1 Skill', { agents: row.agents }) : t('{agents} Agenten · {skills} Skills', { agents: row.agents, skills: row.skills })}</span>
      {row.teams > 0 && <span>{row.teams === 1 ? t('1 Team') : t('{count} Teams', { count: row.teams })}</span>}
      {row.levels > 1 && <span>{t('{count} Ebenen', { count: row.levels })}</span>}
      <span className="flex items-center gap-1" title={t('Sterne des Quell-Repos auf GitHub')}>
        <Star aria-hidden className="size-3" /> {stars(row.stars)}
      </span>
      {row.updated && <span>{t('Quelle aktualisiert {date}', { date: day(row.updated) })}</span>}
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
          <SourceIcon icon={row.icon} className="mt-0.5" />
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
    { id: 'levels', header: t('Ebenen'), sort: (row) => row.levels, descFirst: true, align: 'end', cell: (row) => row.levels },
    {
      id: 'stars',
      header: t('Sterne'),
      sort: (row) => row.stars,
      descFirst: true,
      align: 'end',
      cell: (row) => (
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

function filters(): Filter<Row>[] {
  const within = (months: number) => (row: Row) => row.updated !== '' && row.updated >= monthsAgo(months)
  return [
    { id: 'category', label: t('Kategorie'), column: 'category', options: TEMPLATE_CATEGORIES.map(({ id, label }) => ({ id, label: t(label), test: (row: Row) => row.category === id })) },
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
    { id: 'levels', label: t('Ebenen'), column: 'levels', options: [{ id: 'hierarchy', label: t('Mit Hierarchie'), test: (row) => row.levels > 1 }] },
    {
      id: 'stars',
      label: t('Sterne'),
      column: 'stars',
      single: true,
      options: [10, 100, 1000, 10000].map((count) => ({ id: String(count), label: t('Ab {count} Sternen', { count: stars(count) }), test: (row: Row) => row.stars >= count })),
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

function Catalog({ onPick }: { onPick: (row: Row) => void }) {
  const [query, setQuery] = useState('')
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <DataTable
        rows={ROWS}
        rowKey={(row) => row.key}
        columns={columns()}
        filters={filters()}
        text={(row) => row.text}
        searchLabel={t('Vorlage, Agent oder Skill suchen …')}
        initialSort={{ column: 'stars', desc: true }}
        query={query}
        onQueryChange={setQuery}
        onRowClick={onPick}
        className="min-h-[24rem] flex-1"
      />
      <p className="text-xs text-muted-foreground">
        {t('Aus dem Katalog github.com/paperclipai/companies, MIT-Lizenz.')} {t('Sterne und Daten von GitHub, Stand {date}.', { date: day(CATALOG_DATE) })}
      </p>
    </div>
  )
}

/// The ready-made companies of Paperclip's catalog; picking one shows it in full and imports it.
export default function Templates({ snapshot, onDone }: { snapshot: Snapshot; onDone: () => void }) {
  const [picked, setPicked] = useState<Row | null>(null)
  return (
    <>
      {/* The table stays mounted behind the details, so its filters are still there on the way back. */}
      <div className={cn('flex min-h-0 flex-1 flex-col', picked !== null && 'hidden')}>
        <Catalog onPick={setPicked} />
      </div>
      {picked && (
        <TemplateDetails
          key={picked.key}
          template={picked.template}
          snapshot={snapshot}
          icon={<SourceIcon icon={picked.icon} className="size-10" />}
          summary={<Summary row={picked} />}
          onBack={() => setPicked(null)}
          onDone={onDone}
        />
      )}
    </>
  )
}
