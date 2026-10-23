import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, CircleAlert, ExternalLink, KeyRound, LoaderCircle, Search, Star } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessage, importCompanyTemplate, openProjectLink } from '@/lib/client'
import { cn } from '@/lib/utils'
import { type Message, t } from '@/i18n'
import { CATALOG_DATE, PROVIDERS, PROVIDERS_DATE, type Provider, TEMPLATES, TEMPLATE_CATEGORIES, type Template, type TemplateCategory } from './catalog'

function Counts({ template }: { template: Template }) {
  return <span>{template.skills === 1 ? t('{agents} Agenten · 1 Skill', { agents: template.agents }) : t('{agents} Agenten · {skills} Skills', { agents: template.agents, skills: template.skills })}</span>
}

type Order = 'stars' | 'updated' | 'name'

const ORDERS: { id: Order; label: Message }[] = [
  { id: 'stars', label: 'Beliebtheit' },
  { id: 'updated', label: 'Zuletzt aktualisiert' },
  { id: 'name', label: 'Name' },
]

const COMPARE: Record<Order, (a: Template, b: Template) => number> = {
  stars: (a, b) => b.stars - a.stars,
  updated: (a, b) => b.sourceUpdated.localeCompare(a.sourceUpdated) || b.stars - a.stars,
  name: (a, b) => a.name.localeCompare(b.name),
}

// The page's language, which the app sets, formats numbers and dates the way its readers expect.
const stars = (count: number) => new Intl.NumberFormat(document.documentElement.lang, { notation: 'compact', maximumFractionDigits: 1 }).format(count)
const day = (date: string) => new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(date))

function Popularity({ template }: { template: Template }) {
  return (
    <>
      <span className="flex items-center gap-1" title={t('Sterne des Quell-Repos auf GitHub')}>
        <Star aria-hidden className="size-3" /> {stars(template.stars)}
      </span>
      <span>{t('Quelle aktualisiert {date}', { date: day(template.sourceUpdated) })}</span>
    </>
  )
}

type Source = 'paperclip' | Provider['id']
type Cost = 'free' | 'paid'

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
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => void openProjectLink(provider.id).catch((e: unknown) => toast.error(errorMessage(e)))}>
          <ExternalLink /> {t('Auf der Website ansehen')}
        </Button>
      </span>
    </li>
  )
}

function Catalog({ onPick }: { onPick: (template: Template) => void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<TemplateCategory | null>(null)
  const [order, setOrder] = useState<Order>('stars')
  const [source, setSource] = useState<Source | null>(null)
  const [cost, setCost] = useState<Cost | null>(null)
  const needle = query.trim().toLocaleLowerCase()
  const matches = (text: string) => needle === '' || text.toLocaleLowerCase().includes(needle)
  // Paperclip's catalog is free; categories only sort its own templates, the providers have none.
  const catalogShown = (source === null || source === 'paperclip') && cost !== 'paid'
  const shown = catalogShown ? TEMPLATES.filter((template) => (category === null || template.category === category) && matches(`${template.name} ${template.description}`)).sort(COMPARE[order]) : []
  const providers = PROVIDERS.filter((provider) => category === null && (source === null || source === provider.id) && (cost === null || (cost === 'paid') === provider.paid) && matches(`${provider.name} ${t(provider.description, { count: provider.templates })}`))
  const sources: { id: Source; label: string; count: number }[] = [{ id: 'paperclip', label: t('Paperclip-Katalog'), count: TEMPLATES.length }, ...PROVIDERS.map((provider) => ({ id: provider.id, label: provider.name, count: provider.templates }))]
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
        {shown.map((template) => (
          <li key={template.id}>
            <button type="button" onClick={() => onPick(template)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-accent/60">
              <span className="text-sm font-medium">{template.name}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{template.description}</span>
              <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <Counts template={template} />
                <Popularity template={template} />
                {template.inputs.some((input) => input.required) && <span className="text-amber-700 dark:text-amber-400">{t('Braucht Zugangsdaten')}</span>}
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 && providers.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">{t('Keine Treffer')}</li>}
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
      </p>
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
        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <Counts template={template} />
          <Popularity template={template} />
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
