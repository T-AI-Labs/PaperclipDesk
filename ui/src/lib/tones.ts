import type { CSSProperties } from 'react'

/// How far a page's colour turns away from the design's primary colour, in degrees of hue, in the colourful designs
/// (index.css: --tone-spread). The tiles are drawn from `--primary` (.tone-tile, .tone-soft, .tone-bar), so they belong
/// to every design and accent; platform designs show plain glyphs as the platform does.
export type Tone = number

export function toneStyle(tone: Tone): CSSProperties {
  return { '--tone': tone } as CSSProperties
}
