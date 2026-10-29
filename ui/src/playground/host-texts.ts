// The host's own texts, read from its translation files, so the playground's menus speak every language the app does.
const sources = import.meta.glob('../../../src-tauri/src/i18n/*.rs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const catalogues: Record<string, string[]> = Object.fromEntries(
  Object.entries(sources)
    .filter(([file]) => !file.endsWith('/mod.rs'))
    .map(([file, source]) => [
      file.replace(/^.*\/(\w+)\.rs$/, '$1'),
      source
        .split('\n')
        .map((line) => /^\s*("(?:[^"\\]|\\.)*"),\s*$/.exec(line)?.[1])
        .filter((quoted): quoted is string => quoted !== undefined)
        .map((quoted) => JSON.parse(quoted) as string),
    ]),
)

/// A text of the host in `language`, its `{}` filled in order; a text the host does not know stays German, as the host's own `t` would fail a test.
export function hostText(language: string, german: string, ...values: string[]) {
  const index = catalogues.de.indexOf(german)
  if (index < 0) console.warn(`[playground] the host has no text "${german}"`)
  const text = (index >= 0 && catalogues[language]?.[index]) || german
  return values.reduce((filled, value) => filled.replace('{}', value), text)
}
