import { useState } from 'react'
import { ArrowLeft, Check, CircleAlert, LoaderCircle, Monitor, Play, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'

import RemoteConnections from '@/connect/RemoteConnections'
import RemoteForm from '@/connect/RemoteForm'
import { AppMark } from '@/components/app-mark'
import { SwitchRow } from '@/components/setting-row'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type BootStep,
  type ConnectionMode,
  type ConnectionProfile,
  LOCAL_PROFILE_ID,
  type LauncherView,
  type RemoteConnect,
  type Snapshot,
  cancelConnect,
  connectLocal,
  connectRemote,
  connectSavedProfile,
  errorMessage,
  rememberLocal as saveRememberLocal,
  returnToCurrentSession,
  setChooserMode,
} from '@/lib/client'
import { cn } from '@/lib/utils'
import { type Message, t } from '@/i18n'

const BOOT_STEPS: { step: BootStep; label: Message }[] = [
  { step: 'init', label: 'Initialisierung' },
  { step: 'database', label: 'Datenbank starten' },
  { step: 'server', label: 'Server starten' },
  { step: 'ready', label: 'Oberfläche laden' },
]

type Action = { kind: 'local'; remember: boolean } | { kind: 'remote'; payload: RemoteConnect } | { kind: 'saved'; profileId: string; remember: boolean }

function start(action: Action) {
  const started = action.kind === 'local' ? connectLocal(action.remember) : action.kind === 'remote' ? connectRemote(action.payload) : connectSavedProfile(action.profileId, action.remember)
  started.catch((e: unknown) => toast.error(errorMessage(e)))
}

function BootProgress({ snapshot }: { snapshot: Snapshot }) {
  const status = snapshot.bootStatus
  const reached = BOOT_STEPS.findIndex((s) => s.step === status?.step)
  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <AppMark className="size-10" />
          <div className="flex flex-col leading-tight">
            <p className="font-heading text-lg font-semibold tracking-tight">{t('Lokales Paperclip startet')}</p>
            <p className="text-sm text-muted-foreground">{t('Der erste Start richtet die Datenbank ein und dauert etwas länger.')}</p>
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-primary/15" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={status?.progress ?? 0}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.max(status?.progress ?? 0, 2)}%` }} />
        </div>
        <ol className="flex flex-col gap-2.5">
          {BOOT_STEPS.map(({ step, label }, index) => {
            const done = index < reached || status?.progress === 100
            const active = index === reached && !done
            return (
              <li key={step} className={cn('flex items-center gap-3 text-sm', !done && !active && 'text-muted-foreground')}>
                <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border', done && 'border-primary bg-primary text-primary-foreground', active && 'border-primary text-primary')}>
                  {done ? <Check className="size-3" /> : active ? <LoaderCircle className="size-3 animate-spin" /> : null}
                </span>
                <span className={cn(active && 'font-medium')}>{t(label)}</span>
                {active && status && <span className="truncate text-xs text-muted-foreground">{status.detail}</span>}
              </li>
            )
          })}
        </ol>
        <Button variant="outline" className="self-center" onClick={() => cancelConnect().catch((e: unknown) => toast.error(errorMessage(e)))}>
          <X /> {t('Abbrechen')}
        </Button>
      </CardContent>
    </Card>
  )
}

function Connecting({ snapshot }: { snapshot: Snapshot }) {
  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <LoaderCircle className="size-8 animate-spin text-primary" />
        <p className="font-heading text-lg font-semibold tracking-tight">{snapshot.label ?? t('Geprüfter Remote wird geöffnet …')}</p>
        {snapshot.url && <p className="font-mono text-xs break-all text-muted-foreground">{snapshot.url}</p>}
        <Button variant="outline" className="self-center" onClick={() => cancelConnect().catch((e: unknown) => toast.error(errorMessage(e)))}>
          <X /> {t('Abbrechen')}
        </Button>
      </CardContent>
    </Card>
  )
}

/// Starting the local server or picking a remote; while the app connects, the progress and what went wrong.
export default function Connect({ snapshot, onChanged }: { snapshot: Snapshot; onChanged: (snapshot: Snapshot) => void }) {
  const [view, setView] = useState<LauncherView>(snapshot.view)
  const [tab, setTab] = useState<ConnectionMode>(snapshot.view === 'saved' ? 'remote_existing' : snapshot.state.chooserMode)
  const remembered = snapshot.state.autoConnectLastProfile ? snapshot.state.activeProfileId : null
  const [rememberLocal, setRememberLocal] = useState(remembered === LOCAL_PROFILE_ID)
  const [rememberRemote, setRememberRemote] = useState(remembered !== null && remembered !== LOCAL_PROFILE_ID)
  const [lastAction, setLastAction] = useState<Action | null>(null)

  // The app decides the view when it starts or finishes something; in between the user moves around freely.
  const [seenViewSeq, setSeenViewSeq] = useState(snapshot.viewSeq)
  if (snapshot.viewSeq !== seenViewSeq) {
    setSeenViewSeq(snapshot.viewSeq)
    setView(snapshot.view)
    if (snapshot.view === 'saved') setTab('remote_existing')
  }

  function run(action: Action) {
    setLastAction(action)
    start(action)
  }

  function switchTab(value: string) {
    const mode = value as ConnectionMode
    setTab(mode)
    setChooserMode(mode).catch(() => undefined)
  }

  const localRunning = snapshot.hasCurrentConnection && snapshot.currentProfileId === LOCAL_PROFILE_ID
  const remotes = snapshot.profiles.filter((profile) => profile.mode === 'remote_existing')
  const retry = lastAction ?? (snapshot.state.activeProfileId ? ({ kind: 'saved', profileId: snapshot.state.activeProfileId, remember: remembered !== null } satisfies Action) : null)

  if (view === 'local-boot') return <BootProgress snapshot={snapshot} />
  if (view === 'connecting') return <Connecting snapshot={snapshot} />

  if (view === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>{snapshot.connectionError?.title ?? t('Verbindung fehlgeschlagen')}</AlertTitle>
          <AlertDescription className="max-h-72 overflow-y-auto break-words whitespace-pre-wrap">{snapshot.connectionError?.detail}</AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-2">
          {retry && (
            <Button variant="outline" onClick={() => run(retry)}>
              <RotateCcw /> {t('Erneut versuchen')}
            </Button>
          )}
          <Button variant="outline" onClick={() => setView('chooser')}>
            <ArrowLeft /> {t('Zur Auswahl')}
          </Button>
          {retry?.kind !== 'local' && (
            <Button onClick={() => run({ kind: 'local', remember: false })}>
              <Monitor /> {t('Lokal starten')}
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {snapshot.hasCurrentConnection && !localRunning && (
        <Alert>
          <Check />
          <AlertTitle>{t('Es besteht bereits eine Verbindung')}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            {t('Eine neue Verbindung ersetzt sie.')}
            <Button size="sm" variant="outline" onClick={() => returnToCurrentSession().catch((e: unknown) => toast.error(errorMessage(e)))}>
              <ArrowLeft /> {t('Zurück zu {name}', { name: snapshot.currentConnectionName ?? '' })}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={switchTab} className="gap-6">
        <TabsList className="self-start">
          <TabsTrigger value="local_embedded">{t('Lokal')}</TabsTrigger>
          <TabsTrigger value="remote_existing">{t('Remote')}</TabsTrigger>
        </TabsList>

        <TabsContent value="local_embedded">
          <Card className="relative overflow-hidden py-0">
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/12 via-transparent to-transparent" />
            <CardContent className="relative flex flex-col gap-5 p-6">
              <div className="flex items-center gap-4">
                <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Monitor className="size-7" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="font-heading text-2xl font-semibold tracking-tight">{localRunning ? t('Lokaler Server läuft') : t('Lokalen Server starten')}</p>
                  <p className="text-sm text-muted-foreground">
                    {localRunning
                      ? t('Paperclip ist mit dem Server auf diesem Rechner verbunden. Er läuft, bis das letzte Fenster geschlossen wird.')
                      : t('Startet den mitgelieferten Paperclip-Server auf diesem Rechner, mit vertrauenswürdigem lokalem Zugriff.')}
                  </p>
                </div>
                {localRunning ? (
                  <Button size="lg" variant="outline" onClick={() => returnToCurrentSession().catch((e: unknown) => toast.error(errorMessage(e)))}>
                    <ArrowLeft /> {t('Zu Paperclip')}
                  </Button>
                ) : (
                  <Button size="lg" disabled={snapshot.localServerVersion === null} onClick={() => run({ kind: 'local', remember: rememberLocal })}>
                    <Play /> {t('Starten')}
                  </Button>
                )}
              </div>
              {snapshot.localServerVersion === null ? (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertTitle>{t('Der Paperclip-Server fehlt')}</AlertTitle>
                  <AlertDescription>{t('Dieser Build kann ihn nicht nachladen. Im Repository legt „npm run prepare-server“ ihn an.')}</AlertDescription>
                </Alert>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Paperclip-Server {snapshot.localServerVersion}
                  {!snapshot.localServerInstalled && ` · ${t('wird beim ersten Start heruntergeladen (einige hundert MB)')}`}
                </p>
              )}
              <div className="border-t pt-3.5">
                <SwitchRow
                  id="remember-local"
                  label={t('Beim Start immer lokal starten')}
                  description={t('Überspringt diese Auswahl; über das Menü „Verbinden“ kommst du jederzeit hierher zurück.')}
                  checked={rememberLocal}
                  onChange={(checked) => {
                    setRememberLocal(checked)
                    if (localRunning) saveRememberLocal(checked).then(onChanged).catch((e: unknown) => toast.error(errorMessage(e)))
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="remote_existing" className="flex flex-col gap-6">
          <RemoteConnections
            profiles={remotes}
            currentProfileId={snapshot.currentProfileId}
            rememberChoice={rememberRemote}
            onRememberChoice={setRememberRemote}
            onConnect={(profile: ConnectionProfile) => run({ kind: 'saved', profileId: profile.id, remember: rememberRemote })}
            onChanged={onChanged}
          />
          <RemoteForm rememberChoice={rememberRemote} onConnect={(payload) => run({ kind: 'remote', payload })} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
