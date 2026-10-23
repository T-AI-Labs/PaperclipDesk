import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, CircleAlert, ExternalLink, KeyRound, LoaderCircle } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type FoundTemplate, type ProjectLink, type TemplateAgent, type TemplateInput, type TemplateSkill, type TemplateSource, errorMessage, importCompanyTemplate, openProjectLink, previewCompanyTemplate } from '@/lib/client'
import { t } from '@/i18n'
import type { Template, TemplateTeam } from './catalog'
import OrgChart from './OrgChart'

/// A template the user opened: one of the catalog, or a package the GitHub search found.
export type Picked = { kind: 'catalog'; template: Template } | { kind: 'github'; found: FoundTemplate }

/// What the details show, the same for both kinds once a found package was read.
interface Contents {
  name: string
  description: string
  goals: string[]
  agents: TemplateAgent[]
  skills: TemplateSkill[]
  teams: TemplateTeam[]
  inputs: TemplateInput[]
  errors: string[]
}

const openLink =(link: ProjectLink) => void openProjectLink(link).catch((e: unknown) => toast.error(errorMessage(e)))

function sourceOf(picked: Picked): TemplateSource {
  return picked.kind === 'catalog' ? { catalog: picked.template.id } : { github: picked.found.url }
}

/// A found package is read by the Paperclip in front, which knows the format best; the catalog's own are in the snapshot.
function useContents(picked: Picked): { contents: Contents | null; error: string | null } {
  const [read, setRead] = useState<{ contents: Contents | null; error: string | null }>({ contents: null, error: null })
  const url = picked.kind === 'github' ? picked.found.url : null
  useEffect(() => {
    if (url === null) return
    let current = true
    previewCompanyTemplate({ github: url })
      .then((preview) => {
        if (!current) return
        // The same variable often turns up once per agent; the form asks for it once.
        const inputs = new Map<string, boolean>()
        for (const input of preview.inputs) inputs.set(input.key, (inputs.get(input.key) ?? false) || input.required)
        setRead({ contents: { name: preview.name ?? '', description: preview.description ?? '', goals: [], agents: preview.agents, skills: preview.skills, teams: [], inputs: [...inputs].map(([key, required]) => ({ key, required })), errors: preview.errors }, error: null })
      })
      .catch((e: unknown) => current && setRead({ contents: null, error: errorMessage(e) }))
    return () => {
      current = false
    }
  }, [url])
  if (picked.kind === 'catalog') {
    const { template } = picked
    return { contents: { name: template.name, description: template.description, goals: template.goals, agents: template.agents, skills: template.skills, teams: template.teams, inputs: template.inputs, errors: [] }, error: null }
  }
  return read
}

function Section({ title, children, open = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="rounded-md border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">{title}</summary>
      <div className="border-t px-3 py-2">{children}</div>
    </details>
  )
}

function ImportForm({ picked, contents, onDone }: { picked: Picked; contents: Contents; onDone: () => void }) {
  const [name, setName] = useState(contents.name)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const required = contents.inputs.filter((input) => input.required)
  const optional = contents.inputs.filter((input) => !input.required)
  const missing = required.some((input) => !secrets[input.key]?.trim())

  function start() {
    setRunning(true)
    setError(null)
    importCompanyTemplate(sourceOf(picked), name, secrets)
      .then(onDone)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setRunning(false))
  }

  return (
    <>
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
        <Button disabled={running || missing || contents.errors.length > 0} onClick={start}>
          {running && <LoaderCircle className="animate-spin" />} {running ? t('Wird importiert …') : t('Als neue Firma importieren')}
        </Button>
        {running && <p className="text-xs text-muted-foreground">{t('Große Vorlagen brauchen einige Minuten.')}</p>}
      </div>
    </>
  )
}

/// One template in full: its goals, its hierarchy, its teams and skills, and the import.
export default function TemplateDetails({ picked, summary, onBack, onDone }: { picked: Picked; summary: React.ReactNode; onBack: () => void; onDone: () => void }) {
  const { contents, error } = useContents(picked)
  const name = picked.kind === 'catalog' ? picked.template.name : picked.found.name
  const description = picked.kind === 'catalog' ? picked.template.description : picked.found.description
  const agentNames = new Map(contents?.agents.map((agent) => [agent.slug, agent.name]))

  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft /> {t('Alle Vorlagen')}
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="font-heading text-base font-medium">{name}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">{summary}</p>
        <p className="flex flex-wrap gap-2 pt-1">
          {picked.kind === 'catalog' ? (
            <>
              <Button variant="outline" size="sm" onClick={() => openLink({ template: picked.template.id })}>
                <ExternalLink /> {t('Vorlage auf GitHub')}
              </Button>
              <Button variant="outline" size="sm" title={picked.template.source} onClick={() => openLink({ template_source: picked.template.source })}>
                <ExternalLink /> {t('Quell-Repo auf GitHub')}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" title={picked.found.repository} onClick={() => openLink({ template_source: picked.found.repository })}>
              <ExternalLink /> {t('Repo auf GitHub')}
            </Button>
          )}
        </p>
      </div>

      {contents === null && error === null && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> {t('Paperclip liest die Vorlage …')}
        </p>
      )}
      {error !== null && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}
      {contents !== null && (
        <>
          {contents.errors.length > 0 && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription className="break-words">{contents.errors.join(' ')}</AlertDescription>
            </Alert>
          )}
          {contents.goals.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              {contents.goals.map((goal) => (
                <li key={goal}>{goal}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2">
            {contents.agents.length > 0 && (
              <Section title={t('Hierarchie · {count} Agenten', { count: contents.agents.length })} open>
                <OrgChart agents={contents.agents} />
              </Section>
            )}
            {contents.teams.length > 0 && (
              <Section title={t('Teams · {count}', { count: contents.teams.length })}>
                <ul className="flex flex-col gap-2 text-sm">
                  {contents.teams.map((team) => (
                    <li key={team.slug} className="flex flex-col">
                      <span className="font-medium">{team.name}</span>
                      {team.description && <span className="text-xs text-muted-foreground">{team.description}</span>}
                      <span className="text-xs text-muted-foreground">
                        {team.manager && t('Leitung: {name}', { name: agentNames.get(team.manager) ?? team.manager })} · {t('{count} Mitglieder', { count: team.members.length })}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {contents.skills.length > 0 && (
              <Section title={t('Skills · {count}', { count: contents.skills.length })}>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {contents.skills.map((skill) => (
                    <li key={skill.slug} className="flex flex-col">
                      <span className="font-medium">{skill.name}</span>
                      {skill.description && <span className="line-clamp-2 text-xs text-muted-foreground">{skill.description}</span>}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
          <ImportForm key={picked.kind === 'catalog' ? picked.template.id : picked.found.url} picked={picked} contents={contents} onDone={onDone} />
        </>
      )}
    </>
  )
}
