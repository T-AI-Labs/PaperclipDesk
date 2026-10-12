import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

interface UpdateOffer {
  updateAvailable: boolean
  version: string | null
  notes: string | null
}

/// What the app knows about a newer version: found at start-up, shown in the header, installed from the System page.
export interface Updater {
  available: boolean
  version: string
  /// Markdown, straight out of `latest.json`.
  notes: string
  checking: boolean
  installing: boolean
  /// Undefined while the size is unknown.
  percent: number | undefined
  /// Rejects when the feed cannot be reached, so a check the user asked for can say so.
  check: () => Promise<boolean>
  /// Resolves only if it fails: a successful install replaces the process.
  install: () => Promise<void>
}

export function useUpdater(): Updater {
  const [offer, setOffer] = useState<UpdateOffer>({ updateAvailable: false, version: null, notes: null })
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [percent, setPercent] = useState<number | undefined>(undefined)

  const check = useCallback(async () => {
    setChecking(true)
    try {
      const result = await invoke<UpdateOffer>('check_for_updates')
      setOffer(result)
      return result.updateAvailable
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      setChecking(false)
    }
  }, [])

  const install = useCallback(async () => {
    setInstalling(true)
    setPercent(undefined)
    try {
      await invoke('install_update')
    } catch (error) {
      setInstalling(false)
      throw error instanceof Error ? error : new Error(String(error))
    }
  }, [])

  useEffect(() => {
    // Being offline at start-up is an ordinary state and not worth a message.
    check().catch(() => undefined)
    const unlisten = listen<{ downloaded: number; contentLength: number | null }>('updater:progress', ({ payload }) =>
      setPercent(payload.contentLength ? Math.min(100, Math.round((payload.downloaded / payload.contentLength) * 100)) : undefined),
    )
    return () => void unlisten.then((stop) => stop())
  }, [check])

  return { available: offer.updateAvailable, version: offer.version ?? '', notes: offer.notes ?? '', checking, installing, percent, check, install }
}
