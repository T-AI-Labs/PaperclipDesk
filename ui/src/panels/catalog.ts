import type { Message } from '@/i18n'
import type { TemplateAgent, TemplateInput, TemplateSkill } from '@/lib/client'

import snapshot from './templates.json'

export type TemplateCategory = 'software' | 'security' | 'research' | 'creative' | 'business'

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: Message }[] = [
  { id: 'software', label: 'Software' },
  { id: 'security', label: 'Sicherheit' },
  { id: 'research', label: 'Forschung' },
  { id: 'creative', label: 'Kreativ' },
  { id: 'business', label: 'Business' },
]

/// A company of Paperclip's catalog github.com/paperclipai/companies, by its folder there. The texts are the catalog's own, in English.
export interface Template {
  id: string
  name: string
  description: string
  category: TemplateCategory
  goals: string[]
  /// The environment values its agents read; a required one must be given for the import to succeed.
  inputs: TemplateInput[]
  /// The GitHub repository the template was generated from, as owner/name.
  source: string
  /// The source repository's stars on GitHub, the measure of how popular the template is.
  stars: number
  /// When the source repository was last pushed to, as YYYY-MM-DD.
  sourceUpdated: string
  agents: TemplateAgent[]
  teams: TemplateTeam[]
  skills: TemplateSkill[]
}

export interface TemplateTeam {
  slug: string
  name: string
  description: string | null
  manager: string | null
  members: string[]
}

/// Sites with templates of their own. Their templates are not in this catalog: the app only points to them, and loads nothing from them.
export interface Provider {
  id: 'clipmart' | 'paperclip_cloud' | 'use_paperclip'
  name: string
  templates: number
  /// Whether running its templates costs money to the provider; the running costs of the AI models come on top everywhere.
  paid: boolean
  description: Message
  /// Whether its templates can come into the Paperclip the app runs, by the provider's own way rather than this panel.
  importable: boolean
}

/// As of PROVIDERS_DATE.
export const PROVIDERS: Provider[] = [
  {
    id: 'clipmart',
    name: 'Clipmart',
    templates: 60,
    paid: false,
    importable: true,
    description: 'Community-Katalog mit {count} Vorlagen verschiedener Autoren. Download als ZIP, Import mit „npx companies.sh“. Die genannten Betriebskosten und Umsätze sind Schätzungen der Seite.',
  },
  {
    id: 'paperclip_cloud',
    name: 'PaperclipCloud',
    templates: 9,
    paid: true,
    importable: false,
    description: 'Hosting-Anbieter mit {count} Vorlagen, die nur auf seinen Servern laufen. Tarife nach Zahl der Firmen; Preise nennt er erst bei der Registrierung.',
  },
  {
    id: 'use_paperclip',
    name: 'usepaperclip.app',
    templates: 5,
    paid: true,
    importable: false,
    description: 'Hosting-Dienst mit {count} Vorlagen, die nur auf seinen Servern laufen, für 29 $ im Monat.',
  },
]

export const PROVIDERS_DATE = '2026-10-23'

/// Read by `npm run catalog` from Paperclip's catalog; a new template arrives with an app update.
export const TEMPLATES = snapshot.templates as Template[]

/// When the snapshot was read, stars and dates included.
export const CATALOG_DATE = snapshot.date
