import { useMemo, useState } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'

import DataTable from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { type TemplateAgent } from '@/lib/client'
import { t } from '@/i18n'
import { TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from '../catalog'
import { type Collection, useCollections } from '../collections'
import OrgChart from '../OrgChart'
import { type Draft, type DraftAgent, type Origin, addAgent, addOwnAgent, chartAgents, possibleBosses, removeAgent, updateAgent } from './compose'

const TOP = '__top'

interface PoolEntry {
  key: string
  template: Origin
  category: TemplateCategory | null
  agent: TemplateAgent
  text: string
}

const TEMPLATE_POOL: PoolEntry[] = TEMPLATES.flatMap((template) => template.agents.map((agent) => ({ key: `${template.id}/${agent.slug}`, template, category: template.category, agent, text: [agent.name, agent.title ?? '', template.name, ...agent.skills].join('\n').toLocaleLowerCase() })))

const pool = (collections: Collection[]): PoolEntry[] => [
  ...TEMPLATE_POOL,
  ...collections.flatMap((collection) => collection.agents.map((agent) => ({ key: `${collection.id}/${agent.slug}`, template: collection, category: null, agent, text: [agent.name, agent.title ?? '', agent.group, collection.name].join('\n').toLocaleLowerCase() }))),
]

/// The agents of every catalog template and collection, to add one at a time, and an agent of the user's own.
function AgentPicker({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const [own, setOwn] = useState('')
  const collections = useCollections()
  const origins: Origin[] = [...TEMPLATES, ...collections]
  const entries = useMemo(() => pool(collections), [collections])
  // A new agent starts below the top of the company; the user moves it from there.
  const boss = draft.agents.find((agent) => agent.reportsTo === null)?.slug ?? null
  const taken = new Set(draft.agents.flatMap((agent) => (agent.origin ? [`${agent.origin.template}/${agent.origin.slug}`] : [])))

  return (
    <section className="flex min-h-0 flex-col gap-2">
      <span className="text-sm font-medium">{t('Agent hinzufügen')}</span>
      <DataTable
        rows={entries}
        rowKey={(entry) => entry.key}
        text={(entry) => entry.text}
        searchLabel={t('{count} Agenten aus Vorlagen und Sammlungen durchsuchen …', { count: entries.length })}
        onRowClick={(entry) => onChange(addAgent(draft, entry.template, entry.agent, boss))}
        columns={[
          { id: 'add', header: '', className: 'w-8', cell: (entry) => (taken.has(entry.key) ? <Check aria-label={t('Im Entwurf')} className="size-4 text-primary" /> : <Plus aria-hidden className="size-4 text-muted-foreground group-hover:text-foreground" />) },
          { id: 'name', header: t('Name'), sort: (entry) => entry.agent.name, className: 'font-medium', cell: (entry) => entry.agent.name },
          { id: 'title', header: t('Titel'), sort: (entry) => entry.agent.title, cell: (entry) => <span className="text-muted-foreground">{entry.agent.title ?? '–'}</span> },
          { id: 'template', header: t('Herkunft'), sort: (entry) => entry.template.name, cell: (entry) => entry.template.name },
          { id: 'skills', header: t('Skills'), sort: (entry) => entry.agent.skills.length, descFirst: true, align: 'end', cell: (entry) => entry.agent.skills.length },
        ]}
        filters={[
          { id: 'category', label: t('Kategorie'), options: TEMPLATE_CATEGORIES.map(({ id, label }) => ({ id, label: t(label), test: (entry: PoolEntry) => entry.category === id })) },
          { id: 'template', label: t('Herkunft'), options: origins.map((template) => ({ id: template.id, label: template.name, test: (entry: PoolEntry) => entry.template.id === template.id })) },
          {
            id: 'draft',
            label: t('Entwurf'),
            options: [
              { id: 'out', label: t('Noch nicht im Entwurf'), test: (entry) => !taken.has(entry.key) },
              { id: 'in', label: t('Im Entwurf'), test: (entry) => taken.has(entry.key) },
            ],
          },
        ]}
        className="max-h-[50vh]"
      />
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!own.trim()) return
          onChange(addOwnAgent(draft, own.trim(), boss))
          setOwn('')
        }}
      >
        <Input value={own} onChange={(event) => setOwn(event.target.value)} placeholder={t('Eigener Agent, z. B. Support-Leitung')} aria-label={t('Eigener Agent')} />
        <Button type="submit" size="sm" variant="outline" disabled={!own.trim()}>
          <Plus /> {t('Anlegen')}
        </Button>
      </form>
    </section>
  )
}

/// Who is in the company and whom each one reports to, with the org chart beside it.
export default function TeamStep({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const collections = useCollections()
  const templateName = (id: string) => [...TEMPLATES, ...collections].find((template) => template.id === id)?.name ?? id
  const names = new Map(draft.agents.map((agent) => [agent.slug, agent.name || agent.slug]))
  const boss = (agent: DraftAgent) => (agent.reportsTo ? (names.get(agent.reportsTo) ?? null) : null)
  const origin = (agent: DraftAgent) => (agent.origin ? templateName(agent.origin.template) : t('eigener Agent'))
  const origins = [...new Set(draft.agents.map(origin))].sort((a, b) => a.localeCompare(b))

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="flex min-w-0 flex-col gap-6">
        <section className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t('Team im Entwurf · {count}', { count: draft.agents.length })}</span>
          {draft.agents.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{t('Noch keine Agenten. Füge unten welche hinzu oder übernimm im ersten Schritt eine Vorlage.')}</p>
          ) : (
            <DataTable
              rows={draft.agents}
              rowKey={(agent) => agent.slug}
              text={(agent) => [agent.name, agent.title, boss(agent) ?? '', origin(agent)].join('\n').toLocaleLowerCase()}
              searchLabel={t('Im Team suchen …')}
              columns={[
                { id: 'name', header: t('Name'), sort: (agent) => agent.name, cell: (agent) => <Input value={agent.name} aria-label={t('Name')} onChange={(event) => onChange(updateAgent(draft, agent.slug, { name: event.target.value }))} className="h-7 min-w-36 font-medium" /> },
                { id: 'title', header: t('Titel'), sort: (agent) => agent.title, cell: (agent) => <Input value={agent.title} aria-label={t('Titel')} placeholder={t('Titel')} onChange={(event) => onChange(updateAgent(draft, agent.slug, { title: event.target.value }))} className="h-7 min-w-36" /> },
                {
                  id: 'boss',
                  header: t('Berichtet an'),
                  sort: boss,
                  cell: (agent) => (
                    <Select value={agent.reportsTo ?? TOP} onValueChange={(value) => onChange(updateAgent(draft, agent.slug, { reportsTo: value === TOP ? null : value }))}>
                      <SelectTrigger size="sm" className="h-7 w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={TOP}>{t('Niemandem (Spitze)')}</SelectItem>
                        {possibleBosses(draft, agent.slug).map((known) => (
                          <SelectItem key={known.slug} value={known.slug}>
                            {known.name || known.slug}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ),
                },
                { id: 'skills', header: t('Skills'), sort: (agent) => agent.skills.length, descFirst: true, align: 'end', cell: (agent) => agent.skills.length },
                { id: 'origin', header: t('Herkunft'), sort: origin, className: 'whitespace-nowrap text-xs text-muted-foreground', cell: origin },
                {
                  id: 'remove',
                  header: '',
                  className: 'w-10',
                  cell: (agent) => (
                    <Button size="icon-sm" variant="ghost" aria-label={t('Entfernen')} title={t('Entfernen')} onClick={() => onChange(removeAgent(draft, agent.slug))}>
                      <Trash2 />
                    </Button>
                  ),
                },
              ]}
              filters={[
                { id: 'origin', label: t('Herkunft'), options: origins.map((name) => ({ id: name, label: name, test: (agent: DraftAgent) => origin(agent) === name })) },
                {
                  id: 'level',
                  label: t('Berichtet an'),
                  options: [
                    { id: 'top', label: t('Spitze'), test: (agent) => agent.reportsTo === null },
                    { id: 'below', label: t('Mit Vorgesetztem'), test: (agent) => agent.reportsTo !== null },
                  ],
                },
              ]}
              className="max-h-[50vh]"
            />
          )}
        </section>
        <AgentPicker draft={draft} onChange={onChange} />
      </div>
      <div className="min-w-0 self-start rounded-md border p-3 xl:sticky xl:top-0">
        <span className="mb-2 block text-sm font-medium">{t('Organigramm')}</span>
        {draft.agents.length > 0 ? <OrgChart agents={chartAgents(draft)} open={3} /> : <p className="text-xs text-muted-foreground">{t('Erscheint, sobald Agenten da sind.')}</p>}
      </div>
    </div>
  )
}
