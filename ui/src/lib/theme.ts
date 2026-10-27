import type { Message } from '@/i18n'
import { useEffect } from 'react'

export type ColorScheme = 'system' | 'light' | 'dark'

export type ThemePreset =
  | 'neutral'
  | 'zinc'
  | 'slate'
  | 'stone'
  | 'vercel'
  | 'linear'
  | 'github'
  | 'nord'
  | 'tokyonight'
  | 'catppuccin'
  | 'brutal' | 'terminal' | 'dracula' | 'fluent' | 'macos' | 'xp' | 'win95' | 'material' | 'candy' | 'synthwave' | 'glass'
  | 'ink' | 'graphite' | 'polar' | 'midnight' | 'desk' | 'studio' | 'steel' | 'arctic' | 'carbon' | 'klar'

export type Accent = 'default' | 'mono' | 'blue' | 'navy' | 'sky' | 'green' | 'orange' | 'teal'

/// From everyday to playful, the order the Design submenu shows them in, without categories.
export const THEMES: { value: ThemePreset; label: string; description: string }[] = [
  { value: 'klar', label: 'Klar', description: 'Reines Weiß, schwarze Knöpfe, runde Ecken' },
  { value: 'vercel', label: 'Vercel', description: 'Reines Schwarz-Weiß, scharfe Ecken' },
  { value: 'fluent', label: 'WinUI 3', description: 'Wie Windows 11, mit bunten Symbolen – Standard' },
  { value: 'neutral', label: 'Neutral', description: 'shadcn, schwarz-weiß' },
  { value: 'macos', label: 'macOS', description: 'Wie auf dem Mac' },
  { value: 'ink', label: 'Tinte', description: 'Weißes Papier, Tintenblau' },
  { value: 'graphite', label: 'Graphit', description: 'Hellgrau mit schwarzen Knöpfen' },
  { value: 'polar', label: 'Polar', description: 'Kühles Weiß, weiche Karten wie am Mac' },
  { value: 'studio', label: 'Studio', description: 'Dunkleres Grau der Mac-Profi-Apps' },
  { value: 'desk', label: 'Büro', description: 'Wie ein Office-Programm, Segoe UI' },
  { value: 'arctic', label: 'Eis', description: 'Weiß und Eisblau, runde Ecken' },
  { value: 'steel', label: 'Stahl', description: 'Blaugrau mit Stahlblau' },
  { value: 'midnight', label: 'Mitternacht', description: 'Hell mit dunkelblauer Seitenleiste' },
  { value: 'carbon', label: 'Carbon', description: 'Eckig, graue Ebenen, schwarze Leiste' },
  { value: 'material', label: 'Material 3', description: 'Google: ruhige getönte Flächen, Pillen-Auswahl' },
  { value: 'github', label: 'GitHub', description: 'Primer mit grünen Knöpfen' },
  { value: 'linear', label: 'Linear', description: 'Ruhiges Grau mit Indigo' },
  { value: 'zinc', label: 'Zinc', description: 'Kühles Grau, dunkle Seitenleiste' },
  { value: 'slate', label: 'Slate', description: 'Blaugraue Flächen, runde Ecken' },
  { value: 'stone', label: 'Stone', description: 'Warmes Papier, Serifen-Titel' },
  { value: 'nord', label: 'Nord', description: 'Arktisches Blaugrau' },
  { value: 'catppuccin', label: 'Catppuccin', description: 'Pastell, Latte und Mocha' },
  { value: 'dracula', label: 'Dracula', description: 'Violett und Pink' },
  { value: 'tokyonight', label: 'Tokyo Night', description: 'Tiefblau mit Neon' },
  { value: 'xp', label: 'Windows XP', description: 'Luna-Blau und Tahoma' },
  { value: 'win95', label: 'Windows 95', description: 'Grau, kantig, 3D-Rahmen' },
  { value: 'terminal', label: 'Terminal', description: 'Grün wie ein Bildschirm, Monospace' },
  { value: 'brutal', label: 'Brutal', description: 'Schwarz-weiß, harte Kanten' },
  { value: 'glass', label: 'Glas', description: 'Durchscheinend über Farbverlauf' },
  { value: 'candy', label: 'Bonbon', description: 'Bunt und verspielt' },
  { value: 'synthwave', label: 'Synthwave', description: 'Neon über Sonnenuntergang' },
]

export const ACCENTS: { value: Accent; label: Message; swatch: string }[] = [
  { value: 'default', label: 'Farben des Designs', swatch: 'conic-gradient(oklch(0.55 0.19 258), oklch(0.4 0.15 265), oklch(0.72 0.13 230), oklch(0.64 0.19 45), oklch(0.56 0.15 152), oklch(0.57 0.11 192), oklch(0.55 0.19 258))' },
  { value: 'mono', label: 'Schwarz-Weiß', swatch: 'linear-gradient(135deg, oklch(0.18 0 0) 50%, oklch(0.97 0 0) 50%)' },
  { value: 'blue', label: 'Blau', swatch: 'oklch(0.55 0.19 258)' },
  { value: 'navy', label: 'Dunkelblau', swatch: 'oklch(0.4 0.15 265)' },
  { value: 'sky', label: 'Hellblau', swatch: 'oklch(0.72 0.13 230)' },
  { value: 'orange', label: 'Orange', swatch: 'oklch(0.64 0.19 45)' },
  { value: 'green', label: 'Grün', swatch: 'oklch(0.56 0.15 152)' },
  { value: 'teal', label: 'Türkis', swatch: 'oklch(0.57 0.11 192)' },
]

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

function applyScheme(scheme: ColorScheme) {
  const dark = scheme === 'dark' || (scheme === 'system' && darkQuery.matches)
  document.documentElement.classList.toggle('dark', dark)
}

/// Applies scheme, design and accent to <html> and follows OS changes while the scheme is 'system'.
export function useApplyColorScheme(scheme: ColorScheme, theme: ThemePreset = 'fluent', accent: Accent = 'default') {
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.accent = accent
  }, [theme, accent])

  useEffect(() => {
    applyScheme(scheme)
    if (scheme !== 'system') return
    const onChange = () => applyScheme('system')
    darkQuery.addEventListener('change', onChange)
    return () => darkQuery.removeEventListener('change', onChange)
  }, [scheme])
}
