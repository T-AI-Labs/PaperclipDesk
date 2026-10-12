import { t } from '@/i18n'
import type { ConnectionProfile, RemotePreflightResult } from '@/lib/client'

export type HealthTone = 'ok' | 'pending' | 'blocked' | 'unknown'

/// What is known about a saved remote since it was last checked.
export function profileHealth(profile: ConnectionProfile): { label: string; tone: HealthTone } {
  switch (profile.lastHealth) {
    case 'healthy':
      return { label: t('Sitzung aktiv'), tone: 'ok' }
    case 'auth_required':
      return { label: t('Anmeldung nötig'), tone: 'pending' }
    case 'unsupported':
      return { label: t('Nicht unterstützt'), tone: 'blocked' }
    case 'unreachable':
      return { label: t('Nicht erreichbar'), tone: 'blocked' }
    default:
      return { label: t('Noch nicht geprüft'), tone: 'unknown' }
  }
}

export const TONE_STYLE: Record<HealthTone, string> = {
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  blocked: 'bg-destructive/15 text-destructive',
  unknown: 'bg-muted text-muted-foreground',
}

export function isInsecureHttpUrl(value: string) {
  return /^http:\/\//i.test(value.trim())
}

export function relativeTime(timestamp: string | undefined): string | null {
  if (!timestamp) return null
  const diff = Date.now() - new Date(timestamp).getTime()
  if (Number.isNaN(diff)) return null
  if (diff < 60_000) return t('gerade eben')
  if (diff < 3_600_000) return t('vor {count} Min.', { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('vor {count} Std.', { count: Math.floor(diff / 3_600_000) })
  const days = Math.floor(diff / 86_400_000)
  return days === 1 ? t('gestern') : t('vor {count} Tagen', { count: days })
}

/// The verdict of a check in words: what was found and what connecting will lead to.
export function describeVerification(result: RemotePreflightResult): { badge: string; tone: HealthTone; detail: string } {
  const withWarning = (detail: string) => [detail, result.warning].filter(Boolean).join(' ')
  if (result.ok) {
    if (result.bootstrapStatus === 'bootstrap_pending') {
      return {
        badge: t('Geprüfter Remote – Einrichtung nötig'),
        tone: 'pending',
        detail: withWarning(t('Der Host ist ein authentifizierter Paperclip-Remote, hat aber noch keinen Instanz-Admin. Nach dem Verbinden führt Paperclip durch die Einrichtung.')),
      }
    }
    if (result.sessionState === 'signed_in') {
      return { badge: t('Authentifiziertes Paperclip erkannt'), tone: 'ok', detail: withWarning(t('Der Host ist eine Paperclip-Instanz im authentifizierten Modus, und es gibt eine aktive Sitzung.')) }
    }
    return {
      badge: t('Geprüfter Remote – Anmeldung nötig'),
      tone: 'ok',
      detail: withWarning(t('Der Host ist eine Paperclip-Instanz im authentifizierten Modus. Nach dem Verbinden führt Paperclip durch die Anmeldung.')),
    }
  }
  const detail = withWarning(result.detail ?? t('Der Remote ließ sich nicht prüfen.'))
  switch (result.reason) {
    case 'unsupported_local_trusted':
    case 'auth_not_ready':
      return { badge: t('Paperclip erkannt, aber nicht geeignet'), tone: 'blocked', detail }
    case 'not_paperclip':
      return { badge: t('Host erreichbar, aber kein Paperclip'), tone: 'blocked', detail }
    case 'tls_error':
      return { badge: t('Zertifikat des Remotes abgelehnt'), tone: 'blocked', detail }
    case 'invalid_url':
      return { badge: t('Ungültige URL'), tone: 'blocked', detail }
    default:
      return { badge: t('Host nicht erreichbar'), tone: 'blocked', detail }
  }
}

export function verificationMeta(result: RemotePreflightResult): string {
  return [
    result.version && t('Version {version}', { version: result.version }),
    result.deploymentMode === 'authenticated' && t('authentifiziert'),
    result.deploymentMode === 'local_trusted' && t('nur lokal'),
    result.deploymentExposure === 'public' && t('öffentlich'),
    result.deploymentExposure === 'private' && t('privat'),
  ]
    .filter(Boolean)
    .join(' · ')
}
