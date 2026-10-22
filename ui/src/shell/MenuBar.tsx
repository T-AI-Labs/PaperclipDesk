import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarMenu, MenubarSeparator, MenubarTrigger } from '@/components/ui/menubar'
import { type Menu, type MenuEntry, type PageProps, holdOverlay, menuAction, setMenuOpen } from '@/lib/client'
import SettingsMenu, { type Panel } from '@/shell/SettingsMenu'
import { t } from '@/i18n'

// Above Paperclip the webview is no taller than the bar until the host has made room for a menu.
const BAR_HEIGHT = 32
const CONNECTION_MENU = 'connection'
/// Entries that open a panel of the shell; the host names them, the shell handles them.
const SHELL_PANELS: Record<string, Panel> = { 'shell.updates': 'updates', 'shell.connections': 'remotes', 'shell.templates': 'templates' }

const TRIGGER = 'rounded-md px-2.5 py-1 text-xs font-normal hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent'

async function makeRoom() {
  await holdOverlay('menu', true)
  if (window.innerHeight > BAR_HEIGHT) return
  await new Promise<void>((resolve) => {
    window.addEventListener('resize', () => resolve(), { once: true })
    setTimeout(resolve, 300)
  })
}

function Entries({ entries, onPanel }: { entries: MenuEntry[]; onPanel: (panel: Panel) => void }) {
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
    const panel = SHELL_PANELS[entry.id]
    const pick = () => (panel ? onPanel(panel) : void menuAction(entry.id))
    return entry.checked === null ? (
      <MenubarItem key={entry.id} inset={inset || undefined} disabled={!entry.enabled} onSelect={pick} className="text-xs">
        {entry.label}
      </MenubarItem>
    ) : (
      <MenubarCheckboxItem key={entry.id} checked={entry.checked} disabled={!entry.enabled} onSelect={pick} className="text-xs">
        {entry.label}
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
  onPanel,
  ...settings
}: PageProps & { menus: Menu[]; connectionMenu: MenuEntry[]; connectionName: string | null; zoomPercent: number; connected: boolean; onPanel: (panel: Panel) => void }) {
  const [open, setOpen] = useState('')

  async function change(next: string) {
    if (next !== '' && open === '') await makeRoom()
    setOpen(next)
    if (next === '') void holdOverlay('menu', false)
  }

  // After a reload of this page the host may still hold room for a menu that is gone.
  useEffect(() => void setMenuOpen(false), [])

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
        // The first menu is named after the company in front, so its label changes; its place does not.
        <MenubarMenu key={index} value={`menu-${index}`}>
          <MenubarTrigger className={index === 0 ? `${TRIGGER} font-medium` : TRIGGER}>{menu.label}</MenubarTrigger>
          <MenubarContent sideOffset={5} alignOffset={0}>
            <Entries entries={menu.entries} onPanel={onPanel} />
          </MenubarContent>
        </MenubarMenu>
      ))}

      <div className="flex-1" />

      <MenubarMenu value={CONNECTION_MENU}>
        <MenubarTrigger className={`${TRIGGER} mr-1 flex items-center gap-1 border border-sidebar-border`}>
          {connectionName ?? t('Nicht verbunden')}
          <ChevronDown aria-hidden className="size-3 opacity-60" />
        </MenubarTrigger>
        <MenubarContent align="end" sideOffset={5} alignOffset={0}>
          <Entries entries={connectionMenu} onPanel={onPanel} />
        </MenubarContent>
      </MenubarMenu>

      <SettingsMenu {...settings} zoomPercent={zoomPercent} connected={connected} onPanel={onPanel} />
    </Menubar>
  )
}
