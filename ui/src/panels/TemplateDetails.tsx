import { useEffect, useState } from 'react'
import { ArrowLeft, CircleAlert, ExternalLink, KeyRound, LoaderCircle } from 'lucide-react'

import DataTable from '@/components/data-table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type ProjectLink, type Snapshot, type TemplateAgent, type TemplateSkill, errorMessage, githubCliSignedIn, importCompanyTemplate, openProjectLink } from '@/lib/client'
import { toast } from '@/lib/notifications'
import { t } from '@/i18n'
import type { Template, TemplateTeam } from './catalog'
import { type AgentModels, choiceLabel, useAgentModels } from './agent-models'
import AgentModelTable from './AgentModels'
import NeedsPaperclip from './NeedsPaperclip'
import OrgChart from './OrgChart'

const openLink = (link: ProjectLink) => void openProjectLink(link).catch((e: unknown) => toast.error(errorMessage(e)))
/// The environment inputs a GitHub token fills; the GitHub CLI has one when the user is signed in there.
const GITHUB_TOKENS = ['GH_TOKEN', 'GITHUB_TOKEN']

function ImportForm({ template, models, onModels, onDone }: { template: Template; models: AgentModels; onModels: () => void; onDone: () => void }) {
  const [name, setName] = useState(template.name)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [githubCli, setGithubCli] = useState(false)
  const [useGithubCli, setUseGithubCli] = useState(true)
  const githubKeys = template.inputs.map((input) => input.key).filter((key) => GITHUB_TOKENS.includes(key))
  useEffect(() => {
    if (githubKeys.length === 0) return
    let current = true
    githubCliSignedIn()
      .then((signedIn) => current && setGithubCli(signedIn))
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [githubKeys.length])
  const fromGithubCli = githubCli && useGithubCli ? githubKeys : []
  const required = template.inputs.filter((input) => input.required && !fromGithubCli.includes(input.key))
  const optional = template.inputs.filter((input) => !input.required && !fromGithubCli.includes(input.key))
  const missing = required.some((input) => !secrets[input.key]?.trim())
  const used = [...new Map(template.agents.map((agent) => choiceLabel(models.choice(agent), models.options)).map((label, _, all) => [label, all.filter((other) => other === label).length]))]

  function start() {
    setRunning(true)
    setError(null)
    importCompanyTemplate({ catalog: template.id }, name, secrets, fromGithubCli, models.overrides(template.agents))
      .then(() => {
        toast.success(t('Firma „{name}“ angelegt.', { name: name.trim() || template.name }))
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

      {githubCli && githubKeys.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Switch id="github-cli" checked={useGithubCli} disabled={running} onCheckedChange={setUseGithubCli} />
            <Label htmlFor="github-cli">{t('{keys} aus der GitHub CLI übernehmen', { keys: githubKeys.join(', ') })}</Label>
          </div>
          <p className="text-xs text-muted-foreground">{t('Die App holt das Token erst beim Import von der GitHub CLI; Paperclip legt daraus ein Secret an.')}</p>
        </div>
      )}

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
        <Button disabled={running || missing || models.options === null} onClick={start}>
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
  // A company of peers has no bosses and some bring no skills; columns of nothing but dashes say nothing.
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
export default function TemplateDetails({ template, snapshot, icon, summary, onBack, onDone }: { template: Template; snapshot: Snapshot; icon: React.ReactNode; summary: React.ReactNode; onBack: () => void; onDone: () => void }) {
  const models = useAgentModels(snapshot.hasCurrentConnection)
  const [tab, setTab] = useState('agents')

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
          <h3 className="font-heading text-lg font-medium">{template.name}</h3>
          <p className="text-sm text-muted-foreground">{template.description}</p>
          <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">{summary}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => openLink({ template: template.id })}>
            <ExternalLink /> {t('Vorlage auf GitHub')}
          </Button>
          <Button variant="outline" size="sm" title={template.source} onClick={() => openLink({ template_source: template.source })}>
            <ExternalLink /> {t('Quell-Repo auf GitHub')}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {template.goals.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              {template.goals.map((goal) => (
                <li key={goal}>{goal}</li>
              ))}
            </ul>
          )}
          <Tabs value={tab} onValueChange={setTab} className="gap-3">
            <TabsList>
              <TabsTrigger value="agents">{t('Agenten · {count}', { count: template.agents.length })}</TabsTrigger>
              <TabsTrigger value="hierarchy">{t('Hierarchie')}</TabsTrigger>
              {template.teams.length > 0 && <TabsTrigger value="teams">{t('Teams · {count}', { count: template.teams.length })}</TabsTrigger>}
              <TabsTrigger value="skills">{t('Skills · {count}', { count: template.skills.length })}</TabsTrigger>
              <TabsTrigger value="models">{t('KI der Agenten')}</TabsTrigger>
            </TabsList>
            <TabsContent value="agents">
              <AgentTable agents={template.agents} />
            </TabsContent>
            <TabsContent value="hierarchy" className="rounded-md border p-3">
              <OrgChart agents={template.agents} />
            </TabsContent>
            <TabsContent value="teams">
              <TeamTable teams={template.teams} agents={template.agents} />
            </TabsContent>
            <TabsContent value="skills">
              <SkillTable skills={template.skills} agents={template.agents} />
            </TabsContent>
            <TabsContent value="models">
              <NeedsPaperclip snapshot={snapshot}>
                <AgentModelTable agents={template.agents} models={models} />
              </NeedsPaperclip>
            </TabsContent>
          </Tabs>
        </div>
        <aside className="flex flex-col gap-4 self-start rounded-md border p-4 lg:sticky lg:top-0">
          <span className="font-heading text-sm font-medium">{t('Als neue Firma importieren')}</span>
          <NeedsPaperclip snapshot={snapshot}>
            <ImportForm template={template} models={models} onModels={() => setTab('models')} onDone={onDone} />
          </NeedsPaperclip>
        </aside>
      </div>
    </div>
  )
}
