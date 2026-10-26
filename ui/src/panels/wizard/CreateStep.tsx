import { useRef, useState } from 'react'
import { CircleAlert, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type Snapshot, type TemplatePreview, companyTemplateFiles, errorMessage, importCompanyTemplate, previewCompanyTemplate } from '@/lib/client'
import { toast } from '@/lib/notifications'
import { t } from '@/i18n'
import { TEMPLATES } from '../catalog'
import { collectionFiles, useCollections } from '../collections'
import { useAgentModels } from '../agent-models'
import AgentModelTable from '../AgentModels'
import NeedsPaperclip from '../NeedsPaperclip'
import { type Draft, type Files, compose, usedTemplates } from './compose'

type Checked = { draft: Draft; files: Files; preview: TemplatePreview }

/// Reads the templates the draft takes from, puts the package together, lets Paperclip check it, and creates the company.
export default function CreateStep({ draft, snapshot, onDone }: { draft: Draft; snapshot: Snapshot; onDone: () => void }) {
  // The files of a template do not change while the panel is open, so each is read once; a collection's by agent and skill.
  const read = useRef<Record<string, Files>>({})
  const [progress, setProgress] = useState<string | null>(null)
  const [checked, setChecked] = useState<Checked | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const models = useAgentModels(snapshot.hasCurrentConnection)
  const collections = useCollections()
  const current = checked?.draft === draft ? checked : null
  const used = usedTemplates(draft)
  const skills = new Set(draft.agents.flatMap((agent) => agent.skills.map((skill) => `${skill.template}/${skill.slug}`))).size
  const required = [...new Map((current?.preview.inputs ?? []).map((input) => [input.key, input])).values()].filter((input) => input.required)
  const missing = required.some((input) => !secrets[input.key]?.trim())

  async function check() {
    setError(null)
    setChecked(null)
    try {
      for (const id of used) {
        const collection = collections.find((known) => known.id === id)
        if (collection) {
          // A collection is large; only the agents and skills the draft takes come from it, each once.
          setProgress(t('Liest {template} …', { template: collection.name }))
          const agentSlugs = draft.agents.flatMap((agent) => (agent.origin?.template === id ? [agent.origin.slug] : []))
          const skillSlugs = draft.agents.flatMap((agent) => agent.skills.filter((skill) => skill.template === id).map((skill) => skill.slug))
          read.current[id] = await collectionFiles(collection, agentSlugs, skillSlugs, read.current[id])
          continue
        }
        if (read.current[id]) continue
        setProgress(t('Liest {template} …', { template: TEMPLATES.find((template) => template.id === id)?.name ?? id }))
        read.current[id] = await companyTemplateFiles({ catalog: id })
      }
      setProgress(t('Paperclip prüft die Firma …'))
      const files = compose(draft, read.current, TEMPLATES, collections)
      setChecked({ draft, files, preview: await previewCompanyTemplate({ inline: files }) })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setProgress(null)
    }
  }

  function create() {
    if (!current) return
    setCreating(true)
    setError(null)
    importCompanyTemplate({ inline: current.files }, draft.name, secrets, models.overrides(current.preview.agents))
      .then(() => {
        toast.success(t('Firma „{name}“ angelegt.', { name: draft.name.trim() }))
        onDone()
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setCreating(false))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-heading text-base font-medium">{draft.name}</span>
        {draft.description && <span className="text-muted-foreground">{draft.description}</span>}
        <span className="text-xs text-muted-foreground">
          {t('{agents} Agenten · {skills} Skills', { agents: draft.agents.length, skills })}
          {used.length > 0 && ` · ${t('aus {templates}', { templates: used.map((id) => [...TEMPLATES, ...collections].find((template) => template.id === id)?.name ?? id).join(', ') })}`}
        </span>
      </div>

      <NeedsPaperclip snapshot={snapshot}>
        {!current && (
          <Button className="self-start" variant="outline" disabled={progress !== null} onClick={() => void check()}>
            {progress !== null ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />} {progress ?? t('Prüfen')}
          </Button>
        )}
      </NeedsPaperclip>
      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}

      {current && (
        <>
          {current.preview.errors.length > 0 ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription className="break-words">{current.preview.errors.join(' ')}</AlertDescription>
            </Alert>
          ) : (
            <p className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4 text-primary" /> {t('Paperclip kann die Firma so anlegen: {agents} Agenten, {skills} Skills.', { agents: current.preview.agents.length, skills: current.preview.skills.length })}
            </p>
          )}
          {current.preview.warnings.length > 0 && <p className="text-xs text-muted-foreground">{current.preview.warnings.join(' ')}</p>}

          {current.preview.agents.length > 0 && (
            <section className="flex flex-col gap-2">
              <Label>{t('KI der Agenten')}</Label>
              <AgentModelTable agents={current.preview.agents} models={models} />
            </section>
          )}

          {required.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>{t('Zugangsdaten')}</Label>
              {required.map((input) => (
                <div key={input.key} className="flex items-center gap-2">
                  <KeyRound aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <Input type="password" autoComplete="off" aria-label={input.key} placeholder={input.key} value={secrets[input.key] ?? ''} disabled={creating} onChange={(event) => setSecrets((known) => ({ ...known, [input.key]: event.target.value }))} className="font-mono" />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">{t('Paperclip legt daraus ein Secret an; die App behält den Wert nicht.')}</p>
            </div>
          )}

          <div className="flex flex-col items-start gap-2">
            <Button disabled={creating || missing || current.preview.errors.length > 0 || models.options === null} onClick={create}>
              {creating && <LoaderCircle className="animate-spin" />} {creating ? t('Wird angelegt …') : t('Firma anlegen')}
            </Button>
            {creating && <p className="text-xs text-muted-foreground">{t('Große Vorlagen brauchen einige Minuten.')}</p>}
          </div>
        </>
      )}
    </div>
  )
}
