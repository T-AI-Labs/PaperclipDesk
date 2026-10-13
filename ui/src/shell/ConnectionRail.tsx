import { Monitor, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { type Snapshot, activateConnection, connectLocal, connectSavedProfile, errorMessage, showPage } from '@/lib/client'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

const failed = (e: unknown) => toast.error(errorMessage(e))

const ITEM = 'relative grid size-9 shrink-0 place-items-center rounded-md text-xs font-semibold'

/// Every connection as one entry, kept visible next to Paperclip; the width is CONNECTION_RAIL_WIDTH in client.rs.
export default function ConnectionRail({ snapshot }: { snapshot: Snapshot }) {
  const open = snapshot.openConnections
  const saved = snapshot.profiles.map((profile) => {
    const local = profile.mode === 'local_embedded'
    return {
      id: profile.id,
      name: local ? t('Lokal') : profile.name,
      local,
      open: open.find((connection) => (local ? connection.local : connection.profileId === profile.id)),
      connect: () => (local ? connectLocal() : connectSavedProfile(profile.id)),
    }
  })
  // A remote that was connected once without saving it has no profile.
  const unsaved = open
    .filter((connection) => !connection.local && !snapshot.profiles.some((profile) => profile.id === connection.profileId))
    .map((connection) => ({ id: connection.key, name: connection.name, local: false, open: connection, connect: () => activateConnection(connection.key) }))

  return (
    <nav aria-label={t('Alle Verbindungen')} className="relative z-20 flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-2 text-sidebar-foreground">
      {[...saved, ...unsaved].map((entry) => (
        <button
          key={entry.id}
          type="button"
          title={entry.name}
          aria-label={entry.name}
          aria-current={entry.open?.front ? 'page' : undefined}
          onClick={() => (entry.open ? activateConnection(entry.open.key) : entry.connect()).catch(failed)}
          className={cn(
            ITEM,
            entry.open?.front
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : cn('hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground', entry.open ? 'text-sidebar-foreground' : 'text-sidebar-foreground/45'),
          )}
        >
          {entry.open?.front && <span aria-hidden className="absolute top-1/2 -left-1.5 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary" />}
          {entry.local ? <Monitor className="size-4" /> : entry.name.trim().slice(0, 2).toUpperCase()}
          {entry.open && !entry.open.front && <span aria-hidden className="absolute right-1 bottom-1 size-1.5 rounded-full bg-emerald-500" />}
        </button>
      ))}
      <button
        type="button"
        title={t('Alle Verbindungen')}
        aria-label={t('Alle Verbindungen')}
        onClick={() => showPage('connect').catch(failed)}
        className={cn(ITEM, 'mt-auto text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground')}
      >
        <Plus className="size-4" />
      </button>
    </nav>
  )
}
