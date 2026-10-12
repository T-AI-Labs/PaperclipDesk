import { useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { AppMark } from '@/components/app-mark'
import { IconTile } from '@/components/icon-tile'
import { toneStyle, type Tone } from '@/lib/tones'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

export interface NavPage {
  id: string
  label: string
  icon: LucideIcon
  tone: Tone
}

function NavItem({ page, active, shortcut, onOpen }: { page: NavPage; active: boolean; shortcut: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? 'page' : undefined}
      aria-label={page.label}
      title={`Strg+${shortcut}`}
      style={toneStyle(page.tone)}
      className={cn(
        'group relative flex items-center gap-3 rounded-xl p-1.5 pr-2.5 text-sm transition-all duration-200',
        active
          ? 'tone-soft font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
      )}
    >
      {active && <span aria-hidden className="tone-bar absolute top-1/2 -left-3 h-5 w-1 -translate-y-1/2 rounded-r-full" />}
      <IconTile
        icon={page.icon}
        tone={page.tone}
        className={cn('transition-transform duration-200 group-hover:scale-105 group-active:scale-95', !active && 'saturate-[.85] group-hover:saturate-100')}
      />
      <span className="flex-1 truncate text-left">{page.label}</span>
      <kbd className="hidden rounded border border-sidebar-border bg-sidebar/60 px-1 font-sans text-[10px] text-sidebar-foreground/60 group-hover:inline">Strg {shortcut}</kbd>
    </button>
  )
}

/// The navigation of the settings: one entry per category, and the way back to where the user came from.
export default function Sidebar({
  pages,
  page,
  onOpen,
  backLabel,
  onBack,
  subtitle,
}: {
  pages: NavPage[]
  page: string
  onOpen: (id: string) => void
  backLabel: string
  onBack: () => void
  subtitle: string
}) {
  // Ctrl+1 … open the categories.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return
      const index = Number(event.key) - 1
      if (index >= 0 && index < pages.length) {
        event.preventDefault()
        onOpen(pages[index].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onOpen, pages])

  return (
    <aside className="glass-surface relative z-10 flex h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-3 pt-5 pb-2 pl-3.5">
        <AppMark className="size-9 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col pr-3 leading-tight">
          <span className="font-heading font-semibold tracking-tight">{t('Einstellungen')}</span>
          <span className="truncate text-xs text-sidebar-foreground/60">{subtitle}</span>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-3 pt-1 pb-3" aria-label={t('Einstellungen')}>
        {pages.map((p, index) => (
          <NavItem key={p.id} page={p} active={p.id === page} shortcut={String(index + 1)} onOpen={() => onOpen(p.id)} />
        ))}

        <button
          type="button"
          onClick={onBack}
          className="group mt-auto flex items-center gap-3 rounded-xl p-1.5 pr-2.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-sidebar-border bg-sidebar/60 transition-colors group-hover:bg-sidebar">
            <ArrowLeft className="size-4" />
          </span>
          <span className="flex-1 truncate text-left">{backLabel}</span>
        </button>
      </nav>
    </aside>
  )
}
