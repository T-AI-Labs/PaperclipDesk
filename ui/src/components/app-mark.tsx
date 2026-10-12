import { cn } from '@/lib/utils'

/// The app icon from public/favicon.svg, so window, taskbar and pages show the same mark.
export function AppMark({ className }: { className?: string }) {
  return <img src="/favicon.svg" alt="" aria-hidden draggable={false} className={cn('select-none', className)} />
}
