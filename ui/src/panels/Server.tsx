import { useCallback, useEffect, useState } from 'react'
import { ArrowUpCircle, Download, ExternalLink, FileCog, LoaderCircle, RotateCcw, Server as ServerIcon, Trash2 } from 'lucide-react'
import { toast } from '@/lib/notifications'

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
  openProjectLink,
  readServerConfig,
  reinstallServer,
  resetLocalServer,
  restartLocalServer,
  serverVersions,
  upgradeServer,
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

function Versions({ info, onDone }: { info: ServerInfo; onDone: () => void }) {
  const [versions, setVersions] = useState<string[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [backup, setBackup] = useState(true)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    serverVersions()
      .then(setVersions)
      .catch((e: unknown) => setFailed(errorMessage(e)))
  }, [])

  function upgrade(version: string) {
    setRunning(true)
    upgradeServer(version, backup)
      .then((copy) => {
        toast.success(copy ? t('Paperclip {version} wird installiert. Sicherung: {path}', { version, path: copy }) : t('Paperclip {version} wird installiert.', { version }))
        setVersions((current) => current?.filter((newer) => newer.localeCompare(version, undefined, { numeric: true }) > 0) ?? null)
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
          <ArrowUpCircle className="size-4 text-primary" /> {t('Server-Version')}
        </CardTitle>
        <CardDescription>{t('Neuere Versionen von Paperclip, signiert vom PaperclipDesk-Projekt. Die Daten des lokalen Servers kommen mit.')}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {failed !== null ? (
          <p className="pb-3.5 text-xs text-destructive">{failed}</p>
        ) : versions === null ? (
          <p className="flex items-center gap-2 pb-3.5 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" /> {t('Suche nach neueren Versionen …')}
          </p>
        ) : versions.length === 0 ? (
          <p className="pb-3.5 text-xs text-muted-foreground">{t('Es gibt keine neuere Version.')}</p>
        ) : (
          versions.map((version) => (
            <div key={version} className="flex items-center justify-between gap-4 py-2.5 first:pt-0">
              <span className="font-mono text-sm">{version}</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => void openProjectLink({ server_release: version }).catch((e: unknown) => toast.error(errorMessage(e)))}>
                  <ExternalLink /> {t('Was ist neu')}
                </Button>
                <Button size="sm" disabled={running} onClick={() => setConfirming(version)}>
                  {running ? <LoaderCircle className="animate-spin" /> : <Download />} {t('Installieren')}
                </Button>
              </div>
            </div>
          ))
        )}
        {versions !== null && versions.length > 0 && (
          <SwitchRow id="upgrade-backup" label={t('Vorher sichern')} description={t('Kopiert die Daten des lokalen Servers neben den Datenordner, bevor der neue Server sie umbaut.')} checked={backup} onChange={setBackup} />
        )}
      </CardContent>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('Paperclip {version} installieren?', { version: confirming ?? '' })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('Der neue Server baut beim ersten Start die Datenbank um; danach startet keine ältere Version mehr auf diesen Daten. Diese App ist mit Version {pinned} getestet, mit einer neueren kann einzelnes nicht funktionieren.', { pinned: info.pinned_version })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Abbrechen')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirming && upgrade(confirming)}>{t('Installieren')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
            {t('Installierte Version {version}. Diese App ist mit Version {pinned} getestet.', {
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

      {info && <Versions info={info} onDone={load} />}
      <ConfigEditor />
      {info && <Reset info={info} onDone={load} />}
    </div>
  )
}
