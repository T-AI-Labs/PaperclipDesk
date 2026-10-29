import type { Menu, MenuEntry } from '@/lib/client'
import { hostText } from './host-texts'

/// Everything a menu variant may depend on.
export interface MenuContext {
  language: string
  connected: boolean
  companies: { id: string; name: string; current: boolean }[]
  remotes: { id: string; name: string; host: string; open: boolean }[]
  localOpen: boolean
}

export interface MenuVariant {
  label: string
  menus: (context: MenuContext) => Menu[]
  connection: (context: MenuContext) => MenuEntry[]
}

const item = (id: string, label: string, enabled = true): MenuEntry => ({ kind: 'item', id, label, enabled, checked: null })
const check = (id: string, label: string, checked: boolean): MenuEntry => ({ kind: 'item', id, label, enabled: true, checked })
const separator: MenuEntry = { kind: 'separator' }

/// What src-tauri/src/menu.rs builds today; a variant to decide on gets a copy of it below and changes what it is about.
const current: MenuVariant = {
  label: 'Aktuell (menu.rs)',
  menus: ({ language, connected, companies }) => {
    const text = (german: string) => hostText(language, german)
    const page = (path: string, label: string) => item(`paperclip.page.${path}`, text(label), connected)
    const company: MenuEntry[] = [
      ...(companies.length > 0 ? [...companies.map((known) => check(`company.${known.id}`, known.name, known.current)), separator] : []),
      page('companies', 'Firmen verwalten …'),
      page('company/settings', 'Firmeneinstellungen'),
      separator,
      item('shell.templates', text('Neue Firma aus Vorlage …')),
    ]
    const create: MenuEntry[] = [item('paperclip.new_issue', text('Neue Aufgabe …'), connected), page('agents/new', 'Neuer Agent …'), separator, item('paperclip.search', text('Suchen …'), connected)]
    const go: MenuEntry[] = [
      { kind: 'label', label: text('Arbeit') },
      page('dashboard', 'Dashboard'),
      page('inbox', 'Posteingang'),
      page('issues', 'Aufgaben'),
      page('goals', 'Ziele'),
      { kind: 'label', label: text('Team') },
      page('agents', 'Agenten'),
      page('approvals', 'Genehmigungen'),
      page('costs', 'Kosten'),
    ]
    const help: MenuEntry[] = [
      item('help.docs', text('Paperclip-Dokumentation')),
      item('help.report_issue', text('Problem melden …')),
      separator,
      { kind: 'submenu', label: text('Fehlersuche'), entries: [item('help.logs', text('Protokoll')), item('help.data_folder', text('Datenordner öffnen')), item('view.devtools', text('Entwicklertools'))] },
      separator,
      item('help.about', text('Über PaperclipDesk')),
    ]
    return [
      { label: text('Firma'), entries: company },
      { label: text('Neu'), entries: create },
      { label: text('Gehe zu'), entries: go },
      { label: text('Hilfe'), entries: help },
    ]
  },
  connection: ({ language, remotes, localOpen }) => [
    check('connection.local', hostText(language, 'Lokal'), localOpen),
    ...remotes.map((remote) => check(`connection.recent.${remote.id}`, hostText(language, '{} (Remote: {})', remote.name, remote.host), remote.open)),
    separator,
    item('shell.connections', hostText(language, 'Remotes bearbeiten …')),
    item('connection.chooser', hostText(language, 'Remote-Verbindungen verwalten …')),
  ],
}

/// The menu bars to compare, by the id the playground's URL names them with.
export const MENU_VARIANTS: Record<string, MenuVariant> = { current }
