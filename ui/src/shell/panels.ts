import type { Panel } from '@/shell/SettingsMenu'

/// Entries and shortcuts that open a panel of the shell; the host names them, the shell handles them.
export const SHELL_PANELS: Record<string, Panel> = {
  'shell.updates': 'updates',
  'shell.connections': 'remotes',
  'shell.templates': 'templates',
  'shell.server': 'server',
  'shell.shortcuts': 'shortcuts',
}
