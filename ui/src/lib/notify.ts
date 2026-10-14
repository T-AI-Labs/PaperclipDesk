import { useSyncExternalStore } from 'react'
import { toast as sonner } from 'sonner'

/// A message the app showed as a toast, kept for the notifications menu.
export interface Notice {
  id: number
  kind: 'success' | 'error'
  message: string
  at: Date
}

/// Above Paperclip no toast is shown, so the menu bar's bell is where these are seen.
let notices: { list: Notice[]; unread: number } = { list: [], unread: 0 }
let nextId = 0
const listeners = new Set<() => void>()

function publish(next: typeof notices) {
  notices = next
  for (const listener of listeners) listener()
}

function record(kind: Notice['kind'], message: string) {
  publish({ list: [{ id: nextId++, kind, message, at: new Date() }, ...notices.list].slice(0, 50), unread: notices.unread + 1 })
}

export const toast = {
  success: (message: string) => {
    record('success', message)
    return sonner.success(message)
  },
  error: (message: string) => {
    record('error', message)
    return sonner.error(message)
  },
}

export const markNoticesRead = () => notices.unread > 0 && publish({ ...notices, unread: 0 })
export const clearNotices = () => publish({ list: [], unread: 0 })

export function useNotices() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => notices,
  )
}
