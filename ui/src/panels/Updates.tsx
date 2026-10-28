import { useCallback, useEffect, useState } from 'react'
import { ArrowUpCircle, Download, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react'
import { toast } from '@/lib/notifications'

import { SwitchRow } from '@/components/setting-row'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type PageProps, type ServerInfo, errorMessage, getAbout, getServerInfo, openProjectLink, serverVersions, upgradeServer } from '@/lib/client'
import type { Updater } from '@/lib/updater'
import { t } from '@/i18n'

function App({ updater, version, settings, saving, save }: PageProps & { updater: Updater; version: string | undefined }) {
  // Only a check the user asked for reports its outcome; the one at start-up stays quiet.
  const [checked, setChecked] = useState<'current' | string | null>(null)

  function check() {
    updater
      .check()
      .then((available) => setChecked(available ? null : 'current'))
      .catch((e: unknown) => setChecked(errorMessage(e)))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="size-4 text-primary" /> PaperclipDesk
        </CardTitle>
        <CardDescription>{t('Installierte Version {version}.', { version: version ?? '–' })}</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" disabled={updater.checking || updater.installing} onClick={check}>
            {updater.checking ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} {t('Nach Updates suchen')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <SwitchRow
          id="check-updates-on-start"
          label={t('Beim Start nach Updates suchen')}
          checked={settings.check_updates_on_start}
          disabled={saving}
          onChange={(checked) => void save({ ...settings, check_updates_on_start: checked }, '')}
        />
      </CardContent>
      {(updater.available || checked) && (
        <CardContent className="flex flex-col gap-3 text-sm">
          {!updater.available && checked === 'current' && <p className="text-muted-foreground">{t('PaperclipDesk ist aktuell.')}</p>}
          {!updater.available && checked && checked !== 'current' && <p className="text-destructive">{t('Die Suche ist fehlgeschlagen: {error}', { error: checked })}</p>}
          {updater.available && (
            <>
              <p className="font-medium">{t('Version {version} ist verfügbar.', { version: updater.version })}</p>
              {updater.notes && <p className="max-h-48 overflow-y-auto rounded-lg border bg-card/60 px-3 py-2 whitespace-pre-wrap text-muted-foreground">{updater.notes}</p>}
              {updater.installing && (
                <div className="h-1.5 overflow-hidden rounded-full bg-primary/15" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={updater.percent}>
                  <div className={updater.percent === undefined ? 'h-full w-1/3 animate-pulse rounded-full bg-primary' : 'h-full rounded-full bg-primary transition-[width] duration-300'} style={updater.percent === undefined ? undefined : { width: `${updater.percent}%` }} />
                </div>
              )}
              <div className="flex items-center gap-3">
                <Button disabled={updater.installing} onClick={() => updater.install().catch((e: unknown) => toast.error(errorMessage(e)))}>
                  {updater.installing ? <LoaderCircle className="animate-spin" /> : <Download />} {updater.installing ? t('Wird installiert …') : t('Installieren und neu starten')}
                </Button>
                <span className="text-xs text-muted-foreground">{t('Der lokale Server wird dafür beendet.')}</span>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}

function ServerVersions({ info, onDone }: { info: ServerInfo | null; onDone: () => void }) {
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
          <ArrowUpCircle className="size-4 text-primary" /> {t('Paperclip-Server')}
        </CardTitle>
        <CardDescription>
          {t('Installierte Version {version}.', { version: info?.version ?? '–' })} {t('Neuere Versionen von Paperclip, signiert vom PaperclipDesk-Projekt. Die Daten des lokalen Servers kommen mit.')}
        </CardDescription>
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
                <Button size="sm" disabled={running || info === null} onClick={() => setConfirming(version)}>
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
            {t('Der neue Server baut beim ersten Start die Datenbank um; danach startet keine ältere Version mehr auf diesen Daten. Diese App ist mit Version {pinned} getestet, mit einer neueren kann einzelnes nicht funktionieren.', { pinned: info?.pinned_version ?? '–' })}
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

/// Every update in one place: the app's own, and newer versions of the local Paperclip server.
export default function UpdatesPanel(props: PageProps & { updater: Updater }) {
  const [version, setVersion] = useState<string>()
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const loadInfo = useCallback(() => {
    getServerInfo()
      .then(setInfo)
      .catch((e: unknown) => toast.error(errorMessage(e)))
  }, [])
  useEffect(loadInfo, [loadInfo])
  useEffect(() => {
    getAbout()
      .then((about) => setVersion(about.version))
      .catch(() => undefined)
  }, [])
  return (
    <>
      <App {...props} version={version} />
      <ServerVersions info={info} onDone={loadInfo} />
    </>
  )
}
