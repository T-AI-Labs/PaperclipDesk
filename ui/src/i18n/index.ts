import { ar } from './ar'
import { de, type Message } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { hi } from './hi'
import { it } from './it'
import { ja } from './ja'
import { pt } from './pt'
import { ru } from './ru'
import { zh } from './zh'

export type { Message }

/// One translation per text of `de`, in the same order; a list of another length does not compile.
export type Catalogue = Translations<typeof de>
type Translations<Texts> = { readonly [Index in keyof Texts]: string }

const CATALOGUES = { en, de, ar, es, fr, hi, it, ja, pt, ru, zh } as const
type Locale = keyof typeof CATALOGUES

/// English first, then by endonym: each language names itself, so nothing here is translated.
export const LANGUAGES: { id: string; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'ar', label: 'العربية' },
  { id: 'de', label: 'Deutsch' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'it', label: 'Italiano' },
  { id: 'pt', label: 'Português' },
  { id: 'ja', label: '日本語' },
  { id: 'ru', label: 'Русский' },
  { id: 'zh', label: '中文' },
]

/// Scripts that run right to left; the whole window mirrors for these.
const RTL: ReadonlySet<Locale> = new Set<Locale>(['ar'])
const INDEX = new Map<string, number>(de.map((message, index) => [message, index]))

let locale: Locale = 'en'

/// `language` is what the app resolved, so the window and the menu bar always agree.
export function setLanguage(language: string) {
  locale = language in CATALOGUES ? (language as Locale) : 'en'
  document.documentElement.lang = locale
  document.documentElement.dir = RTL.has(locale) ? 'rtl' : 'ltr'
}

/// `message` in the current language, with `{name}` placeholders filled from `params`.
export function t(message: Message, params?: Record<string, string | number>): string {
  const template = CATALOGUES[locale][INDEX.get(message) ?? -1] ?? message
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole))
}
