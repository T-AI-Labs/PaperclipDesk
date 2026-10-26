import type { ReactNode } from 'react'
import { CircleAlert, LoaderCircle, Monitor } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { type Snapshot, connectLocal, errorMessage } from '@/lib/client'
import { toast } from '@/lib/notifications'
import { t } from '@/i18n'

/// Shows `children` once a Paperclip is open; before that, the start of the local server, so a company planned on the
/// welcome page can still be created from here.
export default function NeedsPaperclip({ snapshot, children }: { snapshot: Snapshot; children?: ReactNode }) {
  if (snapshot.hasCurrentConnection) return children ?? null
  const busy = snapshot.view === 'local-boot' || snapshot.view === 'connecting'
  const progress = snapshot.bootStatus?.progress ?? 0

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed p-4">
      <p className="text-sm font-medium">{t('Dafür braucht es ein laufendes Paperclip')}</p>
      <p className="text-xs text-muted-foreground">{t('Bis hierher ging alles ohne Server. Paperclip prüft die Firma und legt sie an; der lokale Server startet dafür jetzt, dein Entwurf bleibt erhalten.')}</p>
      {busy ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <span className="flex items-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin" /> {snapshot.bootStatus?.detail || t('Verbindet …')}
          </span>
          <div className="h-1 overflow-hidden rounded-full bg-primary/15" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.max(progress, 2)}%` }} />
          </div>
        </div>
      ) : (
        <>
          {snapshot.connectionError && (
            <p className="flex items-start gap-2 text-xs text-destructive">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {snapshot.connectionError.title}: {snapshot.connectionError.detail}
            </p>
          )}
          <Button className="self-start" disabled={snapshot.localServerVersion === null} onClick={() => connectLocal().catch((e: unknown) => toast.error(errorMessage(e)))}>
            <Monitor /> {t('Lokalen Server starten')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('Oder verbinde oben rechts ein Remote; die Firma entsteht dann dort.')}</p>
        </>
      )}
    </div>
  )
}
