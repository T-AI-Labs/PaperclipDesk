import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { ArrowLeft, CircleAlert, Download, LoaderCircle, RefreshCw, ScrollText, X } from 'lucide-react'
import { record, toast } from '@/lib/notifications'

import { IconTile } from '@/components/icon-tile'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Toaster } from '@/components/ui/sonner'
import { type LauncherPage, type PageProps, type Settings, type Snapshot, errorMessage, getSettings, holdOverlay, launcherState, onAlert, onLauncherState, onSettings, onShortcut, recentAlerts, showPage, updateSettings } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useApplyColorScheme } from '@/lib/theme'
import { type Message, setLanguage, t } from '@/i18n'
import { useUpdater } from '@/lib/updater'
import LoadingPanel from '@/LoadingPanel'
import MenuBar from '@/shell/MenuBar'
import { SHELL_PANELS } from '@/shell/panels'
import type { Panel } from '@/shell/SettingsMenu'

import Connect from './pages/Connect'
import Logs from './pages/Logs'
import Remotes from './panels/Remotes'
import Server from './panels/Server'
import Shortcuts from './panels/Shortcuts'
import Updates from './panels/Updates'

// The catalog and its snapshot are large and only needed once the panel opens.
const Templates = lazy(() => import('./panels/Templates'))

const PANEL_TITLES: Record<Panel, Message> = { server: 'Paperclip-Server', remotes: 'Verbindungen', updates: 'Updates', templates: 'Firma aus Vorlage', shortcuts: 'Tastenkürzel' }

/// Panels with tables wide enough to need the whole window below the menu bar.
const FULL_VIEW: Panel[] = ['templates']

type Loaded ={ snapshot: Snapshot; settings: Settings } | { error: string }

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
  const [panel, setPanel] = useState<Panel | null>(null)
  // A page the user opened shows at once; the host's next snapshot confirms it.
  const [pending, setPending] = useState<LauncherPage | null>(null)
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
    return onLauncherState((next) => {
      setSnapshot(next)
      setPending(null)
    })
  }, [load])

  useEffect(() => onSettings(setSettings), [])

  const page = pending ?? snapshot?.page
  // Above Paperclip this webview shows the menu bar only; whatever else it covers stays see-through.
  const onPaperclip = page === 'paperclip'
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

  // The room above Paperclip is asked for before the menu that opened the panel gives its own back.
  function openPanel(next: Panel) {
    void holdOverlay('panel', true)
    setPanel(next)
  }

  function closePanel() {
    setPanel(null)
    void holdOverlay('panel', false)
  }

  const fullPanel = panel !== null && FULL_VIEW.includes(panel) ? panel : null

  // A page that fills the window has no overlay of its own to close it with Escape, unlike the sheet.
  useEffect(() => {
    if (!fullPanel) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[data-state=open][role=dialog], [data-radix-popper-content-wrapper]')) closePanel()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [fullPanel])

  // What went wrong before this page loaded goes quietly into the bell; what goes wrong now pops up unless turned off.
  useEffect(() => {
    recentAlerts()
      .then((alerts) => alerts.forEach((alert) => record(alert.error ? 'error' : 'warning', alert.text, alert.at)))
      .catch(() => undefined)
  }, [])
  const errorPopups = settings?.error_popups ?? true
  useEffect(
    () =>
      onAlert((alert) => {
        if (!alert.error || !errorPopups) return record(alert.error ? 'error' : 'warning', alert.text, alert.at)
        toast.error(alert.text, { action: { label: t('Protokoll'), onClick: () => void showPage('logs').catch((e: unknown) => toast.error(errorMessage(e))) } })
      }),
    [errorPopups],
  )

  useEffect(
    () =>
      onShortcut((action) => {
        const next = SHELL_PANELS[action]
        if (next) openPanel(next)
      }),
    [],
  )

  if (snapshot === null || settings === null || page === undefined) {
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
  const props: PageProps = { settings, saving, save }
  const busy = snapshot.view === 'local-boot' || snapshot.view === 'connecting'

  function open(next: LauncherPage) {
    // Paperclip's view is the host's to show; drawn early, the shell would only turn see-through over nothing.
    if (next !== 'paperclip') setPending(next)
    showPage(next).catch((e: unknown) => {
      setPending(null)
      toast.error(errorMessage(e))
    })
  }
  const backLabel = snapshot.hasCurrentConnection ? t('Paperclip') : t('Verbindung')
  const back = () => open(snapshot.hasCurrentConnection ? 'paperclip' : 'connect')

  return (
    <div className={cn('relative isolate flex h-screen flex-col overflow-hidden text-foreground', !onPaperclip && 'bg-background')}>
      {/* Above Paperclip this webview is no taller than the menu bar unless a panel is open, so a toast would land on the bar. */}
      {(!onPaperclip || panel !== null) && <Toaster theme={settings.color_scheme} position="top-right" offset={{ top: 40, right: 8 }} visibleToasts={3} duration={5000} />}
      {!onPaperclip && <div aria-hidden data-theme={settings.theme} data-accent={settings.accent} className="app-backdrop" />}

      {snapshot.menuBarShown && (
        <MenuBar
          menus={snapshot.menu}
          connectionMenu={snapshot.connectionMenu}
          connectionName={snapshot.currentConnectionName}
          zoomPercent={snapshot.zoomPercent}
          connected={snapshot.hasCurrentConnection}
          paperclipPath={snapshot.paperclipPath}
          onPanel={openPanel}
          // Going elsewhere from the menu leaves the company being planned; the page in front would hide where the user went.
          onNavigate={() => fullPanel && closePanel()}
          {...props}
        />
      )}

      {fullPanel && (
        <section aria-label={t(PANEL_TITLES[fullPanel])} className="relative z-20 flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b px-6">
            <h1 className="flex-1 truncate font-heading text-base font-semibold tracking-tight">{t(PANEL_TITLES[fullPanel])}</h1>
            <Button size="icon-sm" variant="ghost" aria-label={t('Schließen')} title={t('Schließen')} onClick={closePanel}>
              <X />
            </Button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-4">
            <Suspense fallback={<LoaderCircle className="size-4 animate-spin text-muted-foreground" />}>
              <Templates snapshot={snapshot} onDone={closePanel} />
            </Suspense>
          </div>
        </section>
      )}

      {!onPaperclip && (
        <div className={cn('relative z-10 flex min-h-0 min-w-0 flex-1 flex-col', fullPanel && 'hidden')}>
          {page === 'logs' && (
            <header className="glass-surface z-20 flex h-12 shrink-0 items-center gap-3 border-b bg-background/70 px-6 backdrop-blur-md">
              <IconTile icon={ScrollText} tone={-80} />
              <Button size="sm" variant="ghost" onClick={back}>
                <ArrowLeft /> {backLabel}
              </Button>
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <h1 className="truncate font-heading text-sm font-semibold tracking-tight">{t('Protokoll')}</h1>
                <p className="truncate text-[11px] text-muted-foreground">{t('Was der Paperclip-Server und die App schreiben, live')}</p>
              </div>
              {updater.available && (
                <Button size="sm" variant="outline" onClick={() => openPanel('updates')}>
                  <Download /> {t('Update {version}', { version: updater.version })}
                </Button>
              )}
              <Badge variant={snapshot.hasCurrentConnection ? 'default' : 'outline'}>
                {snapshot.hasCurrentConnection ? t('Verbunden: {name}', { name: snapshot.currentConnectionName ?? '' }) : busy ? t('Verbindet …') : t('Nicht verbunden')}
              </Badge>
            </header>
          )}

          <main key={page} className="relative z-10 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            <div className={cn('flex flex-col gap-6 px-6 py-6', page === 'connect' && 'mx-auto max-w-4xl')}>
              {page === 'connect' && <Connect snapshot={snapshot} onAddRemote={() => openPanel('remotes')} onPanel={openPanel} {...props} />}
              {page === 'logs' && <Logs />}
            </div>
          </main>
        </div>
      )}

      <Sheet open={panel !== null && !fullPanel} onOpenChange={(isOpen) => !isOpen && closePanel()}>
        <SheetContent aria-describedby={undefined} className="gap-0 data-[side=right]:w-[min(36rem,100vw)] data-[side=right]:sm:max-w-none">
          <SheetHeader className="border-b">
            <SheetTitle>{panel && t(PANEL_TITLES[panel])}</SheetTitle>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
            {panel === 'server' && <Server />}
            {panel === 'remotes' && <Remotes snapshot={snapshot} onChanged={setSnapshot} />}
            {panel === 'updates' && <Updates {...props} updater={updater} />}
            {panel === 'shortcuts' && <Shortcuts snapshot={snapshot} {...props} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
