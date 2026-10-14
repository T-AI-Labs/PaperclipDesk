import { useEffect, useState } from 'react'

import { Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarSub, MenubarSubContent, MenubarSubTrigger, MenubarTrigger } from '@/components/ui/menubar'
import { type Menu, type MenuEntry, menuAction, setMenuOpen } from '@/lib/client'

// Above Paperclip the webview is no taller than the bar until the host has made room for a menu.
const BAR_HEIGHT = 32

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

/// The menu bar at the top of the window; the host says what is in it and does what an entry stands for.
export default function MenuBar({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = useState('')

  async function change(next: string) {
    if (next !== '' && open === '') await makeRoom()
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
    </Menubar>
  )
}
