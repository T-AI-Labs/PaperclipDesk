import type { LucideIcon } from 'lucide-react'

import { toneStyle, type Tone } from '@/lib/tones'
import { cn } from '@/lib/utils'

const SIZES = {
  sm: { tile: 'size-6 rounded-md', icon: 'size-3.5' },
  md: { tile: 'size-7 rounded-lg', icon: 'size-4' },
  lg: { tile: 'size-9 rounded-xl', icon: 'size-[18px]' },
}

/// A page's icon on a small gradient tile in the page's shade of the design's primary colour, with a light top edge.
export function IconTile({ icon: Icon, tone, size = 'md', className }: { icon: LucideIcon; tone: Tone; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      aria-hidden
      style={toneStyle(tone)}
      className={cn(
        'tone-tile relative grid shrink-0 place-items-center ring-1 ring-black/5 ring-inset dark:ring-white/10',
        'before:pointer-events-none before:absolute before:inset-px before:rounded-[inherit] before:bg-gradient-to-b before:from-white/30 before:to-transparent before:to-60%',
        SIZES[size].tile,
        className,
      )}
    >
      <Icon className={cn('relative', SIZES[size].icon)} strokeWidth={2.25} />
    </span>
  )
}
