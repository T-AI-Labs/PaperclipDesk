import { useMemo, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'

import DataTable from '@/components/data-table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { type TemplateSkill } from '@/lib/client'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'
import { TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from '../catalog'
import { useCollections } from '../collections'
import { type Draft, type Origin, type SkillRef, updateAgent } from './compose'

interface PoolEntry {
  key: string
  template: Origin
  category: TemplateCategory | null
  skill: TemplateSkill
  /// How many agents of its template have it, a hint of how central it is there.
  users: number
  text: string
}

const pool = (origins: Origin[]): PoolEntry[] =>
  origins.flatMap((template) =>
    template.skills.map((skill) => ({
      key: `${template.id}/${skill.slug}`,
      template,
      category: TEMPLATES.find((known) => known.id === template.id)?.category ?? null,
      skill,
      users: template.agents.filter((agent) => agent.skills.includes(skill.slug)).length,
      text: [skill.name, skill.description ?? '', template.name].join('\n').toLocaleLowerCase(),
    })),
  )

const same = (a: SkillRef, b: SkillRef) => a.template === b.template && a.slug === b.slug

/// The skills of each agent: the ones it brought, and any other skill of the catalog and the collections.
export default function SkillsStep({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const [target, setTarget] = useState(draft.agents[0]?.slug ?? '')
  const collections = useCollections()
  const origins = useMemo((): Origin[] => [...TEMPLATES, ...collections], [collections])
  const entries = useMemo(() => pool(origins), [origins])
  const skillName = (ref: SkillRef) => (ref.template ? (origins.find((template) => template.id === ref.template)?.skills.find((skill) => skill.slug === ref.slug)?.name ?? ref.slug) : ref.slug)
  const agent = draft.agents.find((known) => known.slug === target)
  const has = (entry: PoolEntry) => agent?.skills.some((skill) => same(skill, { template: entry.template.id, slug: entry.skill.slug })) ?? false

  function toggle(entry: PoolEntry) {
    if (!agent) return
    const ref = { template: entry.template.id, slug: entry.skill.slug }
    onChange(updateAgent(draft, agent.slug, { skills: has(entry) ? agent.skills.filter((skill) => !same(skill, ref)) : [...agent.skills, ref] }))
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <ul className="flex min-w-0 flex-col divide-y self-start rounded-md border xl:sticky xl:top-0 xl:max-h-[70vh] xl:overflow-y-auto">
        {draft.agents.map((known) => (
          <li key={known.slug} className={cn('flex flex-col gap-1.5 px-3 py-2', known.slug === target && 'bg-accent/50')}>
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

      <section className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t('Skills für')}</span>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger size="sm" className="w-56">
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
          <span className="text-xs text-muted-foreground">{t('Ein Klick auf eine Zeile fügt den Skill hinzu oder nimmt ihn weg.')}</span>
        </div>
        <DataTable
          rows={entries}
          rowKey={(entry) => entry.key}
          text={(entry) => entry.text}
          searchLabel={t('{count} Skills aus Vorlagen und Sammlungen durchsuchen …', { count: entries.length })}
          onRowClick={toggle}
          columns={[
            { id: 'has', header: '', className: 'w-8', cell: (entry) => (has(entry) ? <Check aria-label={t('Hat der Agent')} className="size-4 text-primary" /> : <Plus aria-hidden className="size-4 text-muted-foreground group-hover:text-foreground" />) },
            { id: 'name', header: t('Skill'), sort: (entry) => entry.skill.name, className: 'font-medium whitespace-nowrap', cell: (entry) => entry.skill.name },
            { id: 'description', header: t('Beschreibung'), cell: (entry) => <span className="line-clamp-2 text-xs text-muted-foreground">{entry.skill.description ?? '–'}</span> },
            { id: 'template', header: t('Herkunft'), sort: (entry) => entry.template.name, className: 'whitespace-nowrap', cell: (entry) => entry.template.name },
            { id: 'users', header: t('Agenten'), sort: (entry) => entry.users, descFirst: true, align: 'end', cell: (entry) => entry.users },
          ]}
          filters={[
            { id: 'category', label: t('Kategorie'), options: TEMPLATE_CATEGORIES.map(({ id, label }) => ({ id, label: t(label), test: (entry: PoolEntry) => entry.category === id })) },
            { id: 'template', label: t('Herkunft'), options: origins.map((template) => ({ id: template.id, label: template.name, test: (entry: PoolEntry) => entry.template.id === template.id })) },
            {
              id: 'agent',
              label: t('Agent'),
              options: [
                { id: 'missing', label: t('Hat der Agent noch nicht'), test: (entry) => !has(entry) },
                { id: 'has', label: t('Hat der Agent'), test: has },
              ],
            },
          ]}
          className="max-h-[70vh]"
        />
      </section>
    </div>
  )
}
