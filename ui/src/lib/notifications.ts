import { useSyncExternalStore } from 'react'
import { type ExternalToast, toast as sonner } from 'sonner'

export type NotificationKind = 'success' | 'error' | 'warning' | 'info'

/// A message the app showed as a toast, kept for the bell after the toast is gone.
export interface AppNotification {
  id: number
  kind: NotificationKind
  text: string
  at: number
}

/// The bell keeps the newest ones; older messages are in the log.
const KEPT = 100

let notifications: AppNotification[] = []
let readUntil = 0
let nextId = 1
const listeners = new Set<() => void>()
let state = { notifications, unread: 0 }

function changed() {
  state = { notifications, unread: notifications.filter((notification) => notification.id > readUntil).length }
  for (const listener of listeners) listener()
}

/// Keeps a message for the bell without showing it as a toast.
export function record(kind: NotificationKind, text: string, at = Date.now()) {
  if (notifications.some((known) => known.text === text && known.at === at)) return
  notifications = [{ id: nextId++, kind, text, at }, ...notifications].sort((a, b) => b.at - a.at).slice(0, KEPT)
  changed()
}

function shown(kind: Exclude<NotificationKind, 'warning'>, message: string, options?: ExternalToast) {
  record(kind, message)
  return sonner[kind](message, options)
}

/// Sonner's toast for the kinds the app uses, each one also kept for the bell.
export const toast = {
  success: (message: string, options?: ExternalToast) => shown('success', message, options),
  error: (message: string, options?: ExternalToast) => shown('error', message, options),
  info: (message: string, options?: ExternalToast) => shown('info', message, options),
}

export function markNotificationsRead() {
  readUntil = nextId - 1
  changed()
}

export function clearNotifications() {
  notifications = []
  changed()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export function useNotifications() {
  return useSyncExternalStore(subscribe, () => state)
}
