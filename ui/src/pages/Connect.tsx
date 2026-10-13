import { type ReactNode, useState } from 'react'
import { ArrowLeft, Check, CircleAlert, Globe, LoaderCircle, type LucideIcon, Monitor, Play, Plus, RotateCcw, ShieldAlert, X } from 'lucide-react'
import { toast } from 'sonner'

import { AppMark } from '@/components/app-mark'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { TONE_DOT, profileHealth, relativeTime } from '@/connect/format'
import { type BootStep, LOCAL_PROFILE_ID, type LauncherView, type Snapshot, cancelConnect, connectLocal, connectSavedProfile, errorMessage, returnToCurrentSession, showPage } from '@/lib/client'
import { cn } from '@/lib/utils'
import { type Message, t } from '@/i18n'

const BOOT_STEPS: { step: BootStep; label: Message }[] = [
  { step: 'init', label: 'Initialisierung' },
  { step: 'database', label: 'Datenbank starten' },
  { step: 'server', label: 'Server starten' },
  { step: 'ready', label: 'Oberfläche laden' },
]

type Action = { kind: 'local' } | { kind: 'saved'; profileId: string }

const failed = (e: unknown) => toast.error(errorMessage(e))

function start(action: Action) {
  const started = action.kind === 'local' ? connectLocal() : connectSavedProfile(action.profileId)
  started.catch(failed)
}

/// One centred column for everything between choosing a connection and having it: progress, waiting, failure.
function Status({ mark, title, children }: { mark: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[calc(100svh-7rem)] w-full max-w-lg flex-col items-center justify-center gap-6 pb-16 text-center">
      {mark}
      <h2 className="font-heading text-2xl font-semibold tracking-tight">{title}</h2>
      {children}
    </div>
  )
}

function Cancel() {
  return (
    <Button variant="outline" onClick={() => cancelConnect().catch(failed)}>
      <X /> {t('Abbrechen')}
    </Button>
  )
}

function BootProgress({ snapshot }: { snapshot: Snapshot }) {
  const status = snapshot.bootStatus
  const progress = status?.progress ?? 0
  const reached = progress === 100 ? BOOT_STEPS.length : BOOT_STEPS.findIndex((s) => s.step === status?.step)
  return (
    <Status mark={<AppMark className="size-14" />} title={t('Lokales Paperclip startet')}>
      <p className="-mt-4 min-h-5 text-sm text-muted-foreground" aria-live="polite">
        {status?.detail}
      </p>
      <div className="flex w-full flex-col gap-3">
        <div className="h-1 overflow-hidden rounded-full bg-primary/15" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.max(progress, 2)}%` }} />
        </div>
        <ol className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs">
          {BOOT_STEPS.map(({ step, label }, index) => (
            <li
              key={step}
              aria-current={index === reached ? 'step' : undefined}
              className={cn('flex items-center gap-1 whitespace-nowrap', index > reached && 'text-muted-foreground', index === reached && 'font-medium')}
            >
              {index < reached && <Check className="size-3 shrink-0 text-primary" />}
              {index === reached && <LoaderCircle className="size-3 shrink-0 animate-spin" />}
              {t(label)}
            </li>
          ))}
        </ol>
      </div>
      <p className="text-xs text-muted-foreground">{t('Der erste Start richtet die Datenbank ein und dauert etwas länger.')}</p>
      <Cancel />
    </Status>
  )
}

function Connecting({ snapshot }: { snapshot: Snapshot }) {
  return (
    <Status mark={<AppMark className="size-14" />} title={snapshot.label ?? t('Geprüfter Remote wird geöffnet …')}>
      {snapshot.url && <p className="-mt-4 font-mono text-xs break-all text-muted-foreground">{snapshot.url}</p>}
      <LoaderCircle className="size-6 animate-spin text-primary" />
      <Cancel />
    </Status>
  )
}

/// One place to connect to. The card of the connection in use leads back to it instead of opening it again.
function ConnectionCard({
  icon: Icon,
  name,
  status,
  current,
  children,
  action,
}: {
  icon: LucideIcon
  name: string
  status: ReactNode
  current: boolean
  children: ReactNode
  action: ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg', current ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
            <Icon className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="truncate font-heading font-semibold tracking-tight">{name}</p>
            <div className="flex items-center gap-2.5 text-xs text-muted-foreground">{status}</div>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">{children}</div>
        {current ? (
          <Button onClick={() => returnToCurrentSession().catch(failed)}>
            <ArrowLeft /> {t('Zu Paperclip')}
          </Button>
        ) : (
          action
        )}
      </CardContent>
    </Card>
  )
}

/// Every connection as a card to open it; while the app connects, the progress and what went wrong.
export default function Connect({ snapshot }: { snapshot: Snapshot }) {
  const [view, setView] = useState<LauncherView>(snapshot.view)
  const [lastAction, setLastAction] = useState<Action | null>(null)

  // The app decides the view when it starts or finishes something; in between the user moves around freely.
  const [seenViewSeq, setSeenViewSeq] = useState(snapshot.viewSeq)
  if (snapshot.viewSeq !== seenViewSeq) {
    setSeenViewSeq(snapshot.viewSeq)
    setView(snapshot.view)
  }

  function run(action: Action) {
    setLastAction(action)
    start(action)
  }

  const current = snapshot.hasCurrentConnection ? snapshot.currentProfileId : null
  const remotes = snapshot.profiles.filter((profile) => profile.mode === 'remote_existing')
  const retry = lastAction ?? (snapshot.state.activeProfileId ? ({ kind: 'saved', profileId: snapshot.state.activeProfileId } satisfies Action) : null)
  const lastLocal = relativeTime(snapshot.state.localLastConnectedAt)

  if (view === 'local-boot') return <BootProgress snapshot={snapshot} />
  if (view === 'connecting') return <Connecting snapshot={snapshot} />

  if (view === 'error') {
    return (
      <Status
        mark={
          <span className="grid size-14 place-items-center rounded-full bg-destructive/10 text-destructive">
            <CircleAlert className="size-7" />
          </span>
        }
        title={snapshot.connectionError?.title ?? t('Verbindung fehlgeschlagen')}
      >
        {snapshot.connectionError?.detail && (
          <p className="-mt-2 max-h-60 w-full overflow-y-auto rounded-lg border bg-muted/40 px-4 py-3 text-left text-sm break-words whitespace-pre-wrap text-muted-foreground select-text">
            {snapshot.connectionError.detail}
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          {retry && (
            <Button variant={retry.kind === 'local' ? 'default' : 'outline'} onClick={() => run(retry)}>
              <RotateCcw /> {t('Erneut versuchen')}
            </Button>
          )}
          <Button variant="outline" onClick={() => setView('chooser')}>
            <ArrowLeft /> {t('Zur Auswahl')}
          </Button>
          {retry?.kind !== 'local' && (
            <Button onClick={() => run({ kind: 'local' })}>
              <Monitor /> {t('Lokal starten')}
            </Button>
          )}
        </div>
      </Status>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
        <ConnectionCard
          icon={Monitor}
          name={t('Lokal')}
          current={current === LOCAL_PROFILE_ID}
          status={
            current === LOCAL_PROFILE_ID ? (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className={cn('size-1.5 rounded-full', TONE_DOT.ok)} />
                {t('Lokaler Server läuft')}
              </span>
            ) : (
              snapshot.localServerVersion !== null && `Paperclip-Server ${snapshot.localServerVersion}`
            )
          }
          action={
            <Button variant={current === null ? 'default' : 'outline'} disabled={snapshot.localServerVersion === null} onClick={() => run({ kind: 'local' })}>
              <Play /> {t('Starten')}
            </Button>
          }
        >
          {snapshot.localServerVersion === null ? (
            <p className="text-destructive">
              {t('Der Paperclip-Server fehlt')}. {t('Dieser Build kann ihn nicht nachladen. Im Repository legt „npm run prepare-server“ ihn an.')}
            </p>
          ) : (
            <>
              <p>{t('Startet den mitgelieferten Paperclip-Server auf diesem Rechner, mit vertrauenswürdigem lokalem Zugriff.')}</p>
              <p>{snapshot.localServerInstalled ? lastLocal && t('Zuletzt verbunden {when}', { when: lastLocal }) : t('wird beim ersten Start heruntergeladen (einige hundert MB)')}</p>
            </>
          )}
        </ConnectionCard>

        {remotes.map((profile) => {
          const health = profileHealth(profile)
          const last = relativeTime(profile.lastConnectedAt)
          return (
            <ConnectionCard
              key={profile.id}
              icon={Globe}
              name={profile.name}
              current={current === profile.id}
              status={
                <>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className={cn('size-1.5 rounded-full', TONE_DOT[health.tone])} />
                    {health.label}
                  </span>
                  {profile.allowInsecureHttp && (
                    <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                      <ShieldAlert className="size-3" /> HTTP
                    </span>
                  )}
                </>
              }
              action={
                <Button variant="outline" onClick={() => run({ kind: 'saved', profileId: profile.id })}>
                  {t('Verbinden')}
                </Button>
              }
            >
              <p className="truncate font-mono">{profile.remoteUrl}</p>
              {last && <p>{t('Zuletzt verbunden {when}', { when: last })}</p>}
            </ConnectionCard>
          )
        })}

        <button
          type="button"
          onClick={() => showPage('connections').catch(failed)}
          className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <Plus className="size-5" />
          {t('Remote hinzufügen')}
        </button>
      </div>

      {current !== null && (
        <p className="text-xs text-muted-foreground">
          {t('Es besteht bereits eine Verbindung')}. {t('Eine neue Verbindung ersetzt sie.')}
        </p>
      )}
    </div>
  )
}
