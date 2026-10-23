import { useState } from 'react'
import { Plus, Search, X } from 'lucide-react'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t } from '@/i18n'
import { TEMPLATES } from '../catalog'
import { type Draft, type SkillRef, updateAgent } from './compose'

/// Matches shown at once; the search narrows the rest.
const SHOWN = 30

const POOL = TEMPLATES.flatMap((template) => template.skills.map((skill) => ({ template, skill, text: [skill.name, skill.description ?? '', template.name].join('\n').toLocaleLowerCase() })))

const skillName = (ref: SkillRef) => (ref.template ? (TEMPLATES.find((template) => template.id === ref.template)?.skills.find((skill) => skill.slug === ref.slug)?.name ?? ref.slug) : ref.slug)
const same = (a: SkillRef, b: SkillRef) => a.template === b.template && a.slug === b.slug

/// The skills of each agent: the ones it brought, and any other skill of the catalog.
export default function SkillsStep({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const [target, setTarget] = useState(draft.agents[0]?.slug ?? '')
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const agent = draft.agents.find((known) => known.slug === target)
  const matches = POOL.filter((entry) => (needle === '' || entry.text.includes(needle)) && !agent?.skills.some((skill) => same(skill, { template: entry.template.id, slug: entry.skill.slug })))

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <ul className="flex min-w-0 flex-col divide-y rounded-md border">
        {draft.agents.map((known) => (
          <li key={known.slug} className="flex flex-col gap-1.5 px-3 py-2">
            <button type="button" onClick={() => setTarget(known.slug)} className="self-start text-left text-sm font-medium hover:underline">
              {known.name || known.slug}
              {known.slug === target && <span className="ml-2 text-xs font-normal text-primary">{t('wird ergänzt')}</span>}
            </button>
            <span className="flex flex-wrap gap-1">
              {known.skills.length === 0 && <span className="text-xs text-muted-foreground">{t('Keine Skills')}</span>}
              {known.skills.map((skill) => (
                <span key={`${skill.template}/${skill.slug}`} className="flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2 text-xs">
                  {skillName(skill)}
                  <button type="button" aria-label={t('Entfernen')} onClick={() => onChange(updateAgent(draft, known.slug, { skills: known.skills.filter((other) => !same(other, skill)) }))} className="rounded-full p-0.5 hover:bg-accent">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex min-w-0 flex-col gap-2 rounded-md border p-3">
        <span className="text-sm font-medium">{t('Skill hinzufügen')}</span>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder={t('Agent wählen')} />
          </SelectTrigger>
          <SelectContent>
            {draft.agents.map((known) => (
              <SelectItem key={known.slug} value={known.slug}>
                {known.name || known.slug}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-ring/50">
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('{count} Skills aus dem Katalog durchsuchen …', { count: POOL.length })} aria-label={t('Skill suchen')} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        </div>
        <ul className="flex max-h-96 flex-col overflow-y-auto">
          {agent &&
            matches.slice(0, SHOWN).map(({ template, skill }) => (
              <li key={`${template.id}/${skill.slug}`}>
                <button type="button" onClick={() => onChange(updateAgent(draft, agent.slug, { skills: [...agent.skills, { template: template.id, slug: skill.slug }] }))} className="flex w-full flex-col rounded px-2 py-1 text-left hover:bg-accent/60">
                  <span className="flex items-center gap-2 text-sm">
                    <Plus aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{skill.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{template.name}</span>
                  </span>
                  {skill.description && <span className="line-clamp-2 pl-5.5 text-xs text-muted-foreground">{skill.description}</span>}
                </button>
              </li>
            ))}
          {agent && matches.length > SHOWN && <li className="px-2 py-1 text-xs text-muted-foreground">{t('{count} weitere; die Suche grenzt ein.', { count: matches.length - SHOWN })}</li>}
        </ul>
      </div>
    </div>
  )
}
