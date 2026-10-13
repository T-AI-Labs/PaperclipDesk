import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import type { Accent, ColorScheme, ThemePreset } from '@/lib/theme'

export const LOCAL_PROFILE_ID = 'local_embedded'

export type ConnectionMode = 'local_embedded' | 'remote_existing'
export type ConnectionHealth = 'healthy' | 'auth_required' | 'unsupported' | 'unreachable' | 'unknown'
export type DeploymentMode = 'local_trusted' | 'authenticated'
export type SessionState = 'signed_in' | 'signed_out' | 'unknown'
export type FailureReason = 'invalid_url' | 'unreachable' | 'tls_error' | 'not_paperclip' | 'unsupported_local_trusted' | 'auth_not_ready'

export interface ConnectionProfile {
  id: string
  name: string
  mode: ConnectionMode
  remoteUrl?: string
  allowInsecureHttp?: boolean
  createdAt: string
  updatedAt: string
  lastConnectedAt?: string
  lastHealth?: ConnectionHealth
  lastDeploymentMode: DeploymentMode | null
  lastSessionState?: SessionState
}

export interface ConnectionState {
  activeProfileId: string | null
  /// The connections opened at launch without asking; none shows the connection page.
  startupProfileIds: string[]
  localProfileName: string
  localLastConnectedAt?: string
  localLastHealth?: ConnectionHealth
}

export interface RemotePreflightResult {
  ok: boolean
  normalizedUrl: string
  origin: string
  insecureTransport: boolean
  paperclipDetected: boolean
  deploymentMode: DeploymentMode | null
  deploymentExposure: 'private' | 'public' | null
  authReady: boolean | null
  bootstrapStatus: 'ready' | 'bootstrap_pending' | null
  bootstrapInviteActive: boolean | null
  sessionState: SessionState
  version: string | null
  reason?: FailureReason
  warning?: string
  detail?: string
}

/// A connection that is open, in front or behind it.
export interface OpenConnection {
  key: string
  profileId: string | null
  name: string
  local: boolean
  front: boolean
}

export type LauncherView = 'chooser' | 'local-boot' | 'connecting' | 'error'
export type LauncherPage = 'paperclip' | 'connect' | 'connections' | 'logs' | 'appearance' | 'system' | 'server'
export type BootStep = 'init' | 'database' | 'server' | 'ready'

export interface BootStatus {
  step: BootStep
  detail: string
  progress: number
}

/// Everything the window shows about connections; the app sends a new one whenever something changes.
export interface Snapshot {
  view: LauncherView
  /// Changes whenever the app itself switched the view, e.g. to the boot progress.
  viewSeq: number
  page: LauncherPage
  label: string | null
  url: string | null
  bootStatus: BootStatus | null
  connectionError: { title: string; detail: string } | null
  hasCurrentConnection: boolean
  currentConnectionName: string | null
  currentProfileId: string | null
  /// In the order they were opened.
  openConnections: OpenConnection[]
  state: ConnectionState
  profiles: ConnectionProfile[]
  localServerVersion: string | null
  /// False until the first local start has downloaded the server.
  localServerInstalled: boolean
  /// The language the app speaks, after 'System' has been resolved.
  language: string
}

export interface RemoteConnect {
  profileId?: string
  remoteUrl: string
  displayName?: string
  saveProfile: boolean
  allowInsecureHttp: boolean
}

export interface RemoteProfilePayload {
  profileId?: string
  name?: string
  remoteUrl: string
  allowInsecureHttp: boolean
}

export interface Settings {
  color_scheme: ColorScheme
  theme: ThemePreset
  accent: Accent
  show_logs: boolean
  /// Empties the app's and the server's logs when the app exits.
  clear_logs_on_exit: boolean
  check_updates_on_start: boolean
  /// A language code, or 'System' for the language Windows runs in.
  language: string
}

/// What every settings page gets from the shell.
export interface PageProps {
  settings: Settings
  saving: boolean
  save: (next: Settings, success: string) => Promise<void>
}

export interface LogFile {
  name: string
  size: number
  modified_ms: number
}

export interface LogTail {
  files: LogFile[]
  file: string | null
  lines: string[]
}

export interface About {
  version: string
  server_version: string | null
  user_data: string
  paperclip_home: string
}

export type ConfigFile = 'config' | 'env'

/// The contents of the server's configuration files; a missing file reads as empty.
export type ServerConfig = Record<ConfigFile, string>

export interface ServerInfo {
  version: string | null
  /// The version this build of the app runs.
  pinned_version: string
  can_reinstall: boolean
  running: boolean
  instance_dir: string
}

/// Commands reject with the message as a plain string.
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}

export const launcherState = () => call<Snapshot>('launcher_state')
export const setOpenAtStart = (profileId: string, open: boolean) => call<Snapshot>('set_open_at_start', { profileId, open })
export const activateConnection = (key: string) => call<void>('activate_connection', { key })
export const closeConnection = (key: string) => call<void>('close_connection', { key })
export const saveRemoteProfile = (payload: RemoteProfilePayload) => call<Snapshot>('save_remote_profile', { payload })
export const duplicateProfile = (profileId: string) => call<Snapshot>('duplicate_profile', { profileId })
export const deleteProfile = (profileId: string) => call<Snapshot>('delete_profile', { profileId })
export const verifyRemote = (remoteUrl: string) => call<RemotePreflightResult>('verify_remote', { remoteUrl })
export const cancelConnect = () => call<void>('cancel_connect')
export const connectLocal = () => call<void>('connect_local')
export const connectRemote = (payload: RemoteConnect) => call<void>('connect_remote', { payload })
export const connectSavedProfile = (profileId: string) => call<void>('connect_saved_profile', { profileId })
export const returnToCurrentSession = () => call<boolean>('return_to_current_session')
export const getSettings = () => call<Settings>('get_settings')
export const updateSettings = (settings: Settings) => call<Settings>('update_settings', { settings })
export const getLog = (file: string | null, lines: number) => call<LogTail>('get_log', { file, lines })
export const clearLog = (file: string) => call<void>('clear_log', { file })
export const openDataFolder = () => call<void>('open_data_folder')
export const openProjectLink = (link: 'repository' | 'report_issue') => call<void>('open_project_link', { link })
export const showPage = (page: LauncherPage) => call<void>('show_page', { page })
export const getAbout = () => call<About>('get_about')
export const getServerInfo = () => call<ServerInfo>('server_info')
export const restartLocalServer = () => call<void>('restart_local_server')
export const reinstallServer = () => call<void>('reinstall_server')
export const readServerConfig = () => call<ServerConfig>('read_server_config')
export const writeServerConfig = (file: ConfigFile, content: string) => call<void>('write_server_config', { file, content })
/// Resolves to where the old data was moved, or null without a backup.
export const resetLocalServer = (keepConfig: boolean, backup: boolean) => call<string | null>('reset_local_server', { keepConfig, backup })
/// Both resolve to null when the user cancelled the file dialog.
export const exportSettings = () => call<string | null>('export_settings')
export const importSettings = () => call<Settings | null>('import_settings')

export function onLauncherState(handler: (snapshot: Snapshot) => void): () => void {
  const unlisten = listen<Snapshot>('launcher:state', (event) => handler(event.payload))
  return () => void unlisten.then((stop) => stop())
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
