import { Globe, Monitor, Plus, X } from 'lucide-react'
import { toast } from 'sonner'

import { type OpenConnection, activateConnection, closeConnection, errorMessage, showPage } from '@/lib/client'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

const failed = (e: unknown) => toast.error(errorMessage(e))

/// The open connections as tabs. While several are open the app keeps this strip visible above Paperclip; its height is TAB_STRIP_HEIGHT in client.rs.
export default function TabStrip({ connections }: { connections: OpenConnection[] }) {
  return (
    <div role="tablist" className="relative z-20 flex h-10 shrink-0 items-center gap-1 border-b border-sidebar-border bg-sidebar px-2 text-sm text-sidebar-foreground">
      {connections.map((connection) => (
        <div
          key={connection.key}
          className={cn('flex h-8 min-w-0 items-center rounded-md', connection.front ? 'bg-background text-foreground ring-1 ring-sidebar-border' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/70')}
        >
          <button type="button" role="tab" aria-selected={connection.front} onClick={() => activateConnection(connection.key).catch(failed)} className="flex h-full min-w-0 items-center gap-2 pr-1.5 pl-3">
            {connection.local ? <Monitor className="size-4 shrink-0" /> : <Globe className="size-4 shrink-0" />}
            <span className="truncate">{connection.local ? t('Lokal') : connection.name}</span>
          </button>
          <button
            type="button"
            title={t('Trennen')}
            aria-label={t('Trennen')}
            onClick={() => closeConnection(connection.key).catch(failed)}
            className="mr-1 grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        title={t('Alle Verbindungen')}
        aria-label={t('Alle Verbindungen')}
        onClick={() => showPage('connect').catch(failed)}
        className="grid size-8 shrink-0 place-items-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}
