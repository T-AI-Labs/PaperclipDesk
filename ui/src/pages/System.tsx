import { useEffect, useState } from 'react'
import { AppWindow, Bug, Download, ExternalLink, FileDown, FileUp, FolderOpen, Info, Languages, LoaderCircle, RefreshCw, Save } from 'lucide-react'
import { toast } from 'sonner'

import { SettingRow, SwitchRow } from '@/components/setting-row'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type About, type PageProps, errorMessage, exportSettings, getAbout, importSettings, openDataFolder, openProjectLink } from '@/lib/client'
import type { Updater } from '@/lib/updater'
import { LANGUAGES, t } from '@/i18n'

function Updates({ updater, version, settings, saving, save }: PageProps & { updater: Updater; version: string | undefined }) {
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
          <Download className="size-4 text-primary" /> {t('Updates')}
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

export default function System({ settings, saving, save, updater }: PageProps & { updater: Updater }) {
  const [about, setAbout] = useState<About | null>(null)
  useEffect(() => {
    getAbout()
      .then(setAbout)
      .catch(() => undefined)
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AppWindow className="size-4 text-primary" /> {t('Start')}
          </CardTitle>
          <CardDescription>{t('Paperclip läuft, solange ein Fenster offen ist; mit dem letzten Fenster endet auch der lokale Server.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <SwitchRow
            id="clear-logs-on-exit"
            label={t('Protokolle beim Beenden löschen')}
            description={t('Leert die Protokolle der App und des Servers, wenn die App beendet wird.')}
            checked={settings.clear_logs_on_exit}
            disabled={saving}
            onChange={(checked) => void save({ ...settings, clear_logs_on_exit: checked }, '')}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Languages className="size-4 text-primary" /> {t('Sprache')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SettingRow label={t('Sprache')} description={t('Die Sprache der App und ihrer Menüs.')}>
            <Select value={settings.language} disabled={saving} onValueChange={(language) => void save({ ...settings, language }, t('Sprache gespeichert'))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="System">{t('Wie Windows')}</SelectItem>
                {LANGUAGES.map(({ id, label }) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </CardContent>
      </Card>

      <Updates updater={updater} version={about?.version} settings={settings} saving={saving} save={save} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Save className="size-4 text-primary" /> {t('Einstellungen sichern')}
          </CardTitle>
          <CardDescription>{t('Design, Sprache und gespeicherte Remotes als JSON-Datei exportieren oder aus einer solchen übernehmen.')}</CardDescription>
          <CardAction className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                exportSettings()
                  .then((path) => path && toast.success(t('Exportiert nach {path}', { path })))
                  .catch((e: unknown) => toast.error(errorMessage(e)))
              }
            >
              <FileDown /> {t('Exportieren')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() =>
                importSettings()
                  .then((imported) => imported && save(imported, t('Einstellungen importiert')))
                  .catch((e: unknown) => toast.error(errorMessage(e)))
              }
            >
              <FileUp /> {t('Importieren')}
            </Button>
          </CardAction>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="size-4 text-primary" /> {t('Über')}
          </CardTitle>
          <CardDescription>
            {t('PaperclipDesk macht Paperclip zu einem Windows-Programm: Es startet den Server samt Datenbank selbst oder verbindet sich mit einem Remote – ohne Terminal und ohne Browser-Tab. Open Source unter der MIT-Lizenz, ohne Telemetrie.')}
          </CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => openDataFolder().catch((e: unknown) => toast.error(errorMessage(e)))}>
              <FolderOpen /> {t('Datenordner')}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground">
          <p>
            PaperclipDesk {about?.version ?? '–'} · Paperclip-Server {about?.server_version ?? '–'}
          </p>
          <p className="break-all">{t('App-Daten: {path}', { path: about?.user_data ?? '–' })}</p>
          <p className="break-all">{t('Server-Daten (PAPERCLIP_HOME): {path}', { path: about?.paperclip_home ?? '–' })}</p>
          <div className="flex flex-wrap gap-2 pt-3">
            <Button variant="outline" size="sm" onClick={() => openProjectLink('repository').catch((e: unknown) => toast.error(errorMessage(e)))}>
              <ExternalLink /> {t('Projekt auf GitHub')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => openProjectLink('report_issue').catch((e: unknown) => toast.error(errorMessage(e)))}>
              <Bug /> {t('Problem melden')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
