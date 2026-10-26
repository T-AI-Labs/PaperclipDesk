import { useState } from 'react'
import { ArrowLeft, ArrowRight, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Snapshot } from '@/lib/client'
import { cn } from '@/lib/utils'
import { type Message, t } from '@/i18n'
import { TEMPLATES } from './catalog'
import AssistantBox from './wizard/AssistantBox'
import { type Draft, EMPTY_DRAFT, addTemplate } from './wizard/compose'
import CreateStep from './wizard/CreateStep'
import SkillsStep from './wizard/SkillsStep'
import TeamStep from './wizard/TeamStep'

type Step = 'basics' | 'team' | 'skills' | 'create'

const STEPS: { id: Step; label: Message }[] = [
  { id: 'basics', label: 'Grundlagen' },
  { id: 'team', label: 'Team' },
  { id: 'skills', label: 'Skills' },
  { id: 'create', label: 'Anlegen' },
]

const BY_STARS = [...TEMPLATES].sort((a, b) => b.stars - a.stars)

const TEXTAREA = 'w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

/// Name, purpose and goals, and the templates whose agents the company starts with.
function BasicsStep({ draft, assistant, onChange, onProposal }: { draft: Draft; assistant: boolean; onChange: (draft: Draft) => void; onProposal: (draft: Draft) => void }) {
  const [template, setTemplate] = useState(BY_STARS[0]?.id ?? '')
  const picked = TEMPLATES.find((known) => known.id === template)

  function take() {
    if (!picked) return
    // A second template's top reports to the top of what is there, so the company keeps one head.
    const boss = draft.agents.find((agent) => agent.reportsTo === null)?.slug ?? null
    const next = addTemplate(draft, picked, boss)
    onChange({ ...next, description: draft.description || picked.description, goals: draft.goals.length ? draft.goals : picked.goals })
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <AssistantBox enabled={assistant} draft={draft} onApply={onProposal} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wizard-name">{t('Name der neuen Firma')}</Label>
        <Input id="wizard-name" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder={t('z. B. Northwind Labs')} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wizard-description">{t('Worum es geht')}</Label>
        <textarea id="wizard-description" rows={3} value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} className={TEXTAREA} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wizard-goals">{t('Ziele, eines pro Zeile')}</Label>
        <textarea id="wizard-goals" rows={3} value={draft.goals.join('\n')} onChange={(event) => onChange({ ...draft, goals: event.target.value.split('\n') })} onBlur={() => onChange({ ...draft, goals: draft.goals.map((goal) => goal.trim()).filter(Boolean) })} className={TEXTAREA} />
      </div>
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <span className="text-sm font-medium">{t('Mit den Agenten einer Vorlage beginnen')}</span>
        <span className="text-xs text-muted-foreground">{t('Optional. Ihre Hierarchie und Skills kommen mit; im nächsten Schritt kannst du Agenten entfernen, umbenennen, umhängen oder aus anderen Vorlagen dazunehmen.')}</span>
        <div className="flex items-center gap-2">
          <Select value={template} onValueChange={setTemplate}>
            <SelectTrigger size="sm" className="min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BY_STARS.map((known) => (
                <SelectItem key={known.id} value={known.id}>
                  {known.name} · {t('{agents} Agenten · {skills} Skills', { agents: known.agents.length, skills: known.skills.length })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={take}>
            <Plus /> {t('Übernehmen')}
          </Button>
        </div>
        {draft.agents.length > 0 && <span className="text-xs text-muted-foreground">{t('{count} Agenten im Entwurf.', { count: draft.agents.length })}</span>}
      </div>
    </div>
  )
}

/// Builds a new company step by step from agents of any template, and creates it in the Paperclip in front.
export default function Wizard({ snapshot, assistant, onDone }: { snapshot: Snapshot; assistant: boolean; onDone: () => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [step, setStep] = useState<Step>('basics')
  const index = STEPS.findIndex(({ id }) => id === step)
  const reachable = (id: Step) => id === 'basics' || (draft.name.trim() !== '' && (id === 'team' || draft.agents.length > 0))
  const next = STEPS[index + 1]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <ol className="flex shrink-0 flex-wrap items-center gap-1.5">
        {STEPS.map(({ id, label }, position) => (
          <li key={id}>
            <button type="button" disabled={!reachable(id)} onClick={() => setStep(id)} className={cn('rounded-full border px-3 py-1 text-xs disabled:opacity-40', id === step ? 'border-transparent bg-primary text-primary-foreground' : 'hover:bg-accent')}>
              {position + 1}. {t(label)}
            </button>
          </li>
        ))}
      </ol>

      <div className="min-h-0 flex-1 overflow-y-auto">
      {step === 'basics' && (
        <BasicsStep
          draft={draft}
          assistant={assistant}
          onChange={setDraft}
          onProposal={(proposed) => {
            setDraft(proposed)
            setStep('team')
          }}
        />
      )}
      {step === 'team' && <TeamStep draft={draft} onChange={setDraft} />}
      {step === 'skills' && <SkillsStep draft={draft} onChange={setDraft} />}
      {step === 'create' && <CreateStep draft={draft} snapshot={snapshot} onDone={onDone} />}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t pt-3">
        {index > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setStep(STEPS[index - 1].id)}>
            <ArrowLeft /> {t('Zurück')}
          </Button>
        )}
        {next && (
          <Button size="sm" className="ml-auto" disabled={!reachable(next.id)} onClick={() => setStep(next.id)}>
            {t('Weiter')} <ArrowRight />
          </Button>
        )}
      </div>
    </div>
  )
}
