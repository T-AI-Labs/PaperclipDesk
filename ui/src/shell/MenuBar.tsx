import { useCallback, useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarMenu, MenubarSeparator, MenubarSub, MenubarSubContent, MenubarSubTrigger, MenubarTrigger } from '@/components/ui/menubar'
import { Input } from '@/components/ui/input'
import { type Menu, type MenuEntry, type PageProps, errorMessage, holdOverlay, menuAction, onShortcut, openPaperclipPath, setMenuOpen } from '@/lib/client'
import { toast } from '@/lib/notifications'
import { SHELL_PANELS } from '@/shell/panels'
import NotificationBell from '@/shell/NotificationBell'
import SettingsMenu, { type Panel, ShortcutHint } from '@/shell/SettingsMenu'
import { t } from '@/i18n'

// Above Paperclip the webview is no taller than the bar until the host has made room for a menu.
const BAR_HEIGHT = 32
const CONNECTION_MENU = 'connection'

/// Entries that leave the view as it is: they open the browser, a folder, a dialog or the developer tools.
const STAYS = new Set(['help.docs', 'help.report_issue', 'help.data_folder', 'help.about', 'view.devtools'])

const TRIGGER = 'rounded-md px-2.5 py-1 text-xs font-normal hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent'

async function makeRoom() {
  await holdOverlay('menu', true)
  if (window.innerHeight > BAR_HEIGHT) return
  await new Promise<void>((resolve) => {
    window.addEventListener('resize', () => resolve(), { once: true })
    setTimeout(resolve, 300)
  })
}

/// A path of Paperclip's own from what the user typed: a full URL keeps only its path, so it opens on the connection in front.
function typedPath(typed: string) {
  const text = typed.trim()
  if (/^https?:\/\//i.test(text) && URL.canParse(text)) {
    const url = new URL(text)
    return url.pathname + url.search + url.hash
  }
  return text.startsWith('/') ? text : `/${text}`
}

/// The path of the Paperclip page in front; what the user types there and confirms with Enter opens in Paperclip.
function AddressBar({ path, onNavigate }: { path: string; onNavigate: () => void }) {
  // While the user types, the field keeps their text instead of following Paperclip.
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <form
      className="mx-2 flex min-w-0 flex-1 justify-center"
      onSubmit={(event) => {
        event.preventDefault()
        const target = typedPath(draft ?? path)
        event.currentTarget.querySelector('input')?.blur()
        onNavigate()
        void openPaperclipPath(target).catch((e: unknown) => toast.error(errorMessage(e)))
      }}
    >
      <Input
        value={draft ?? path}
        onFocus={(event) => {
          setDraft(path)
          event.target.select()
        }}
        onBlur={() => setDraft(null)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.currentTarget.blur()
          // The menu bar moves between its menus with the arrow keys.
          event.stopPropagation()
        }}
        aria-label={t('Adresse in Paperclip')}
        spellCheck={false}
        className="h-6 max-w-xl rounded-md border-sidebar-border bg-sidebar px-2 py-0 font-mono text-xs md:text-xs"
      />
    </form>
  )
}

function Entries({ entries, shortcuts, onPanel, onNavigate }: { entries: MenuEntry[]; shortcuts: Record<string, string>; onPanel: (panel: Panel) => void; onNavigate: () => void }) {
  const inset = entries.some((entry) => entry.kind === 'item' && entry.checked !== null)
  return entries.map((entry, index) => {
    if (entry.kind === 'separator') return <MenubarSeparator key={index} />
    if (entry.kind === 'label') {
      return (
        <MenubarLabel key={index} inset={inset || undefined} className="text-[11px] font-normal text-muted-foreground">
          {entry.label}
        </MenubarLabel>
      )
    }
    if (entry.kind === 'submenu') {
      return (
        <MenubarSub key={index}>
          <MenubarSubTrigger inset={inset || undefined} className="text-xs">
            {entry.label}
          </MenubarSubTrigger>
          <MenubarSubContent>
            <Entries entries={entry.entries} shortcuts={shortcuts} onPanel={onPanel} onNavigate={onNavigate} />
          </MenubarSubContent>
        </MenubarSub>
      )
    }
    const panel = SHELL_PANELS[entry.id]
    const pick = () => {
      if (panel) return onPanel(panel)
      if (!STAYS.has(entry.id)) onNavigate()
      void menuAction(entry.id)
    }
    return entry.checked === null ? (
      <MenubarItem key={entry.id} inset={inset || undefined} disabled={!entry.enabled} onSelect={pick} className="text-xs">
        {entry.label}
        <ShortcutHint id={entry.id} shortcuts={shortcuts} />
      </MenubarItem>
    ) : (
      <MenubarCheckboxItem key={entry.id} checked={entry.checked} disabled={!entry.enabled} onSelect={pick} className="text-xs">
        {entry.label}
        <ShortcutHint id={entry.id} shortcuts={shortcuts} />
      </MenubarCheckboxItem>
    )
  })
}

/// The menu bar at the top of the window: Paperclip's menus at the left, the connection and the app's settings at the right.
export default function MenuBar({
  menus,
  connectionMenu,
  connectionName,
  zoomPercent,
  connected,
  paperclipPath,
  update,
  onPanel,
  onNavigate,
  ...settings
}: PageProps & { menus: Menu[]; connectionMenu: MenuEntry[]; connectionName: string | null; zoomPercent: number; connected: boolean; paperclipPath: string | null; update: string | null; onPanel: (panel: Panel) => void; onNavigate: () => void }) {
  const [open, setOpen] = useState('')
  // The company menu checks the company in front; the bell reads that company's inbox.
  const company = menus[0]?.entries.find((entry) => entry.kind === 'item' && entry.checked === true)
  const companyId = company?.kind === 'item' ? company.id : null

  const change = useCallback(
    async (next: string) => {
      if (next !== '' && open === '') await makeRoom()
      setOpen(next)
      if (next === '') void holdOverlay('menu', false)
    },
    [open],
  )

  // After a reload of this page the host may still hold room for a menu that is gone.
  useEffect(() => void setMenuOpen(false), [])

  // The settings in the tray's menu open the gear.
  useEffect(() => onShortcut((action) => action === 'shell.settings' && void change('settings')), [change])

  // A menu left open would keep covering Paperclip after the user went elsewhere.
  useEffect(() => {
    if (open === '') return
    const close = () => {
      setOpen('')
      void holdOverlay('menu', false)
    }
    window.addEventListener('blur', close)
    return () => window.removeEventListener('blur', close)
  }, [open])

  return (
    <Menubar value={open} onValueChange={(next) => void change(next)} className="relative z-30 h-8 shrink-0 gap-0 rounded-none border-0 border-b border-sidebar-border bg-sidebar px-1.5 py-0 text-sidebar-foreground">
      {menus.map((menu, index) => (
        <MenubarMenu key={index} value={`menu-${index}`}>
          <MenubarTrigger className={index === 0 ? `${TRIGGER} font-medium` : TRIGGER}>{menu.label}</MenubarTrigger>
          <MenubarContent sideOffset={5} alignOffset={0}>
            <Entries entries={menu.entries} shortcuts={settings.settings.shortcuts} onPanel={onPanel} onNavigate={onNavigate} />
          </MenubarContent>
        </MenubarMenu>
      ))}

      {paperclipPath === null ? <div className="flex-1" /> : <AddressBar path={paperclipPath} onNavigate={onNavigate} />}

      <MenubarMenu value={CONNECTION_MENU}>
        <MenubarTrigger className={`${TRIGGER} mr-1 flex items-center gap-1 border border-sidebar-border`}>
          {connectionName ?? t('Nicht verbunden')}
          <ChevronDown aria-hidden className="size-3 opacity-60" />
        </MenubarTrigger>
        <MenubarContent align="end" sideOffset={5} alignOffset={0}>
          <Entries entries={connectionMenu} shortcuts={settings.settings.shortcuts} onPanel={onPanel} onNavigate={onNavigate} />
        </MenubarContent>
      </MenubarMenu>

      <NotificationBell connected={connected} company={companyId} open={open === 'notifications'} onNavigate={onNavigate} />
      <SettingsMenu {...settings} zoomPercent={zoomPercent} connected={connected} update={update} onPanel={onPanel} />
    </Menubar>
  )
}
