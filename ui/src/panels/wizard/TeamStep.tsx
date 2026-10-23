import { useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t } from '@/i18n'
import { TEMPLATES } from '../catalog'
import OrgChart from '../OrgChart'
import { type Draft, addAgent, addOwnAgent, chartAgents, possibleBosses, removeAgent, updateAgent } from './compose'

const TOP = '__top'
/// Matches shown at once; the search narrows the rest.
const SHOWN = 30

const POOL = TEMPLATES.flatMap((template) => template.agents.map((agent) => ({ template, agent, text: [agent.name, agent.title ?? '', template.name, ...agent.skills].join('\n').toLocaleLowerCase() })))

const templateName = (id: string) => TEMPLATES.find((template) => template.id === id)?.name ?? id

/// The agents of every catalog template, to add one at a time.
function AgentPicker({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const [query, setQuery] = useState('')
  const [own, setOwn] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const matches = POOL.filter((entry) => needle === '' || entry.text.includes(needle))
  // A new agent starts below the top of the company; the user moves it from there.
  const boss = draft.agents.find((agent) => agent.reportsTo === null)?.slug ?? null

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <span className="text-sm font-medium">{t('Agent hinzufügen')}</span>
      <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-ring/50">
        <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('{count} Agenten aus dem Katalog durchsuchen …', { count: POOL.length })} aria-label={t('Agent suchen')} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
      </div>
      <ul className="flex max-h-64 flex-col overflow-y-auto">
        {matches.slice(0, SHOWN).map(({ template, agent }) => (
          <li key={`${template.id}/${agent.slug}`}>
            <button type="button" onClick={() => onChange(addAgent(draft, template, agent, boss))} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent/60">
              <Plus aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{agent.name}</span>
              {agent.title && agent.title !== agent.name && <span className="truncate text-xs text-muted-foreground">{agent.title}</span>}
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{template.name}</span>
            </button>
          </li>
        ))}
        {matches.length > SHOWN && <li className="px-2 py-1 text-xs text-muted-foreground">{t('{count} weitere; die Suche grenzt ein.', { count: matches.length - SHOWN })}</li>}
      </ul>
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
    </div>
  )
}

/// Who is in the company and whom each one reports to, with the org chart beside it.
export default function TeamStep({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      <div className="flex min-w-0 flex-col gap-3">
        {draft.agents.length === 0 && <p className="text-sm text-muted-foreground">{t('Noch keine Agenten. Füge unten welche hinzu oder übernimm im ersten Schritt eine Vorlage.')}</p>}
        <ul className="flex flex-col divide-y rounded-md border">
          {draft.agents.map((agent) => (
            <li key={agent.slug} className="flex flex-col gap-1.5 px-3 py-2">
              <div className="flex items-center gap-2">
                <Input value={agent.name} aria-label={t('Name')} onChange={(event) => onChange(updateAgent(draft, agent.slug, { name: event.target.value }))} className="h-7 font-medium" />
                <Input value={agent.title} aria-label={t('Titel')} placeholder={t('Titel')} onChange={(event) => onChange(updateAgent(draft, agent.slug, { title: event.target.value }))} className="h-7" />
                <Button size="icon-sm" variant="ghost" aria-label={t('Entfernen')} title={t('Entfernen')} onClick={() => onChange(removeAgent(draft, agent.slug))}>
                  <Trash2 />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{t('Berichtet an')}</span>
                <Select value={agent.reportsTo ?? TOP} onValueChange={(value) => onChange(updateAgent(draft, agent.slug, { reportsTo: value === TOP ? null : value }))}>
                  <SelectTrigger size="sm" className="h-7 w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TOP}>{t('Niemandem (Spitze)')}</SelectItem>
                    {possibleBosses(draft, agent.slug).map((boss) => (
                      <SelectItem key={boss.slug} value={boss.slug}>
                        {boss.name || boss.slug}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span>{agent.skills.length === 1 ? t('1 Skill') : t('{count} Skills', { count: agent.skills.length })}</span>
                <span className="ml-auto">{agent.origin ? t('aus {template}', { template: templateName(agent.origin.template) }) : t('eigener Agent')}</span>
              </div>
            </li>
          ))}
        </ul>
        <AgentPicker draft={draft} onChange={onChange} />
      </div>
      <div className="min-w-0 rounded-md border p-3">
        <span className="mb-2 block text-sm font-medium">{t('Organigramm')}</span>
        {draft.agents.length > 0 ? <OrgChart agents={chartAgents(draft)} open={3} /> : <p className="text-xs text-muted-foreground">{t('Erscheint, sobald Agenten da sind.')}</p>}
      </div>
    </div>
  )
}
