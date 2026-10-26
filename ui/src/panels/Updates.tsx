import { useEffect, useState } from 'react'
import { Download, LoaderCircle, RefreshCw } from 'lucide-react'
import { toast } from '@/lib/notifications'

import { SwitchRow } from '@/components/setting-row'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type PageProps, errorMessage, getAbout } from '@/lib/client'
import type { Updater } from '@/lib/updater'
import { t } from '@/i18n'

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

/// The installed version, the search for a newer one and its installation.
export default function UpdatesPanel(props: PageProps & { updater: Updater }) {
  const [version, setVersion] = useState<string>()
  useEffect(() => {
    getAbout()
      .then((about) => setVersion(about.version))
      .catch(() => undefined)
  }, [])
  return <Updates {...props} version={version} />
}
