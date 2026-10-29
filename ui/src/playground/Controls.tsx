import { useState } from 'react'
import { ChevronDown, ChevronUp, FlaskConical } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { MENU_VARIANTS } from './menus'
import { SCENARIOS, type Scenario, options, raise } from './host'

const OPEN_KEY = 'playground.controls-open'

function readOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

function reload(change: Partial<{ scenario: Scenario; menu: string; update: boolean }>) {
  const next = { ...options, ...change }
  const query = new URLSearchParams({ scenario: next.scenario, menu: next.menu, ...(next.update && { update: '1' }) })
  location.search = query.toString()
}

const field = 'h-7 w-full rounded-md border bg-background px-2 text-xs'

/// The playground's own controls, outside the app: which state the fake host is in and what it does next.
export default function Controls() {
  const [open, setOpen] = useState(readOpen)
  const toggle = () => {
    setOpen(!open)
    try {
      localStorage.setItem(OPEN_KEY, open ? '0' : '1')
    } catch {
      // Without storage the panel opens again on the next reload.
    }
  }

  return (
    <div className="fixed bottom-3 left-3 z-[100] w-60 rounded-lg border bg-popover/95 text-popover-foreground shadow-lg backdrop-blur">
      <button type="button" onClick={toggle} className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium">
        <FlaskConical className="size-3.5 text-primary" /> Playground
        {open ? <ChevronDown className="ml-auto size-3.5" /> : <ChevronUp className="ml-auto size-3.5" />}
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 border-t px-3 pt-2.5 pb-3 text-xs">
          <label className="flex flex-col gap-1">
            Zustand
            <select className={field} value={options.scenario} onChange={(event) => reload({ scenario: event.target.value as Scenario })}>
              {Object.entries(SCENARIOS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Menü-Variante
            <select className={field} value={options.menu} onChange={(event) => reload({ menu: event.target.value })}>
              {Object.entries(MENU_VARIANTS).map(([id, variant]) => (
                <option key={id} value={id}>
                  {variant.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={options.update} onChange={(event) => reload({ update: event.target.checked })} />
            Update verfügbar
          </label>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" onClick={() => raise({ text: 'The server stopped while starting (exit code 1).', error: true })}>
              Fehler
            </Button>
            <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" onClick={() => raise({ text: 'No database backup in the last 26 hours.', error: false })}>
              Warnung
            </Button>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">Design, Farbe und Sprache stellst du im Zahnrad der App ein.</p>
        </div>
      )}
    </div>
  )
}
