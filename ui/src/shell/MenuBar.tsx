import { useEffect, useState } from 'react'
import { Bell, CircleCheck, OctagonX } from 'lucide-react'

import { Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarMenu, MenubarSeparator, MenubarSub, MenubarSubContent, MenubarSubTrigger, MenubarTrigger } from '@/components/ui/menubar'
import { type Menu, type MenuEntry, menuAction, setMenuOpen } from '@/lib/client'
import { clearNotices, markNoticesRead, useNotices } from '@/lib/notify'
import { t } from '@/i18n'

// Above Paperclip the webview is no taller than the bar until the host has made room for a menu.
const BAR_HEIGHT = 32
const NOTICES = 'notices'

async function makeRoom() {
  await setMenuOpen(true)
  if (window.innerHeight > BAR_HEIGHT) return
  await new Promise<void>((resolve) => {
    window.addEventListener('resize', () => resolve(), { once: true })
    setTimeout(resolve, 300)
  })
}

function Entries({ entries }: { entries: MenuEntry[] }) {
  const inset = entries.some((entry) => entry.kind === 'item' && entry.checked !== null)
  return entries.map((entry, index) => {
    if (entry.kind === 'separator') return <MenubarSeparator key={index} />
    if (entry.kind === 'submenu') {
      return (
        <MenubarSub key={entry.label}>
          <MenubarSubTrigger inset={inset || undefined} disabled={!entry.enabled} className="text-xs data-disabled:pointer-events-none data-disabled:opacity-50">
            {entry.label}
          </MenubarSubTrigger>
          <MenubarSubContent>
            <Entries entries={entry.entries} />
          </MenubarSubContent>
        </MenubarSub>
      )
    }
    const pick = () => void menuAction(entry.id)
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

function Notices() {
  const { list, unread } = useNotices()
  return (
    <MenubarMenu value={NOTICES}>
      <MenubarTrigger aria-label={t('Benachrichtigungen')} className="relative ms-auto rounded-md px-2 py-1 hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent">
        <Bell className="size-3.5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 end-0 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-primary px-0.5 text-[9px] leading-none font-semibold text-primary-foreground">{unread > 9 ? '9+' : unread}</span>
        )}
      </MenubarTrigger>
      <MenubarContent align="end" sideOffset={5} alignOffset={0} className="w-80">
        <MenubarLabel className="text-xs">{t('Benachrichtigungen')}</MenubarLabel>
        <MenubarSeparator />
        {list.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">{t('Keine Benachrichtigungen')}</p>
        ) : (
          <>
            <ul className="max-h-80 overflow-y-auto">
              {list.map((notice) => (
                <li key={notice.id} className="flex gap-2 px-2 py-1.5 text-xs">
                  {notice.kind === 'error' ? <OctagonX className="mt-px size-3.5 shrink-0 text-rose-600 dark:text-rose-400" /> : <CircleCheck className="mt-px size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                  <span className="min-w-0 flex-1 break-words">{notice.message}</span>
                  <time className="shrink-0 text-muted-foreground tabular-nums">{notice.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                </li>
              ))}
            </ul>
            <MenubarSeparator />
            <MenubarItem onSelect={clearNotices} className="text-xs">
              {t('Alle entfernen')}
            </MenubarItem>
          </>
        )}
      </MenubarContent>
    </MenubarMenu>
  )
}

/// The menu bar at the top of the window; the host says what is in it and does what an entry stands for.
export default function MenuBar({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = useState('')

  async function change(next: string) {
    if (next !== '' && open === '') await makeRoom()
    if (next === NOTICES) markNoticesRead()
    setOpen(next)
    if (next === '') void setMenuOpen(false)
  }

  // After a reload of this page the host may still hold room for a menu that is gone.
  useEffect(() => void setMenuOpen(false), [])

  // A menu left open would keep covering Paperclip after the user went elsewhere.
  useEffect(() => {
    if (open === '') return
    const close = () => {
      setOpen('')
      void setMenuOpen(false)
    }
    window.addEventListener('blur', close)
    return () => window.removeEventListener('blur', close)
  }, [open])

  return (
    <Menubar value={open} onValueChange={(next) => void change(next)} className="relative z-30 h-8 shrink-0 gap-0 rounded-none border-0 border-b border-sidebar-border bg-sidebar px-1.5 py-0 text-sidebar-foreground">
      {menus.map((menu) => (
        <MenubarMenu key={menu.label} value={menu.label}>
          <MenubarTrigger className="rounded-md px-2.5 py-1 text-xs font-normal hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent">{menu.label}</MenubarTrigger>
          <MenubarContent sideOffset={5} alignOffset={0}>
            <Entries entries={menu.entries} />
          </MenubarContent>
        </MenubarMenu>
      ))}
      <Notices />
    </Menubar>
  )
}
