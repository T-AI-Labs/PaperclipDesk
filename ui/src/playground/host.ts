import { emit } from '@tauri-apps/api/event'
import { mockIPC } from '@tauri-apps/api/mocks'

import type { Alert, ConnectionProfile, LauncherPage, LauncherView, Settings, Snapshot } from '@/lib/client'
import { LANGUAGES } from '@/i18n'
import { MENU_VARIANTS } from './menus'

export const SCENARIOS = {
  paperclip: 'Paperclip offen',
  welcome: 'Willkommen, nicht verbunden',
  chooser: 'Verbindungen wählen',
  booting: 'Lokaler Server startet',
  error: 'Start fehlgeschlagen',
  logs: 'Protokoll',
} as const
export type Scenario = keyof typeof SCENARIOS

/// What the playground's URL chooses; changing it reloads the page, so every start is the app's own start.
export const options = (() => {
  const query = new URLSearchParams(location.search)
  const scenario = query.get('scenario')
  const menu = query.get('menu')
  return {
    scenario: (scenario && scenario in SCENARIOS ? scenario : 'paperclip') as Scenario,
    menu: menu && menu in MENU_VARIANTS ? menu : 'current',
    update: query.get('update') === '1',
  }
})()

const SETTINGS_KEY = 'playground.settings'
const DEFAULT_SETTINGS: Settings = {
  color_scheme: 'system',
  theme: 'fluent',
  accent: 'default',
  show_logs: true,
  clear_logs_on_exit: false,
  check_updates_on_start: true,
  show_welcome: false,
  show_menu_bar: true,
  show_address_bar: false,
  error_popups: true,
  show_tray: true,
  shortcuts: { 'view.fullscreen': 'F11', 'view.menu_bar': 'F10' },
  language: 'System',
  server_version: null,
}

function storedSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

let settings = storedSettings()

const REMOTE: ConnectionProfile = {
  id: 'team',
  name: 'Team-Server',
  mode: 'remote_existing',
  remoteUrl: 'https://paperclip.example.com',
  createdAt: '2026-10-01T09:00:00Z',
  updatedAt: '2026-10-01T09:00:00Z',
  lastConnectedAt: '2026-10-27T16:20:00Z',
  lastHealth: 'healthy',
  lastDeploymentMode: 'authenticated',
  lastSessionState: 'signed_in',
}

const COMPANIES = [
  { id: 'aeon', name: 'Aeon Intelligence', current: true },
  { id: 'agency', name: 'Agency Agents', current: false },
  { id: 'devshop', name: 'Superpowers Dev Shop', current: false },
]

const scene: Record<Scenario, { page: LauncherPage; view: LauncherView; connected: boolean }> = {
  paperclip: { page: 'paperclip', view: 'welcome', connected: true },
  welcome: { page: 'connect', view: 'welcome', connected: false },
  chooser: { page: 'connect', view: 'chooser', connected: false },
  booting: { page: 'connect', view: 'local-boot', connected: false },
  error: { page: 'connect', view: 'error', connected: false },
  logs: { page: 'logs', view: 'welcome', connected: true },
}

const state = { ...scene[options.scenario], viewSeq: 1, zoom: 100, profiles: [REMOTE] }

function language() {
  if (settings.language !== 'System') return settings.language
  const browser = navigator.language.slice(0, 2)
  return LANGUAGES.some((known) => known.id === browser) ? browser : 'en'
}

function snapshot(): Snapshot {
  const variant = MENU_VARIANTS[options.menu]
  const context = { language: language(), connected: state.connected, companies: state.connected ? COMPANIES : [], remotes: [{ id: REMOTE.id, name: REMOTE.name, host: 'paperclip.example.com', open: false }], localOpen: state.connected }
  const onPaperclip = state.page === 'paperclip'
  return {
    view: state.view,
    viewSeq: state.viewSeq,
    page: state.page,
    label: null,
    url: state.connected ? 'http://127.0.0.1:3100' : null,
    bootStatus: state.view === 'local-boot' ? { step: 'server', detail: 'Paperclip-Server startet …', progress: 60 } : null,
    connectionError: state.view === 'error' ? { title: 'Lokales Paperclip konnte nicht gestartet werden', detail: 'The server stopped while starting (exit code 1).' } : null,
    hasCurrentConnection: state.connected,
    currentConnectionName: state.connected ? 'Lokal' : null,
    currentProfileId: state.connected ? 'local_embedded' : null,
    openConnections: state.connected ? [{ key: 'local', profileId: 'local_embedded', name: 'Lokal', local: true, front: true }] : [],
    menu: variant.menus(context),
    connectionMenu: variant.connection(context),
    zoomPercent: state.zoom,
    paperclipPath: onPaperclip && settings.show_address_bar ? '/AEO/dashboard' : null,
    menuBarShown: !onPaperclip || settings.show_menu_bar,
    state: { activeProfileId: state.connected ? 'local_embedded' : null, startupProfileIds: ['local_embedded'], localProfileName: 'Lokal', localLastHealth: 'healthy' },
    profiles: state.profiles,
    localServerVersion: '2026.1001.0',
    localServerInstalled: true,
    language: language(),
  }
}

const send = () => void emit('launcher:state', snapshot())
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

function show(page: LauncherPage, view: LauncherView = state.view) {
  if (view !== state.view) state.viewSeq += 1
  Object.assign(state, { page, view })
  send()
}

async function bootLocal() {
  state.connected = false
  show('connect', 'local-boot')
  await wait(1500)
  state.connected = true
  show('paperclip')
}

/// Raises an alert the way the host does, for the toast and the bell.
export const raise = (alert: Omit<Alert, 'at'>) => void emit('launcher:alert', { ...alert, at: Date.now() })

const LOG_LINES = [
  '2026-10-28T19:25:04Z  INFO paperclipdesk: starting version="1.4.0"',
  '2026-10-28T19:25:09Z  INFO paperclipdesk::client: local server started pid=3256 port=3100',
  '{"level":30,"msg":"plugin-loader: loading all ready plugins"}',
  '{"level":40,"msg":"No .sql.gz database backups found"}',
  '2026-10-28T19:26:12Z  WARN paperclipdesk::alerts: the server reported a slow query',
]

const commands: Record<string, (args: Record<string, unknown>) => unknown> = {
  launcher_state: () => snapshot(),
  get_settings: () => settings,
  update_settings: ({ settings: next }) => {
    settings = next as Settings
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // A private window keeps the settings until the next reload.
    }
    send()
    return settings
  },
  recent_alerts: () => [],
  set_menu_open: () => null,
  record_shortcut: () => null,
  set_zoom: ({ percent }) => {
    state.zoom = Math.min(300, Math.max(30, percent as number))
    send()
  },
  show_page: ({ page }) => show(page as LauncherPage),
  menu_action: ({ id }) => {
    const step = { 'view.zoom_in': 10, 'view.zoom_out': -10 }[id as string]
    if (step) return commands.set_zoom({ percent: state.zoom + step })
    if (id === 'view.zoom_reset') return commands.set_zoom({ percent: 100 })
    if (id === 'help.logs') return show('logs')
    if (id === 'connection.local') return void bootLocal()
    if (id === 'connection.chooser') return show('connect', 'chooser')
    console.info(`[playground] menu entry ${String(id)} does nothing here`)
  },
  connect_local: () => void bootLocal(),
  connect_saved_profile: () => void bootLocal(),
  connect_remote: () => void bootLocal(),
  cancel_connect: () => show('connect', 'welcome'),
  return_to_current_session: () => {
    if (state.connected) show('paperclip')
    return state.connected
  },
  activate_connection: () => show('paperclip'),
  close_connection: () => {
    state.connected = false
    show('connect', 'welcome')
  },
  set_open_at_start: () => snapshot(),
  save_remote_profile: () => snapshot(),
  duplicate_profile: () => snapshot(),
  delete_profile: ({ profileId }) => {
    state.profiles = state.profiles.filter((profile) => profile.id !== profileId)
    return snapshot()
  },
  verify_remote: ({ remoteUrl }) => ({
    ok: true,
    normalizedUrl: remoteUrl,
    origin: remoteUrl,
    insecureTransport: false,
    paperclipDetected: true,
    deploymentMode: 'authenticated',
    deploymentExposure: 'private',
    authReady: true,
    bootstrapStatus: 'ready',
    bootstrapInviteActive: false,
    sessionState: 'signed_out',
    version: '2026.1023.0',
  }),
  get_log: () => ({ files: [{ name: 'paperclipdesk.log', size: 48213, modified_ms: Date.now() }], file: 'paperclipdesk.log', lines: LOG_LINES }),
  clear_log: () => null,
  company_attention: () =>
    state.connected
      ? {
          company: 'aeon',
          total: 2,
          items: [
            { id: '1', kind: 'approval', title: 'Hire a second engineer', why: 'The CEO asks for approval', severity: 'high', at: new Date().toISOString(), href: '/AEO/approvals' },
            { id: '2', kind: 'issue', title: 'Weekly research digest', why: 'Blocked for two days', severity: 'medium', at: new Date().toISOString(), href: '/AEO/issues' },
          ],
        }
      : null,
  check_for_updates: () => ({ updateAvailable: options.update, version: options.update ? '1.5.0' : null, notes: options.update ? '- A sample release note.\n- Another one.' : null }),
  install_update: () => Promise.reject(new Error('Im Playground wird nichts installiert.')),
  get_about: () => ({ version: 'playground', server_version: '2026.1001.0', user_data: 'C:\\Users\\you\\AppData\\Roaming\\Paperclip', paperclip_home: 'C:\\Users\\you\\AppData\\Roaming\\Paperclip' }),
  server_info: () => ({ version: '2026.1001.0', pinned_version: '2026.1001.0', can_reinstall: true, running: state.connected, instance_dir: 'C:\\Users\\you\\AppData\\Roaming\\Paperclip\\instances\\default' }),
  server_versions: () => wait(600).then(() => ['2026.1023.0']),
  upgrade_server: () => wait(800).then(() => null),
  restart_local_server: () => void bootLocal(),
  reinstall_server: () => void bootLocal(),
  read_server_config: () => ({ config: '{\n  "server": { "port": 3100 }\n}', env: '' }),
  write_server_config: () => null,
  reset_local_server: () => null,
  export_settings: () => null,
  import_settings: () => null,
  open_data_folder: () => null,
  open_project_link: () => null,
  open_paperclip_path: () => show('paperclip'),
  adapter_options: () => [
    { type: 'claude_local', models: [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }] },
    { type: 'codex_local', models: [] },
    { type: 'process', models: [] },
  ],
  github_cli_signed_in: () => true,
  import_company_template: () => wait(1500).then(() => show('paperclip')),
}

/// Answers the shell's commands in place of the Rust host; events go between the two through the same mock.
export function installHost() {
  mockIPC(
    (command, args) => {
      const handler = commands[command]
      if (handler) return handler((args ?? {}) as Record<string, unknown>)
      console.warn(`[playground] no answer for the command ${command}`)
      return null
    },
    { shouldMockEvents: true },
  )
}
