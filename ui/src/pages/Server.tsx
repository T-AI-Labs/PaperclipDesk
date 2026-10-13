import { useCallback, useEffect, useState } from 'react'
import { Download, FileCog, LoaderCircle, RotateCcw, Server as ServerIcon, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { SwitchRow } from '@/components/setting-row'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type ConfigFile,
  type ServerConfig,
  type ServerInfo,
  errorMessage,
  getServerInfo,
  readServerConfig,
  reinstallServer,
  resetLocalServer,
  restartLocalServer,
  writeServerConfig,
} from '@/lib/client'
import { t } from '@/i18n'

const FILES: { id: ConfigFile; name: string }[] = [
  { id: 'config', name: 'config.json' },
  { id: 'env', name: '.env' },
]

function ConfigEditor() {
  const [saved, setSaved] = useState<ServerConfig | null>(null)
  const [draft, setDraft] = useState<ServerConfig>({ config: '', env: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    readServerConfig()
      .then((config) => {
        setSaved(config)
        setDraft(config)
      })
      .catch((e: unknown) => toast.error(errorMessage(e)))
  }, [])

  function save(file: ConfigFile) {
    setSaving(true)
    writeServerConfig(file, draft[file])
      .then(() => {
        setSaved((current) => current && { ...current, [file]: draft[file] })
        toast.success(t('Gespeichert. Die Änderung gilt nach einem Neustart des Servers.'))
      })
      .catch((e: unknown) => toast.error(errorMessage(e)))
      .finally(() => setSaving(false))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileCog className="size-4 text-primary" /> {t('Konfiguration')}
        </CardTitle>
        <CardDescription>{t('Der Server liest beide Dateien beim Start. Ein leeres Feld entfernt die Datei, dann gelten die Standardwerte.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="config">
          <TabsList>
            {FILES.map(({ id, name }) => (
              <TabsTrigger key={id} value={id}>
                {name}
              </TabsTrigger>
            ))}
          </TabsList>
          {FILES.map(({ id, name }) => (
            <TabsContent key={id} value={id} className="flex flex-col gap-3">
              <textarea
                aria-label={name}
                rows={2}
                spellCheck={false}
                disabled={saved === null}
                value={draft[id]}
                onChange={(event) => setDraft((current) => ({ ...current, [id]: event.target.value }))}
                className="w-full resize-y rounded-lg border bg-card/60 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <div className="flex justify-end">
                <Button size="sm" disabled={saving || saved === null || saved[id] === draft[id]} onClick={() => save(id)}>
                  {t('Speichern')}
                </Button>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  )
}

function Reset({ info, onDone }: { info: ServerInfo; onDone: () => void }) {
  const [backup, setBackup] = useState(true)
  const [keepConfig, setKeepConfig] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [running, setRunning] = useState(false)

  function reset() {
    setRunning(true)
    resetLocalServer(keepConfig, backup)
      .then((moved) => {
        toast.success(moved ? t('Zurückgesetzt. Sicherung: {path}', { path: moved }) : t('Zurückgesetzt.'))
        // A server that was running comes back on the empty data.
        if (info.running) return restartLocalServer()
      })
      .catch((e: unknown) => toast.error(errorMessage(e)))
      .finally(() => {
        setRunning(false)
        onDone()
      })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 className="size-4 text-destructive" /> {t('Zurücksetzen')}
        </CardTitle>
        <CardDescription>{t('Löscht Firmen, Datenbank und Secrets des lokalen Servers. Verbindungen zu Remotes bleiben unberührt.')}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        <SwitchRow id="reset-backup" label={t('Sicherung behalten')} description={t('Die alten Daten werden neben dem Datenordner abgelegt statt gelöscht.')} checked={backup} onChange={setBackup} />
        <SwitchRow id="reset-keep-config" label={t('Konfiguration behalten')} description={t('config.json und .env bleiben erhalten.')} checked={keepConfig} onChange={setKeepConfig} />
        <div className="flex items-center justify-between gap-6 pt-3.5">
          <p className="text-xs break-all text-muted-foreground">{t('Daten: {path}', { path: info.instance_dir })}</p>
          <Button variant="destructive" size="sm" disabled={running} onClick={() => setConfirming(true)}>
            {running ? <LoaderCircle className="animate-spin" /> : <Trash2 />} {t('Lokalen Server zurücksetzen')}
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('Lokalen Server wirklich zurücksetzen?')}</AlertDialogTitle>
          <AlertDialogDescription>{t('Alle Daten des lokalen Servers gehen verloren. Das lässt sich ohne Sicherung nicht rückgängig machen.')}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Abbrechen')}</AlertDialogCancel>
            <AlertDialogAction onClick={reset}>{t('Zurücksetzen')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

/// The server of this machine: its version, its configuration files and a way to start over.
export default function Server() {
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const load = useCallback(() => {
    getServerInfo()
      .then(setInfo)
      .catch((e: unknown) => toast.error(errorMessage(e)))
  }, [])
  useEffect(load, [load])

  const run = (action: Promise<void>) => action.catch((e: unknown) => toast.error(errorMessage(e)))

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ServerIcon className="size-4 text-primary" /> {t('Paperclip-Server')}
          </CardTitle>
          <CardDescription>
            {t('Installierte Version {version}. Diese App ist für Version {pinned} gebaut; ein neuerer Server kommt mit einem App-Update.', {
              version: info?.version ?? '–',
              pinned: info?.pinned_version ?? '–',
            })}
          </CardDescription>
          <CardAction className="flex gap-2">
            <Button variant="outline" size="sm" disabled={info === null} onClick={() => void run(restartLocalServer())}>
              <RotateCcw /> {t('Neu starten')}
            </Button>
            <Button variant="outline" size="sm" disabled={!info?.can_reinstall} onClick={() => void run(reinstallServer())}>
              <Download /> {t('Neu installieren')}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          {info?.can_reinstall === false
            ? t('Dieser Build nutzt den mitgelieferten Server; er lässt sich nicht erneut herunterladen.')
            : t('Lädt das Server-Paket erneut herunter und startet es. Die Daten bleiben erhalten.')}
        </CardContent>
      </Card>

      <ConfigEditor />
      {info && <Reset info={info} onDone={load} />}
    </div>
  )
}
