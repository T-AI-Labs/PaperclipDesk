import { useEffect, useRef, useState } from 'react'
import { Keyboard, RotateCcw, Search, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type PageProps, type Snapshot, errorMessage, onShortcutRecorded, recordShortcut } from '@/lib/client'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

/// The keys of a new installation; the host starts from the same ones.
const DEFAULT_SHORTCUTS: Record<string, string> = { 'view.menu_bar': 'F10', 'view.fullscreen': 'F11' }
/// Text fields in Paperclip and in the app need these.
const RESERVED = ['Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Y', 'Ctrl+Z']
/// Entries that exist only for one company or connection, so a key for them would soon point nowhere.
const PER_ITEM = ['company.', 'connection.recent.', 'connection.open.']

type Action = { id: string; label: string; group: string }

/// Every action a key can start, grouped as in the menus: the view first, then the menus of the bar, the connection and the app.
function actions(snapshot: Snapshot): Action[] {
  const view = t('Ansicht')
  const list: Action[] = [
    { id: 'view.menu_bar', label: t('Menüleiste ein- oder ausblenden'), group: view },
    { id: 'view.zoom_in', label: t('Vergrößern'), group: view },
    { id: 'view.zoom_out', label: t('Verkleinern'), group: view },
    { id: 'view.zoom_reset', label: t('Zoom zurücksetzen'), group: view },
    { id: 'view.reload', label: t('Neu laden'), group: view },
    { id: 'view.fullscreen', label: t('Vollbild'), group: view },
  ]
  const fromMenu = (entries: Snapshot['connectionMenu'], group: string) => {
    for (const entry of entries) {
      if (entry.kind !== 'item' || PER_ITEM.some((prefix) => entry.id.startsWith(prefix)) || list.some((action) => action.id === entry.id)) continue
      list.push({ id: entry.id, label: entry.label, group })
    }
  }
  // The first menu is named after the company in front, which is no name for a group.
  snapshot.menu.forEach((menu, index) => fromMenu(menu.entries, index === 0 ? t('Firma') : menu.label))
  fromMenu(snapshot.connectionMenu, t('Verbindung'))
  const app = t('App')
  list.push({ id: 'shell.server', label: t('Lokaler Server …'), group: app }, { id: 'shell.shortcuts', label: t('Tastenkürzel …'), group: app }, { id: 'app.quit', label: t('Beenden'), group: app })
  return list
}

/// What is wrong with keys as a shortcut, or null when they can have an action.
function problem(keys: string): string | null {
  if (RESERVED.includes(keys)) return t('Für Bearbeiten reserviert.')
  const parts = keys.split('+')
  if (/^F\d+$/.test(parts[parts.length - 1]) || parts.includes('Ctrl') || parts.includes('Alt')) return null
  return t('Braucht Strg oder Alt, außer bei F-Tasten.')
}

function Keys({ keys }: { keys: string }) {
  return (
    <span className="flex gap-1">
      {keys.split('+').map((part) => (
        <kbd key={part} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
          {part}
        </kbd>
      ))}
    </span>
  )
}

/// Shows the key of every action and lets the user give each one another key, remove it or go back to the defaults.
export default function Shortcuts({ snapshot, settings, saving, save }: PageProps & { snapshot: Snapshot }) {
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<string | null>(null)
  const all = actions(snapshot)
  const shortcuts = settings.shortcuts
  // The keys arrive later; they apply to the settings as they are then, without restarting the recording on every render.
  const latest = useRef({ settings, save, all })
  useEffect(() => {
    latest.current = { settings, save, all }
  })

  useEffect(() => {
    if (recording === null) return
    void recordShortcut(true)
    const stop = onShortcutRecorded((keys) => {
      const { settings, save, all } = latest.current
      if (keys === 'Escape') return setRecording(null)
      const wrong = problem(keys)
      if (wrong) return void toast.error(wrong)
      const next = { ...settings.shortcuts }
      for (const [action, bound] of Object.entries(next)) {
        if (bound === keys && action !== recording) {
          delete next[action]
          toast.info(t('{keys} gehörte zu „{action}“ und ist jetzt hier.', { keys, action: all.find((entry) => entry.id === action)?.label ?? action }))
        }
      }
      next[recording] = keys
      setRecording(null)
      void save({ ...settings, shortcuts: next }, '')
    })
    return () => {
      stop()
      void recordShortcut(false).catch((e: unknown) => toast.error(errorMessage(e)))
    }
  }, [recording])

  function remove(id: string) {
    const next = { ...shortcuts }
    delete next[id]
    void save({ ...settings, shortcuts: next }, '')
  }

  const needle = query.trim().toLowerCase()
  const shown = all.filter((action) => needle === '' || [action.label, action.group, shortcuts[action.id] ?? ''].some((text) => text.toLowerCase().includes(needle)))
  const groups = [...new Set(shown.map((action) => action.group))]

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('Kürzel wirken, solange das Fenster von PaperclipDesk den Fokus hat.')}</p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Tastenkürzel suchen …')} aria-label={t('Tastenkürzel suchen …')} className="pl-8" />
        </div>
        <Button variant="outline" disabled={saving} onClick={() => void save({ ...settings, shortcuts: DEFAULT_SHORTCUTS }, '')}>
          <RotateCcw /> {t('Standard wiederherstellen')}
        </Button>
      </div>

      {groups.length === 0 && <p className="text-sm text-muted-foreground">{t('Keine Treffer')}</p>}
      {groups.map((group) => (
        <section key={group} className="flex flex-col">
          <h3 className="pb-1 text-xs font-medium text-muted-foreground">{group}</h3>
          <div className="divide-y rounded-lg border">
            {shown
              .filter((action) => action.group === group)
              .map((action) => {
                const keys = shortcuts[action.id]
                const active = recording === action.id
                return (
                  <div key={action.id} className={cn('flex min-h-11 items-center gap-2 px-3 py-1.5 text-sm', active && 'bg-muted/60')}>
                    <span className="min-w-0 flex-1 truncate">{action.label}</span>
                    {active ? (
                      <span className="text-xs text-primary">{t('Taste drücken … (Esc bricht ab)')}</span>
                    ) : keys ? (
                      <Keys keys={keys} />
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('Nicht belegt')}</span>
                    )}
                    <Button variant="ghost" size="icon-sm" disabled={saving} title={t('Kürzel zuweisen')} aria-label={t('Kürzel zuweisen')} onClick={() => setRecording(active ? null : action.id)}>
                      <Keyboard />
                    </Button>
                    <Button variant="ghost" size="icon-sm" disabled={saving || !keys} title={t('Kürzel entfernen')} aria-label={t('Kürzel entfernen')} onClick={() => remove(action.id)}>
                      <X />
                    </Button>
                  </div>
                )
              })}
          </div>
        </section>
      ))}
    </div>
  )
}
