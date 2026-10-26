import { CircleAlert, LoaderCircle } from 'lucide-react'

import DataTable from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { type AdapterOption, type TemplateAgent } from '@/lib/client'
import { t } from '@/i18n'
import { type AgentModels, type Choice, NO_AI, adapterName, choiceLabel, declared, standardOf } from './agent-models'

const DEFAULT_MODEL = '__default'

function ChoiceSelect({ options, value, extraModel, onChange }: { options: AdapterOption[]; value: Choice; extraModel?: string | null; onChange: (choice: Choice) => void }) {
  const adapter = options.find((option) => option.type === value.type)
  const models = [...(adapter?.models ?? [])]
  // A model the package names stays choosable even when Paperclip does not list it.
  for (const id of [value.model, extraModel]) if (id && !models.some((model) => model.id === id)) models.push({ id, label: id })
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={value.type} onValueChange={(type) => onChange({ type, model: type === value.type ? value.model : standardOf(options.filter((option) => option.type === type)).model })}>
        <SelectTrigger size="sm" className="h-7 w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.type} value={option.type}>
              {adapterName(option.type)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.type !== NO_AI && (
        <Select value={value.model || DEFAULT_MODEL} onValueChange={(model) => onChange({ ...value, model: model === DEFAULT_MODEL ? '' : model })}>
          <SelectTrigger size="sm" className="h-7 w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_MODEL}>{t('Standard des Adapters')}</SelectItem>
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

/// Which AI each agent works with: a standard for all, and any agent set apart in the table.
export default function AgentModelTable({ agents, models }: { agents: TemplateAgent[]; models: AgentModels }) {
  const { options, error, standard } = models
  if (error) {
    return (
      <p className="flex items-start gap-2 text-sm text-destructive">
        <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
      </p>
    )
  }
  if (!options || !standard) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" /> {t('Paperclip nennt seine KI-Adapter …')}
      </p>
    )
  }
  const unnamed = agents.filter((agent) => !declared(agent)).length
  const usable = options.filter((option) => option.type !== NO_AI)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t('Ein Agent ohne Angabe in der Vorlage liefe in Paperclip nur als Befehl ohne KI. Claude Code arbeitet mit deinem Claude-Abo auf diesem PC; andere Adapter brauchen ihr eigenes Programm oder Konto.')}
      </p>
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
        <span className="text-sm font-medium">{t('Standard')}</span>
        <ChoiceSelect options={usable} value={standard} onChange={models.setStandard} />
        <span className="text-xs text-muted-foreground">{t('für {count} Agenten ohne Angabe', { count: unnamed })}</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => models.applyToAll(agents)}>
          {t('Für alle übernehmen')}
        </Button>
      </div>
      <DataTable
        rows={agents}
        rowKey={(agent) => agent.slug}
        text={(agent) => [agent.name, agent.title ?? '', choiceLabel(models.choice(agent), options)].join('\n').toLocaleLowerCase()}
        searchLabel={t('Agent suchen')}
        columns={[
          { id: 'name', header: t('Agent'), sort: (agent) => agent.name, className: 'font-medium', cell: (agent) => agent.name },
          { id: 'template', header: t('Vorgabe der Vorlage'), sort: (agent) => (declared(agent) ? choiceLabel(declared(agent)!, options) : null), className: 'text-xs text-muted-foreground', cell: (agent) => (declared(agent) ? choiceLabel(declared(agent)!, options) : t('keine')) },
          { id: 'choice', header: t('Arbeitet mit'), sort: (agent) => choiceLabel(models.choice(agent), options), cell: (agent) => <ChoiceSelect options={options} value={models.choice(agent)} extraModel={agent.model} onChange={(next) => models.setChoice(agent.slug, next)} /> },
        ]}
        filters={[
          { id: 'adapter', label: t('Arbeitet mit'), options: options.map((option) => ({ id: option.type, label: adapterName(option.type), test: (agent: TemplateAgent) => models.choice(agent).type === option.type })) },
          {
            id: 'declared',
            label: t('Vorgabe der Vorlage'),
            options: [
              { id: 'yes', label: t('Mit Vorgabe'), test: (agent) => declared(agent) !== null },
              { id: 'no', label: t('Ohne Vorgabe'), test: (agent) => declared(agent) === null },
            ],
          },
        ]}
        className="max-h-[60vh]"
      />
    </div>
  )
}
