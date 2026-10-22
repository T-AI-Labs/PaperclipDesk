import { useState } from 'react'
import { ArrowLeft, CircleAlert, KeyRound, LoaderCircle, Search } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessage, importCompanyTemplate } from '@/lib/client'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'
import { TEMPLATES, TEMPLATE_CATEGORIES, type Template, type TemplateCategory } from './catalog'

function Counts({ template }: { template: Template }) {
  return <span>{template.skills === 1 ? t('{agents} Agenten · 1 Skill', { agents: template.agents }) : t('{agents} Agenten · {skills} Skills', { agents: template.agents, skills: template.skills })}</span>
}

function Catalog({ onPick }: { onPick: (template: Template) => void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<TemplateCategory | null>(null)
  const needle = query.trim().toLocaleLowerCase()
  const shown = TEMPLATES.filter((template) => (category === null || template.category === category) && (needle === '' || `${template.name} ${template.description}`.toLocaleLowerCase().includes(needle)))
  const chip = (active: boolean) => cn('rounded-full border px-2.5 py-0.5 text-xs', active ? 'border-transparent bg-primary text-primary-foreground' : 'hover:bg-accent')

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-ring/50">
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Vorlage suchen …')}
            aria-label={t('Vorlage suchen …')}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={chip(category === null)} onClick={() => setCategory(null)}>
            {t('Alle')} {TEMPLATES.length}
          </button>
          {TEMPLATE_CATEGORIES.map(({ id, label }) => (
            <button key={id} type="button" className={chip(category === id)} onClick={() => setCategory(id)}>
              {t(label)} {TEMPLATES.filter((template) => template.category === id).length}
            </button>
          ))}
        </div>
      </div>

      <ul className="-mx-4 flex flex-col divide-y border-y">
        {shown.map((template) => (
          <li key={template.id}>
            <button type="button" onClick={() => onPick(template)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-accent/60">
              <span className="text-sm font-medium">{template.name}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{template.description}</span>
              <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <Counts template={template} />
                {template.inputs.some((input) => input.required) && <span className="text-amber-700 dark:text-amber-400">{t('Braucht Zugangsdaten')}</span>}
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">{t('Keine Treffer')}</li>}
      </ul>
      <p className="text-xs text-muted-foreground">{t('Aus dem Katalog github.com/paperclipai/companies, MIT-Lizenz.')}</p>
    </>
  )
}

function Details({ template, onBack, onDone }: { template: Template; onBack: () => void; onDone: () => void }) {
  const [name, setName] = useState(template.name)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const required = template.inputs.filter((input) => input.required)
  const optional = template.inputs.filter((input) => !input.required)
  const missing = required.some((input) => !secrets[input.key]?.trim())

  function start() {
    setRunning(true)
    setError(null)
    importCompanyTemplate(template.id, name, secrets)
      .then(onDone)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setRunning(false))
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={running}>
          <ArrowLeft /> {t('Alle Vorlagen')}
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="font-heading text-base font-medium">{template.name}</h3>
        <p className="text-sm text-muted-foreground">{template.description}</p>
        <p className="text-xs text-muted-foreground">
          <Counts template={template} />
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-name">{t('Name der neuen Firma')}</Label>
        <Input id="template-name" value={name} disabled={running} onChange={(event) => setName(event.target.value)} />
      </div>

      {required.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>{t('Zugangsdaten')}</Label>
          {required.map((input) => (
            <div key={input.key} className="flex items-center gap-2">
              <KeyRound aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <Input
                type="password"
                autoComplete="off"
                aria-label={input.key}
                placeholder={input.key}
                value={secrets[input.key] ?? ''}
                disabled={running}
                onChange={(event) => setSecrets((current) => ({ ...current, [input.key]: event.target.value }))}
                className="font-mono"
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{t('Paperclip legt daraus ein Secret an; die App behält den Wert nicht.')}</p>
        </div>
      )}
      {optional.length > 0 && <p className="text-xs text-muted-foreground">{t('Optional, später in Paperclip unter Secrets: {keys}', { keys: optional.map((input) => input.key).join(', ') })}</p>}

      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}

      <div className="mt-auto flex flex-col items-end gap-2">
        <Button disabled={running || missing} onClick={start}>
          {running && <LoaderCircle className="animate-spin" />} {running ? t('Wird importiert …') : t('Als neue Firma importieren')}
        </Button>
        {running && <p className="text-xs text-muted-foreground">{t('Große Vorlagen brauchen einige Minuten.')}</p>}
      </div>
    </>
  )
}

/// Paperclip's catalog of ready-made companies; picking one imports it as a new company, and Paperclip switches to it.
export default function Templates({ onDone }: { onDone: () => void }) {
  const [picked, setPicked] = useState<Template | null>(null)
  return picked ? <Details template={picked} onBack={() => setPicked(null)} onDone={onDone} /> : <Catalog onPick={setPicked} />
}
