import { useState } from 'react'
import { Download, Globe, LayoutTemplate, Monitor, Plus } from 'lucide-react'
import { toast } from '@/lib/notifications'

import { AppMark } from '@/components/app-mark'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { LOCAL_PROFILE_ID, type PageProps, type Snapshot, errorMessage, setOpenAtStart } from '@/lib/client'
import type { Panel } from '@/shell/SettingsMenu'
import { t } from '@/i18n'

type Choice = { kind: 'local' } | { kind: 'saved'; profileId: string }

function Choice({ checked, disabled, onChange, children }: { checked: boolean; disabled: boolean; onChange: (checked: boolean) => void; children: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground select-none">
      <input type="checkbox" className="size-4 accent-primary" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {children}
    </label>
  )
}

/// The first page of a new installation: the local server as the suggestion, a remote as the other way, and how the next start goes.
export default function Welcome({
  snapshot,
  settings,
  saving,
  save,
  onStart,
  onAddRemote,
  onPanel,
}: PageProps & { snapshot: Snapshot; onStart: (choice: Choice) => void; onAddRemote: () => void; onPanel: (panel: Panel) => void }) {
  const [autoStart, setAutoStart] = useState(false)
  const remotes = snapshot.profiles.filter((profile) => profile.mode === 'remote_existing')
  const missing = snapshot.localServerVersion === null

  async function choose(choice: Choice) {
    if (autoStart) {
      await setOpenAtStart(choice.kind === 'local' ? LOCAL_PROFILE_ID : choice.profileId, true).catch((e: unknown) => toast.error(errorMessage(e)))
    }
    onStart(choice)
  }

  // Opening a connection by itself and showing this page at every start exclude each other.
  function changeAutoStart(checked: boolean) {
    setAutoStart(checked)
    if (checked && settings.show_welcome) void save({ ...settings, show_welcome: false }, '')
  }

  function changeShowWelcome(checked: boolean) {
    if (checked) setAutoStart(false)
    void save({ ...settings, show_welcome: checked }, '')
  }

  return (
    <div className="mx-auto flex min-h-[calc(100svh-7rem)] w-full max-w-3xl flex-col items-center justify-center gap-8 pb-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <AppMark className="size-16" />
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t('Willkommen bei PaperclipDesk')}</h1>
        <p className="max-w-xl text-muted-foreground">{t('Führe deine KI-Firma hier auf diesem PC oder verbinde dich mit einem Paperclip, das schon läuft.')}</p>
      </div>

      <div className="grid w-full gap-4 sm:grid-cols-2">
        <Card className="outline-2 outline-primary">
          <CardContent className="flex h-full flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Monitor className="size-5" />
              </span>
              <p className="flex-1 font-heading font-semibold tracking-tight">{t('Lokal auf diesem PC')}</p>
              <Badge>{t('Empfohlen')}</Badge>
            </div>
            <div className="flex flex-1 flex-col gap-2 text-sm text-muted-foreground">
              <p>{t('Paperclip läuft mit eigener Datenbank auf diesem Rechner. Keine Anmeldung, deine Daten bleiben hier.')}</p>
              {missing ? (
                <p className="text-destructive">{t('Der Paperclip-Server fehlt. Im Repository legt „npm run prepare-server“ ihn an.')}</p>
              ) : (
                !snapshot.localServerInstalled && (
                  <p className="flex gap-2">
                    <Download className="mt-0.5 size-4 shrink-0" />
                    {t('Beim ersten Start lädt die App den Paperclip-Server herunter, einige hundert MB. Danach startet er schnell.')}
                  </p>
                )
              )}
            </div>
            <Button disabled={missing} onClick={() => void choose({ kind: 'local' })}>
              <Monitor /> {t('Lokal starten')}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex h-full flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted">
                <Globe className="size-5" />
              </span>
              <p className="flex-1 font-heading font-semibold tracking-tight">{t('Mit einem Remote verbinden')}</p>
            </div>
            <p className="flex-1 text-sm text-muted-foreground">{t('Für ein Paperclip auf einem anderen Rechner, etwa den Server deines Teams. Es fragt nach seiner eigenen Anmeldung.')}</p>
            {remotes.map((profile) => (
              <Button key={profile.id} variant="outline" className="justify-start" onClick={() => void choose({ kind: 'saved', profileId: profile.id })}>
                <Globe /> <span className="truncate">{profile.name}</span>
              </Button>
            ))}
            <Button variant="outline" onClick={onAddRemote}>
              <Plus /> {t('Remote hinzufügen')}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex w-full flex-col gap-3 rounded-xl border border-dashed p-4 sm:flex-row sm:items-center">
        <div className="flex flex-1 flex-col gap-1">
          <p className="font-heading text-sm font-semibold tracking-tight">{t('Gleich eine Firma planen')}</p>
          <p className="text-xs text-muted-foreground">{t('Such dir eine Vorlage aus, noch bevor ein Server läuft. Erst zum Anlegen startet die App den lokalen Server.')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => onPanel('templates')}>
            <LayoutTemplate /> {t('Firma aus Vorlage')}
          </Button>
        </div>
      </div>

      <div className="flex flex-col items-start gap-2">
        <Choice checked={autoStart} disabled={saving} onChange={changeAutoStart}>
          {t('Die gewählte Verbindung künftig automatisch starten')}
        </Choice>
        <Choice checked={settings.show_welcome} disabled={saving} onChange={changeShowWelcome}>
          {t('Diese Seite bei jedem Start zeigen')}
        </Choice>
      </div>
    </div>
  )
}
