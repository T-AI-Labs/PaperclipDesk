import { LoaderCircle } from 'lucide-react'

import { AppMark } from '@/components/app-mark'
import { t } from '@/i18n'

/// Shown until the window has its first state; index.html shows the same before React runs.
export default function LoadingPanel({ detail }: { detail: string }) {
  return (
    <div className="grid h-screen place-items-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-4 text-center">
        <AppMark className="size-14" />
        <div className="flex flex-col gap-1">
          <p className="font-heading text-lg font-semibold tracking-tight">{t('PaperclipDesk startet …')}</p>
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> {detail}
          </p>
        </div>
      </div>
    </div>
  )
}
