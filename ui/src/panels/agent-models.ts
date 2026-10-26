import { useEffect, useState } from 'react'

import { type AdapterOption, type AdapterOverride, type TemplateAgent, adapterOptions, errorMessage } from '@/lib/client'
import { t } from '@/i18n'

/// The adapter an agent runs with and its model; an empty model is the adapter's own default.
export interface Choice {
  type: string
  model: string
}

/// What Paperclip makes of an agent whose package names no adapter: a command without AI.
export const NO_AI = 'process'
const PREFERRED = 'claude_local'

/// Product names, which stay the same in every language.
const NAMES: Record<string, string> = {
  claude_local: 'Claude Code',
  codex_local: 'Codex',
  gemini_local: 'Gemini CLI',
  opencode_local: 'OpenCode',
  cursor: 'Cursor',
  cursor_cloud: 'Cursor Cloud',
  kimi_local: 'Kimi',
  grok_local: 'Grok',
  pi_local: 'Pi',
  acpx_local: 'ACPX',
  openclaw_gateway: 'OpenClaw',
  paperclip_runner: 'Paperclip Runner',
  hermes_local: 'Hermes',
}

export const adapterName = (type: string) => (type === NO_AI ? t('Ohne KI (Befehl)') : (NAMES[type] ?? type))

export const declared = (agent: TemplateAgent): Choice | null => (agent.adapterType && agent.adapterType !== NO_AI ? { type: agent.adapterType, model: agent.model ?? '' } : null)

/// Claude Code with a Sonnet model where Paperclip offers it: the user's own subscription, and the middle of its models.
export function standardOf(options: AdapterOption[]): Choice {
  const adapter = options.find((option) => option.type === PREFERRED) ?? options.find((option) => option.type !== NO_AI)
  if (!adapter) return { type: NO_AI, model: '' }
  return { type: adapter.type, model: adapter.models.find((model) => /sonnet/i.test(model.id))?.id ?? '' }
}

export interface AgentModels {
  options: AdapterOption[] | null
  error: string | null
  choice: (agent: TemplateAgent) => Choice
  setChoice: (slug: string, choice: Choice) => void
  standard: Choice | null
  setStandard: (choice: Choice) => void
  applyToAll: (agents: TemplateAgent[]) => void
  /// What to tell Paperclip's import: only the agents whose choice differs from what their package names.
  overrides: (agents: TemplateAgent[]) => Record<string, AdapterOverride>
}

/// The choices start from what each agent's package names and, for an agent naming nothing, from the standard.
export function useAgentModels(connected: boolean): AgentModels {
  const [options, setOptions] = useState<AdapterOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [own, setOwn] = useState<Record<string, Choice>>({})
  const [chosenStandard, setStandard] = useState<Choice | null>(null)

  useEffect(() => {
    if (!connected) return
    let current = true
    adapterOptions()
      .then((next) => current && setOptions(next))
      .catch((e: unknown) => current && setError(errorMessage(e)))
    return () => {
      current = false
    }
  }, [connected])

  const standard = chosenStandard ?? (options ? standardOf(options) : null)
  const choice = (agent: TemplateAgent) => own[agent.slug] ?? declared(agent) ?? standard ?? { type: NO_AI, model: '' }
  return {
    options,
    error,
    choice,
    setChoice: (slug, next) => setOwn((current) => ({ ...current, [slug]: next })),
    standard,
    setStandard,
    applyToAll: (agents) => standard && setOwn(Object.fromEntries(agents.map((agent) => [agent.slug, standard]))),
    overrides: (agents) =>
      Object.fromEntries(
        agents.flatMap((agent) => {
          const chosen = choice(agent)
          const named = declared(agent)
          if (named && named.type === chosen.type && named.model === chosen.model) return []
          return [[agent.slug, { adapterType: chosen.type, adapterConfig: chosen.model ? { model: chosen.model } : {} }]]
        }),
      ),
  }
}

export function choiceLabel(choice: Choice, options: AdapterOption[] | null) {
  if (choice.type === NO_AI) return adapterName(NO_AI)
  const model = options?.find((option) => option.type === choice.type)?.models.find((known) => known.id === choice.model)?.label ?? choice.model
  return model ? `${adapterName(choice.type)} · ${model}` : adapterName(choice.type)
}
