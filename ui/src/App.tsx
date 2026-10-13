import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Cable, CircleAlert, Download, Palette, Paperclip, Plug, RefreshCw, ScrollText, Server as ServerIcon, SlidersHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'

import { IconTile } from '@/components/icon-tile'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { type LauncherPage, type PageProps, type Settings, type Snapshot, errorMessage, getSettings, launcherState, onLauncherState, showPage, updateSettings } from '@/lib/client'
import type { Tone } from '@/lib/tones'
import { cn } from '@/lib/utils'
import { useApplyColorScheme } from '@/lib/theme'
import { type Message, setLanguage, t } from '@/i18n'
import { useUpdater } from '@/lib/updater'
import LoadingPanel from '@/LoadingPanel'
import MenuBar from '@/shell/MenuBar'
import Sidebar, { type NavPage } from '@/shell/Sidebar'

import Appearance from './pages/Appearance'
import Connect from './pages/Connect'
import Connections from './pages/Connections'
import Logs from './pages/Logs'
import Server from './pages/Server'
import System from './pages/System'

/// Each page is opened by its entry in the menu bar; the window shows one at a time.
const PAGES: Record<LauncherPage, { label: Message; icon: LucideIcon; tone: Tone; description: Message }> = {
  paperclip: { label: 'Paperclip', icon: Paperclip, tone: 60, description: 'Paperclip' },
  connect: { label: 'Verbindung', icon: Plug, tone: 0, description: 'Lokalen Server starten oder mit einem Remote verbinden' },
  connections: { label: 'Verbindungen', icon: Cable, tone: -40, description: 'Was beim Start geöffnet wird, deine Remotes und neue Verbindungen' },
  logs: { label: 'Protokoll', icon: ScrollText, tone: -80, description: 'Was der Paperclip-Server und die App schreiben, live' },
  system: { label: 'System', icon: SlidersHorizontal, tone: -100, description: 'Start, Version und Datenordner' },
  server: { label: 'Server', icon: ServerIcon, tone: 40, description: 'Version, Konfiguration und Zurücksetzen des lokalen Paperclip-Servers' },
  appearance: { label: 'Darstellung', icon: Palette, tone: 100, description: 'Design, Akzentfarbe und Farbschema dieses Fensters' },
}

const SETTINGS_PAGES: readonly LauncherPage[] = ['system', 'appearance', 'connections', 'server']

type Loaded = { snapshot: Snapshot; settings: Settings } | { error: string }

async function fetchAll(): Promise<Loaded> {
  try {
    const [snapshot, settings] = await Promise.all([launcherState(), getSettings()])
    return { snapshot, settings }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const updater = useUpdater(settings?.check_updates_on_start)

  useApplyColorScheme(settings?.color_scheme ?? 'system', settings?.theme ?? 'klar', settings?.accent ?? 'default')

  const load = useCallback(
    () =>
      fetchAll().then((result) => {
        if ('error' in result) return setLoadError(result.error)
        setSnapshot(result.snapshot)
        setSettings(result.settings)
        setLoadError(null)
      }),
    [],
  )

  useEffect(() => {
    void load()
    return onLauncherState(setSnapshot)
  }, [load])

  // Above Paperclip this webview shows the menu bar only; whatever else it covers stays see-through.
  const onPaperclip = snapshot?.page === 'paperclip'
  useEffect(() => {
    document.documentElement.classList.toggle('see-through', onPaperclip)
  }, [onPaperclip])

  async function save(next: Settings, success: string) {
    setSaving(true)
    try {
      setSettings(await updateSettings(next))
      setSnapshot(await launcherState())
      if (success) toast.success(success)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  if (snapshot === null || settings === null) {
    if (loadError === null) return <LoadingPanel detail={t('Oberfläche wird geladen')} />
    return (
      <div className="grid h-screen place-items-center bg-background p-6 text-foreground">
        <Alert variant="destructive" className="max-w-lg">
          <CircleAlert />
          <AlertTitle>{t('Die App antwortet nicht')}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            {loadError}
            <Button size="sm" variant="outline" onClick={() => void load()}>
              <RefreshCw /> {t('Erneut versuchen')}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  setLanguage(snapshot.language)
  // While Paperclip is the main view the pages are invisible; the settings stay rendered, so opening them shows no empty frame.
  const page = onPaperclip ? SETTINGS_PAGES[0] : snapshot.page
  const current = PAGES[page]
  const props: PageProps = { settings, saving, save }
  const busy = snapshot.view === 'local-boot' || snapshot.view === 'connecting'

  const settingsPages: NavPage[] = SETTINGS_PAGES.map((id) => ({ id, label: t(PAGES[id].label), icon: PAGES[id].icon, tone: PAGES[id].tone }))
  const inSettings = SETTINGS_PAGES.includes(page)
  const open = (id: string) => showPage(id as LauncherPage).catch((e: unknown) => toast.error(errorMessage(e)))
  const backLabel = snapshot.hasCurrentConnection ? t('Paperclip') : t('Verbindung')
  const back = () => void open(snapshot.hasCurrentConnection ? 'paperclip' : 'connect')
  const content = (
    <>
      {page === 'connect' && <Connect snapshot={snapshot} />}
      {page === 'connections' && <Connections snapshot={snapshot} onChanged={setSnapshot} />}
      {page === 'logs' && <Logs />}
      {page === 'server' && <Server />}
      {page === 'appearance' && <Appearance {...props} />}
      {page === 'system' && <System {...props} updater={updater} />}
    </>
  )

  return (
    <div className={cn('relative isolate flex h-screen flex-col overflow-hidden text-foreground', !onPaperclip && 'bg-background')}>
      <Toaster theme={settings.color_scheme} position="bottom-right" offset={{ bottom: 20, right: 20 }} visibleToasts={3} duration={5000} />
      {!onPaperclip && <div aria-hidden data-theme={settings.theme} data-accent={settings.accent} className="app-backdrop" />}

      <MenuBar menus={snapshot.menu} />

      <div className={cn('flex min-h-0 min-w-0 flex-1', onPaperclip && 'invisible')}>
        {inSettings && (
          <Sidebar
            pages={settingsPages}
            page={page}
            onOpen={(id) => void open(id)}
            backLabel={backLabel}
            onBack={back}
            subtitle={snapshot.hasCurrentConnection ? (snapshot.currentConnectionName ?? '') : t('Nicht verbunden')}
          />
        )}

        <div className="relative z-10 flex min-w-0 flex-1 flex-col">
          <header className="glass-surface z-20 flex h-12 shrink-0 items-center gap-3 border-b bg-background/70 px-6 backdrop-blur-md">
            <IconTile icon={current.icon} tone={current.tone} />
            {page === 'logs' && (
              <Button size="sm" variant="ghost" onClick={back}>
                <ArrowLeft /> {backLabel}
              </Button>
            )}
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <h1 className="truncate font-heading text-sm font-semibold tracking-tight">{t(current.label)}</h1>
              <p className="truncate text-[11px] text-muted-foreground">{t(current.description)}</p>
            </div>
            {updater.available && page !== 'system' && (
              <Button size="sm" variant="outline" onClick={() => void open('system')}>
                <Download /> {t('Update {version}', { version: updater.version })}
              </Button>
            )}
            <Badge variant={snapshot.hasCurrentConnection ? 'default' : 'outline'}>
              {snapshot.hasCurrentConnection ? t('Verbunden: {name}', { name: snapshot.currentConnectionName ?? '' }) : busy ? t('Verbindet …') : t('Nicht verbunden')}
            </Badge>
          </header>

          <main key={page} className="relative z-10 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            <div className={cn('flex flex-col gap-6 px-6 py-6', page === 'connect' && 'mx-auto max-w-4xl')}>{content}</div>
          </main>
        </div>
      </div>
    </div>
  )
}
