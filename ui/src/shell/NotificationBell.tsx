import { useCallback, useEffect, useState } from 'react'
import { Bell, CircleCheck, Info, LoaderCircle, OctagonX } from 'lucide-react'

import { MenubarContent, MenubarItem, MenubarLabel, MenubarMenu, MenubarSeparator, MenubarTrigger } from '@/components/ui/menubar'
import { relativeTime } from '@/connect/format'
import { type Attention, type AttentionItem, companyAttention, errorMessage, menuAction, openPaperclipPath } from '@/lib/client'
import { type NotificationKind, clearNotifications, markNotificationsRead, toast, useNotifications } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

/// Paperclip's inbox changes while agents work; once a minute keeps the count close without asking the page all the time.
const POLL_MS = 60_000

const NO_ITEMS: AttentionItem[] = []

const KIND_ICON: Record<NotificationKind, typeof Info> = { success: CircleCheck, error: OctagonX, info: Info }
const SEVERITY_TONE: Record<NonNullable<AttentionItem['severity']>, string> = { critical: 'bg-destructive', high: 'bg-amber-500', medium: 'bg-primary', low: 'bg-muted-foreground/50' }

/// The inbox of the company in front, read again whenever the connection or the company changes and once a minute.
function useAttention(connected: boolean, company: string | null) {
  // Undefined until the page answered for the first time.
  const [answer, setAnswer] = useState<{ attention: Attention | null; error: string | null }>()

  const refresh = useCallback(() => {
    if (!connected) return
    companyAttention()
      .then((attention) => setAnswer({ attention, error: null }))
      .catch((e: unknown) => setAnswer((current) => ({ attention: current?.attention ?? null, error: errorMessage(e) })))
  }, [connected])

  useEffect(() => {
    if (!connected) return
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    return () => clearInterval(timer)
  }, [connected, company, refresh])

  return { attention: connected ? (answer?.attention ?? null) : null, loading: connected && answer === undefined, error: connected ? (answer?.error ?? null) : null, refresh }
}

/// The bell at the right of the menu bar: what waits in Paperclip's inbox, and what the app said lately.
export default function NotificationBell({ connected, company, open, onNavigate }: { connected: boolean; company: string | null; open: boolean; onNavigate: () => void }) {
  const { notifications, unread } = useNotifications()
  const { attention, loading, error, refresh } = useAttention(connected, company)
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set())
  const items = attention?.items ?? NO_ITEMS
  const unseen = items.filter((item) => !seen.has(item.id)).length
  const count = unread + unseen

  useEffect(() => {
    if (!open) return
    refresh()
  }, [open, refresh])

  // What was on screen while the bell was open counts as seen once it closes, so nothing is marked before it was shown.
  useEffect(() => {
    if (open) return () => {
      markNotificationsRead()
      setSeen((current) => new Set([...current, ...items.map((item) => item.id)]))
    }
  }, [open, items])

  return (
    <MenubarMenu value="notifications">
      <MenubarTrigger aria-label={count > 0 ? t('Benachrichtigungen, {count} neu', { count }) : t('Benachrichtigungen')} title={t('Benachrichtigungen')} className="relative rounded-md px-2 py-1 hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent">
        <Bell className="size-4" />
        {count > 0 && <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-none font-medium text-primary-foreground tabular-nums">{count > 99 ? '99+' : count}</span>}
      </MenubarTrigger>
      <MenubarContent align="end" sideOffset={5} className="flex max-h-[min(36rem,80vh)] w-96 flex-col overflow-hidden p-0">
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          <MenubarLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <span className="flex-1 truncate">{attention ? t('Posteingang · {company}', { company: attention.company }) : t('Posteingang')}</span>
            {loading && <LoaderCircle className="size-3 animate-spin" />}
          </MenubarLabel>
          {!connected && <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('Erscheint, sobald eine Firma offen ist.')}</p>}
          {connected && error && <p className="px-2 py-1.5 text-xs text-destructive">{error}</p>}
          {connected && !error && attention === null && !loading && <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('Erscheint, sobald eine Firma offen ist.')}</p>}
          {attention && items.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('Nichts wartet auf dich.')}</p>}
          {items.map((item) => (
            <MenubarItem
              key={item.id}
              disabled={!item.href}
              onSelect={() => {
                if (!item.href) return
                onNavigate()
                void openPaperclipPath(item.href).catch((e: unknown) => toast.error(errorMessage(e)))
              }}
              className="items-start gap-2 py-1.5"
            >
              <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.severity ? SEVERITY_TONE[item.severity] : 'bg-muted-foreground/50', seen.has(item.id) && 'opacity-40')} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="line-clamp-2 text-xs font-medium">{item.title}</span>
                {item.why && item.why !== item.title && <span className="line-clamp-2 text-[11px] text-muted-foreground">{item.why}</span>}
              </span>
              {item.at && <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(item.at)}</span>}
            </MenubarItem>
          ))}
          {attention && attention.total > items.length && <p className="px-2 py-1 text-[11px] text-muted-foreground">{t('{count} weitere in Paperclip', { count: attention.total - items.length })}</p>}
          {attention && (
            <MenubarItem
              onSelect={() => {
                onNavigate()
                void menuAction('paperclip.page.inbox').catch((e: unknown) => toast.error(errorMessage(e)))
              }} className="text-xs text-primary">
              {t('Posteingang in Paperclip öffnen')}
            </MenubarItem>
          )}

          <MenubarSeparator />
          <MenubarLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <span className="flex-1">{t('Meldungen der App')}</span>
            {notifications.length > 0 && (
              <button type="button" onClick={clearNotifications} className="rounded px-1.5 py-0.5 text-[11px] hover:bg-accent hover:text-foreground">
                {t('Leeren')}
              </button>
            )}
          </MenubarLabel>
          {notifications.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('Noch keine Meldungen.')}</p>}
          <ul className="flex flex-col">
            {notifications.map((notification) => {
              const Icon = KIND_ICON[notification.kind]
              return (
                <li key={notification.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs">
                  <Icon aria-hidden className={cn('mt-0.5 size-3.5 shrink-0', notification.kind === 'error' ? 'text-destructive' : notification.kind === 'success' ? 'text-primary' : 'text-muted-foreground')} />
                  <span className="min-w-0 flex-1 break-words">{notification.text}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(new Date(notification.at).toISOString())}</span>
                </li>
              )
            })}
          </ul>
        </div>
      </MenubarContent>
    </MenubarMenu>
  )
}
