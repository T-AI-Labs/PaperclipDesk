import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CircleAlert, ExternalLink, KeyRound, LoaderCircle } from 'lucide-react'

import DataTable from '@/components/data-table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type FoundTemplate, type PackageFile, type ProjectLink, type Snapshot, type TemplateAgent, type TemplateInput, type TemplateSkill, type TemplateSource, errorMessage, importCompanyTemplate, openProjectLink, previewCompanyTemplate } from '@/lib/client'
import { toast } from '@/lib/notifications'
import { t } from '@/i18n'
import type { Template, TemplateTeam } from './catalog'
import { type ClipmartTemplate, clipmartFindings, clipmartPackage, clipmartSkills } from './clipmart'
import type { Collection } from './collections'
import { type AgentModels, choiceLabel, useAgentModels } from './agent-models'
import AgentModelTable from './AgentModels'
import NeedsPaperclip from './NeedsPaperclip'
import OrgChart from './OrgChart'

/// A template the user opened: one of the catalog or of Clipmart, a package the GitHub search found, one read from a file
/// or folder, or a collection of agents and skills, which is no company of its own.
export type Picked =
  | { kind: 'catalog'; template: Template }
  | { kind: 'clipmart'; template: ClipmartTemplate }
  | { kind: 'github'; found: FoundTemplate }
  | { kind: 'package'; name: string; files: Record<string, PackageFile> }
  | { kind: 'collection'; collection: Collection }

type Known = Extract<Picked, { kind: 'catalog' | 'clipmart' | 'collection' }>
type Importable = Exclude<Picked, { kind: 'collection' }>

/// Whether the app knows what the template holds without asking Paperclip.
const inSnapshot = (picked: Picked): picked is Known => picked.kind === 'catalog' || picked.kind === 'clipmart' || picked.kind === 'collection'

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

const openLink = (link: ProjectLink) => void openProjectLink(link).catch((e: unknown) => toast.error(errorMessage(e)))

function sourceOf(picked: Importable): TemplateSource {
  if (picked.kind === 'catalog') return { catalog: picked.template.id }
  if (picked.kind === 'clipmart') return { inline: clipmartPackage(picked.template) }
  return picked.kind === 'github' ? { github: picked.found.url } : { inline: picked.files }
}

/// A package from outside the snapshots is read by the Paperclip in front, which knows the format best.
function useContents(picked: Picked, connected: boolean): { contents: Contents | null; error: string | null } {
  const [read, setRead] = useState<{ contents: Contents | null; error: string | null }>({ contents: null, error: null })
  useEffect(() => {
    if (inSnapshot(picked) || !connected) return
    let current = true
    previewCompanyTemplate(sourceOf(picked))
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
  }, [picked, connected])
  if (picked.kind === 'catalog') {
    const { template } = picked
    return { contents: { name: template.name, description: template.description, goals: template.goals, agents: template.agents, skills: template.skills, teams: template.teams, inputs: template.inputs, errors: [] }, error: null }
  }
  if (picked.kind === 'clipmart') {
    const { template } = picked
    return { contents: { name: template.name, description: template.description, goals: template.goals, agents: template.agents, skills: clipmartSkills(template), teams: [], inputs: [], errors: [] }, error: null }
  }
  if (picked.kind === 'collection') {
    const { collection } = picked
    return { contents: { name: collection.name, description: collection.description, goals: [], agents: collection.agents, skills: collection.skills, teams: [], inputs: [], errors: [] }, error: null }
  }
  return read
}

/// What the evaluation of a Clipmart template found: what holds for all of them, then what holds for this one.
function ClipmartFindings({ template }: { template: ClipmartTemplate }) {
  const own = clipmartFindings(template).map((finding) =>
    finding.text === 'unused'
      ? t('{count} der {total} Skills nutzt kein Agent.', { count: finding.count, total: finding.total ?? 0 })
      : finding.text === 'tops'
        ? t('{count} Agenten stehen an der Spitze, ohne gemeinsame Leitung.', { count: finding.count })
        : t('Die Wissensbasis aus {count} Dateien nennt Clipmart nur; das Paket enthält sie nicht.', { count: finding.count }),
  )
  return (
    <Alert>
      <CircleAlert />
      <AlertDescription className="flex flex-col gap-1">
        <span className="font-medium text-foreground">{t('Auswertung')}</span>
        <ul className="flex list-disc flex-col gap-0.5 pl-4">
          {own.map((text) => (
            <li key={text}>{text}</li>
          ))}
          <li>{t('Die Skills sind Platzhalter: Clipmart schreibt für jeden denselben allgemeinen Text.')}</li>
          <li>{t('Die Zeitpläne der Agenten stehen nur in ihrer Anleitung; Paperclip richtet dafür keine Routine ein.')}</li>
          <li>{t('Clipmart prüft die Vorlagen nicht und zählt keine Sterne.')}</li>
          <li>{t('Die App baut das Paket wie Clipmarts Download, setzt aber das Modell jedes Agenten und verlangt keinen ANTHROPIC_API_KEY.')}</li>
        </ul>
      </AlertDescription>
    </Alert>
  )
}

function ImportForm({ picked, contents, models, onModels, onDone }: { picked: Importable; contents: Contents; models: AgentModels; onModels: () => void; onDone: () => void }) {
  const [name, setName] = useState(contents.name)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const required = contents.inputs.filter((input) => input.required)
  const optional = contents.inputs.filter((input) => !input.required)
  const missing = required.some((input) => !secrets[input.key]?.trim())
  const used = [...new Map(contents.agents.map((agent) => choiceLabel(models.choice(agent), models.options)).map((label, _, all) => [label, all.filter((other) => other === label).length]))]

  function start() {
    setRunning(true)
    setError(null)
    importCompanyTemplate(sourceOf(picked), name, secrets, models.overrides(contents.agents))
      .then(() => {
        toast.success(t('Firma „{name}“ angelegt.', { name: name.trim() || contents.name }))
        onDone()
      })
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

      <div className="flex flex-col gap-1.5">
        <Label>{t('KI der Agenten')}</Label>
        <ul className="flex flex-col gap-0.5 text-xs">
          {used.map(([label, count]) => (
            <li key={label} className="flex justify-between gap-2">
              <span className="truncate">{label}</span>
              <span className="text-muted-foreground tabular-nums">{count}</span>
            </li>
          ))}
        </ul>
        <Button variant="link" size="sm" className="self-start px-0" onClick={onModels}>
          {t('Pro Agent ändern')}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col items-start gap-2">
        <Button disabled={running || missing || contents.errors.length > 0 || models.options === null} onClick={start}>
          {running && <LoaderCircle className="animate-spin" />} {running ? t('Wird importiert …') : t('Als neue Firma importieren')}
        </Button>
        {running && <p className="text-xs text-muted-foreground">{t('Große Vorlagen brauchen einige Minuten.')}</p>}
      </div>
    </>
  )
}

function AgentTable({ agents }: { agents: TemplateAgent[] }) {
  const names = new Map(agents.map((agent) => [agent.slug, agent.name]))
  const boss = (agent: TemplateAgent) => (agent.reportsTo ? (names.get(agent.reportsTo) ?? agent.reportsTo) : null)
  const bosses = [...new Set(agents.map(boss).filter((name) => name !== null))].sort((a, b) => a.localeCompare(b))
  // Single agents of a collection report to no one and bring no skills; columns of nothing but dashes say nothing.
  const withSkills = agents.some((agent) => agent.skills.length > 0)
  return (
    <DataTable
      rows={agents}
      rowKey={(agent) => agent.slug}
      text={(agent) => [agent.name, agent.title ?? '', boss(agent) ?? '', ...agent.skills].join('\n').toLocaleLowerCase()}
      searchLabel={t('Agent, Titel oder Skill suchen …')}
      columns={[
        { id: 'name', header: t('Name'), sort: (agent) => agent.name, className: 'font-medium whitespace-nowrap', cell: (agent) => agent.name },
        { id: 'title', header: t('Titel'), sort: (agent) => agent.title, cell: (agent) => <span className="line-clamp-2 text-muted-foreground">{agent.title ?? '–'}</span> },
        ...(bosses.length > 0 ? [{ id: 'boss', header: t('Berichtet an'), sort: boss, cell: (agent: TemplateAgent) => boss(agent) ?? <span className="text-muted-foreground">{t('Spitze')}</span> }] : []),
        ...(withSkills ? [{ id: 'skills', header: t('Skills'), sort: (agent: TemplateAgent) => agent.skills.length, descFirst: true, align: 'end' as const, cell: (agent: TemplateAgent) => agent.skills.length }] : []),
      ]}
      filters={[
        ...(bosses.length > 0 ? [{ id: 'boss', label: t('Berichtet an'), options: [{ id: '', label: t('Spitze'), test: (agent: TemplateAgent) => boss(agent) === null }, ...bosses.map((name) => ({ id: name, label: name, test: (agent: TemplateAgent) => boss(agent) === name }))] }] : []),
        ...(withSkills
          ? [
              {
                id: 'skills',
                label: t('Skills'),
                options: [
                  { id: 'with', label: t('Mit Skills'), test: (agent: TemplateAgent) => agent.skills.length > 0 },
                  { id: 'without', label: t('Ohne Skills'), test: (agent: TemplateAgent) => agent.skills.length === 0 },
                ],
              },
            ]
          : []),
      ]}
      className="max-h-[60vh]"
    />
  )
}

/// A collection has no company to import; its agents and skills are building blocks for the wizard.
function ComposeHint({ collection, onCompose }: { collection: Collection; onCompose: () => void }) {
  return (
    <>
      <span className="text-sm text-muted-foreground">{t('Die Agenten und Skills dieser Sammlung stehen im Assistenten für eine neue Firma zur Wahl, neben denen der Vorlagen.')}</span>
      <span className="text-xs text-muted-foreground">{t('Ihre Dateien lädt die App erst beim Anlegen von GitHub, vom Stand {commit}, und prüft jede gegen ihre Prüfsumme.', { commit: collection.commit.slice(0, 7) })}</span>
      <Button className="self-start" onClick={onCompose}>
        {t('Neue Firma zusammenstellen')} <ArrowRight />
      </Button>
    </>
  )
}

function SkillTable({ skills, agents }: { skills: TemplateSkill[]; agents: TemplateAgent[] }) {
  const users = (skill: TemplateSkill) => agents.filter((agent) => agent.skills.includes(skill.slug)).length
  return (
    <DataTable
      rows={skills}
      rowKey={(skill) => skill.slug}
      text={(skill) => [skill.name, skill.description ?? ''].join('\n').toLocaleLowerCase()}
      searchLabel={t('Skill suchen')}
      columns={[
        { id: 'name', header: t('Skill'), sort: (skill) => skill.name, className: 'font-medium whitespace-nowrap', cell: (skill) => skill.name },
        { id: 'description', header: t('Beschreibung'), cell: (skill) => <span className="line-clamp-2 text-xs text-muted-foreground">{skill.description ?? '–'}</span> },
        { id: 'agents', header: t('Agenten'), sort: users, descFirst: true, align: 'end', cell: users },
      ]}
      filters={[
        {
          id: 'use',
          label: t('Verwendung'),
          options: [
            { id: 'used', label: t('Von Agenten genutzt'), test: (skill) => users(skill) > 0 },
            { id: 'unused', label: t('Von keinem Agenten genutzt'), test: (skill) => users(skill) === 0 },
          ],
        },
      ]}
      className="max-h-[60vh]"
    />
  )
}

function TeamTable({ teams, agents }: { teams: TemplateTeam[]; agents: TemplateAgent[] }) {
  const names = new Map(agents.map((agent) => [agent.slug, agent.name]))
  const manager = (team: TemplateTeam) => (team.manager ? (names.get(team.manager) ?? team.manager) : null)
  return (
    <DataTable
      rows={teams}
      rowKey={(team) => team.slug}
      text={(team) => [team.name, team.description ?? '', manager(team) ?? ''].join('\n').toLocaleLowerCase()}
      searchLabel={t('Team suchen')}
      columns={[
        { id: 'name', header: t('Team'), sort: (team) => team.name, className: 'font-medium', cell: (team) => team.name },
        { id: 'description', header: t('Beschreibung'), cell: (team) => <span className="line-clamp-2 text-xs text-muted-foreground">{team.description ?? '–'}</span> },
        { id: 'manager', header: t('Leitung'), sort: manager, cell: (team) => manager(team) ?? '–' },
        { id: 'members', header: t('Mitglieder'), sort: (team) => team.members.length, descFirst: true, align: 'end', cell: (team) => team.members.length },
      ]}
      className="max-h-[60vh]"
    />
  )
}

/// One template in full: its goals, its agents, hierarchy, teams and skills, and the import beside them.
export default function TemplateDetails({ picked, snapshot, icon, summary, onBack, onDone, onCompose }: { picked: Picked; snapshot: Snapshot; icon: React.ReactNode; summary: React.ReactNode; onBack: () => void; onDone: () => void; onCompose: () => void }) {
  const { contents, error } = useContents(picked, snapshot.hasCurrentConnection)
  const models = useAgentModels(snapshot.hasCurrentConnection)
  const collection = picked.kind === 'collection' ? picked.collection : null
  const [tab, setTab] = useState(collection && collection.agents.length === 0 ? 'skills' : 'agents')
  const name = inSnapshot(picked) ? (contents?.name ?? '') : picked.kind === 'github' ? picked.found.name : contents?.name || picked.name
  const description = picked.kind === 'github' ? picked.found.description : (contents?.description ?? '')

  // Caught before the app's own Escape, which would close the whole page instead of leading back to the list.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const back = (event.key === 'Escape' && !document.querySelector('[data-state=open][role=dialog], [data-radix-popper-content-wrapper]')) || (event.altKey && event.key === 'ArrowLeft')
      if (!back || event.defaultPrevented) return
      event.preventDefault()
      onBack()
    }
    const mouse = (event: MouseEvent) => {
      if (event.button !== 3) return
      event.preventDefault()
      onBack()
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('mouseup', mouse)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('mouseup', mouse)
    }
  }, [onBack])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft /> {t('Alle Vorlagen')}
        </Button>
        {icon}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="font-heading text-lg font-medium">{name}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
          <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">{summary}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {picked.kind === 'catalog' ? (
            <>
              <Button variant="outline" size="sm" onClick={() => openLink({ template: picked.template.id })}>
                <ExternalLink /> {t('Vorlage auf GitHub')}
              </Button>
              <Button variant="outline" size="sm" title={picked.template.source} onClick={() => openLink({ template_source: picked.template.source })}>
                <ExternalLink /> {t('Quell-Repo auf GitHub')}
              </Button>
            </>
          ) : picked.kind === 'clipmart' ? (
            <Button variant="outline" size="sm" onClick={() => openLink({ clipmart_template: picked.template.id })}>
              <ExternalLink /> {t('Auf clipmart.ai ansehen')}
            </Button>
          ) : (
            (picked.kind === 'github' || picked.kind === 'collection') && (
              <Button variant="outline" size="sm" title={picked.kind === 'github' ? picked.found.repository : picked.collection.id} onClick={() => openLink({ template_source: picked.kind === 'github' ? picked.found.repository : picked.collection.id })}>
                <ExternalLink /> {t('Repo auf GitHub')}
              </Button>
            )
          )}
        </div>
      </div>

      {/* Only Paperclip reads a package from outside the snapshots. */}
      {!inSnapshot(picked) && <NeedsPaperclip snapshot={snapshot} />}
      {contents === null && error === null && snapshot.hasCurrentConnection && (
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
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-4">
            {contents.errors.length > 0 && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertDescription className="break-words">{contents.errors.join(' ')}</AlertDescription>
              </Alert>
            )}
            {picked.kind === 'clipmart' && <ClipmartFindings template={picked.template} />}
            {contents.goals.length > 0 && (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                {contents.goals.map((goal) => (
                  <li key={goal}>{goal}</li>
                ))}
              </ul>
            )}
            <Tabs value={tab} onValueChange={setTab} className="gap-3">
              <TabsList>
                {(!collection || contents.agents.length > 0) && <TabsTrigger value="agents">{t('Agenten · {count}', { count: contents.agents.length })}</TabsTrigger>}
                {!collection && <TabsTrigger value="hierarchy">{t('Hierarchie')}</TabsTrigger>}
                {contents.teams.length > 0 && <TabsTrigger value="teams">{t('Teams · {count}', { count: contents.teams.length })}</TabsTrigger>}
                {(!collection || contents.skills.length > 0) && <TabsTrigger value="skills">{t('Skills · {count}', { count: contents.skills.length })}</TabsTrigger>}
                {!collection && <TabsTrigger value="models">{t('KI der Agenten')}</TabsTrigger>}
              </TabsList>
              <TabsContent value="agents">
                <AgentTable agents={contents.agents} />
              </TabsContent>
              <TabsContent value="hierarchy" className="rounded-md border p-3">
                <OrgChart agents={contents.agents} />
              </TabsContent>
              <TabsContent value="teams">
                <TeamTable teams={contents.teams} agents={contents.agents} />
              </TabsContent>
              <TabsContent value="skills">
                <SkillTable skills={contents.skills} agents={contents.agents} />
              </TabsContent>
              <TabsContent value="models">
                <NeedsPaperclip snapshot={snapshot}>
                  <AgentModelTable agents={contents.agents} models={models} />
                </NeedsPaperclip>
              </TabsContent>
            </Tabs>
          </div>
          <aside className="flex flex-col gap-4 self-start rounded-md border p-4 lg:sticky lg:top-0">
            {picked.kind === 'collection' ? (
              <>
                <span className="font-heading text-sm font-medium">{t('Für eine neue Firma nutzen')}</span>
                <ComposeHint collection={picked.collection} onCompose={onCompose} />
              </>
            ) : (
              <>
                <span className="font-heading text-sm font-medium">{t('Als neue Firma importieren')}</span>
                <NeedsPaperclip snapshot={snapshot}>
                  <ImportForm key={picked.kind === 'catalog' || picked.kind === 'clipmart' ? `${picked.kind}:${picked.template.id}` : picked.kind === 'github' ? picked.found.url : picked.name} picked={picked} contents={contents} models={models} onModels={() => setTab('models')} onDone={onDone} />
                </NeedsPaperclip>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
