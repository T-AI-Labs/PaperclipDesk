import { useState } from 'react'
import { CircleAlert, LoaderCircle, Sparkles } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { askAssistant, errorMessage } from '@/lib/client'
import { t } from '@/i18n'
import OrgChart from '../OrgChart'
import { type Proposal, type Round, applyProposal, parse, prompt } from './assistant'
import { type Draft, chartAgents } from './compose'

const TEXTAREA = 'w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

/// The page's language in English words, so the assistant writes its questions and proposals in it.
function language(): string {
  const code = document.documentElement.lang || 'en'
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? 'English'
  } catch {
    return 'English'
  }
}

/// Lets Claude propose the company from a description, asking back first when something essential is missing.
export default function AssistantBox({ enabled, draft, onApply }: { enabled: boolean; draft: Draft; onApply: (draft: Draft) => void }) {
  const [description, setDescription] = useState('')
  const [rounds, setRounds] = useState<Round[]>([])
  const [questions, setQuestions] = useState<string[] | null>(null)
  const [answers, setAnswers] = useState<string[]>([])
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!enabled) {
    return <p className="text-xs text-muted-foreground">{t('Ein KI-Assistent kann die Firma aus einer Beschreibung vorschlagen. Einschalten im Zahnrad unter App → KI-Assistent.')}</p>
  }

  async function ask(nextRounds: Round[]) {
    setThinking(true)
    setError(null)
    setProposal(null)
    try {
      const reply = parse(await askAssistant(prompt(description, nextRounds, language())))
      if (reply === null) throw new Error(t('Die Antwort des Assistenten war unverständlich. Bitte noch einmal versuchen.'))
      setRounds(nextRounds)
      if ('questions' in reply) {
        setQuestions(reply.questions)
        setAnswers(reply.questions.map(() => ''))
      } else {
        setQuestions(null)
        setProposal(reply.proposal)
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setThinking(false)
    }
  }

  const preview = proposal && applyProposal(draft, proposal)

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <span className="flex items-center gap-2 text-sm font-medium">
        <Sparkles aria-hidden className="size-4 text-primary" /> {t('KI-Assistent')}
      </span>
      <textarea rows={3} value={description} disabled={thinking} onChange={(event) => setDescription(event.target.value)} placeholder={t('Beschreibe die Firma: wofür, wie groß, worauf es ankommt …')} aria-label={t('Beschreibung für den Assistenten')} className={TEXTAREA} />

      {questions && (
        <div className="flex flex-col gap-2">
          {questions.map((question, index) => (
            <label key={question} className="flex flex-col gap-1 text-sm">
              {question}
              <Input value={answers[index] ?? ''} disabled={thinking} onChange={(event) => setAnswers((known) => known.map((answer, at) => (at === index ? event.target.value : answer)))} />
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {questions ? (
          <Button size="sm" disabled={thinking} onClick={() => void ask([...rounds, { questions, answers }])}>
            {thinking ? <LoaderCircle className="animate-spin" /> : <Sparkles />} {t('Antworten senden')}
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={thinking || !description.trim()} onClick={() => void ask([])}>
            {thinking ? <LoaderCircle className="animate-spin" /> : <Sparkles />} {proposal ? t('Neuer Vorschlag') : t('Vorschlag holen')}
          </Button>
        )}
        {thinking && <span className="text-xs text-muted-foreground">{t('Claude denkt nach, das dauert bis zu einer Minute …')}</span>}
      </div>

      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}

      {proposal && preview && (
        <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-3">
          <span className="text-sm font-medium">{t('Vorschlag: {name}, {count} Agenten', { name: proposal.name || draft.name, count: preview.agents.length })}</span>
          {proposal.description && <span className="text-xs text-muted-foreground">{proposal.description}</span>}
          <OrgChart agents={chartAgents(preview)} open={3} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => onApply(preview)}>
              {t('Übernehmen und anpassen')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setProposal(null)}>
              {t('Verwerfen')}
            </Button>
          </div>
          {draft.agents.length > 0 && <span className="text-xs text-muted-foreground">{t('Ersetzt die {count} Agenten im Entwurf.', { count: draft.agents.length })}</span>}
        </div>
      )}
    </div>
  )
}
