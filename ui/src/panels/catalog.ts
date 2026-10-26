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

/// Read by `npm run catalog` from Paperclip's catalog; a new template arrives with an app update.
export const TEMPLATES = snapshot.templates as Template[]

/// When the snapshot was read, stars and dates included.
export const CATALOG_DATE = snapshot.date
