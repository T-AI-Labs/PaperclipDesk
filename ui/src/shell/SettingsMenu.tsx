import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Check, Minus, Plus, Search, Settings as Gear } from 'lucide-react'
import { toast } from '@/lib/notifications'

import {
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from '@/components/ui/menubar'
import { type PageProps, errorMessage, exportSettings, importSettings, menuAction } from '@/lib/client'
import { ACCENTS, type ColorScheme, THEMES, type ThemePreset } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { LANGUAGES, t } from '@/i18n'

export type Panel = 'server' | 'remotes' | 'updates' | 'templates' | 'shortcuts'

interface Props extends PageProps {
  zoomPercent: number
  connected: boolean
  onPanel: (panel: Panel) => void
}

/// A row of the menu and the words the search finds it by.
interface Row {
  words: string[]
  node: ReactNode
}

const SCHEMES: { value: ColorScheme; label: 'System' | 'Hell' | 'Dunkel' }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Hell' },
  { value: 'dark', label: 'Dunkel' },
]

const failed = (e: unknown) => toast.error(errorMessage(e))
// A control inside a row must not close the menu, nor hand its click to the row.
const keepOpen = (event: Event) => event.preventDefault()

/// The key of an entry's action at the right of the entry, if it has one.
export function ShortcutHint({ id, shortcuts }: { id: string; shortcuts: Record<string, string> }) {
  return shortcuts[id] ? <MenubarShortcut>{shortcuts[id]}</MenubarShortcut> : null
}

function Segment({ active, disabled, onClick, label, children }: { active?: boolean; disabled?: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn('grid h-6 min-w-6 place-items-center rounded-md border px-1.5 text-xs disabled:opacity-50', active ? 'border-transparent bg-primary text-primary-foreground' : 'hover:bg-accent')}
    >
      {children}
    </button>
  )
}

function ControlRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 pr-1.5 pl-7 text-sm">
      <span>{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}

function Content({ settings, saving, save, zoomPercent, connected, onPanel }: Props) {
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  // The menu focuses itself once it is open; the search field takes the focus back, so typing searches right away.
  useEffect(() => {
    const frame = requestAnimationFrame(() => search.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])
  const set = (next: Partial<typeof settings>) => void save({ ...settings, ...next }, '')
  const command = (id: string) => () => void menuAction(id).catch(failed)

  const sections: { title: string; rows: Row[] }[] = [
    {
      title: t('Ansicht'),
      rows: [
        {
          words: [t('Zoom'), t('Vergrößern'), t('Verkleinern'), t('Zoom zurücksetzen')],
          node: (
            <ControlRow key="zoom" label={t('Zoom')}>
              <Segment label={t('Verkleinern')} disabled={!connected} onClick={command('view.zoom_out')}>
                <Minus className="size-3" />
              </Segment>
              <Segment label={t('Zoom zurücksetzen')} disabled={!connected} onClick={command('view.zoom_reset')}>
                {zoomPercent} %
              </Segment>
              <Segment label={t('Vergrößern')} disabled={!connected} onClick={command('view.zoom_in')}>
                <Plus className="size-3" />
              </Segment>
            </ControlRow>
          ),
        },
        { words: [t('Neu laden')], node: <MenubarItem inset key="reload" onSelect={command('view.reload')}>{t('Neu laden')}</MenubarItem> },
        {
          words: [t('Vollbild')],
          node: (
            <MenubarItem inset key="fullscreen" onSelect={command('view.fullscreen')}>
              {t('Vollbild')}
              <ShortcutHint id="view.fullscreen" shortcuts={settings.shortcuts} />
            </MenubarItem>
          ),
        },
        {
          words: [t('Menüleiste anzeigen')],
          node: (
            <MenubarCheckboxItem key="menu-bar" checked={settings.show_menu_bar} disabled={saving} onCheckedChange={(checked) => set({ show_menu_bar: checked })}>
              {t('Menüleiste anzeigen')}
              <ShortcutHint id="view.menu_bar" shortcuts={settings.shortcuts} />
            </MenubarCheckboxItem>
          ),
        },
        {
          words: [t('Adressleiste anzeigen')],
          node: (
            <MenubarCheckboxItem key="address-bar" checked={settings.show_address_bar} disabled={saving} onSelect={keepOpen} onCheckedChange={(checked) => set({ show_address_bar: checked })}>
              {t('Adressleiste anzeigen')}
            </MenubarCheckboxItem>
          ),
        },
      ],
    },
    {
      title: t('Darstellung'),
      rows: [
        {
          words: [t('Farbschema'), ...SCHEMES.map((scheme) => t(scheme.label))],
          node: (
            <ControlRow key="scheme" label={t('Farbschema')}>
              {SCHEMES.map((scheme) => (
                <Segment key={scheme.value} label={t(scheme.label)} active={settings.color_scheme === scheme.value} disabled={saving} onClick={() => set({ color_scheme: scheme.value })}>
                  {t(scheme.label)}
                </Segment>
              ))}
            </ControlRow>
          ),
        },
        {
          words: [t('Farbe'), ...ACCENTS.map((accent) => t(accent.label))],
          node: (
            <ControlRow key="accent" label={t('Farbe')}>
              {ACCENTS.map((accent) => (
                <button
                  key={accent.value}
                  type="button"
                  title={t(accent.label)}
                  aria-label={t(accent.label)}
                  aria-pressed={settings.accent === accent.value}
                  disabled={saving}
                  onClick={() => set({ accent: accent.value })}
                  className={cn('grid size-4 place-items-center rounded-full border ring-offset-1 ring-offset-popover', settings.accent === accent.value && 'ring-2 ring-foreground')}
                  style={{ background: accent.swatch }}
                >
                  {settings.accent === accent.value && <Check className="size-2.5 text-white drop-shadow-[0_0_2px_rgb(0_0_0/0.9)]" />}
                </button>
              ))}
            </ControlRow>
          ),
        },
        {
          words: [t('Design'), ...THEMES.map((theme) => theme.label)],
          node: (
            <MenubarSub key="theme">
              <MenubarSubTrigger inset>
                {t('Design')}
                <span className="ml-auto pl-3 text-xs text-muted-foreground">{THEMES.find((theme) => theme.value === settings.theme)?.label}</span>
              </MenubarSubTrigger>
              <MenubarSubContent className="max-h-[70vh] overflow-y-auto">
                <MenubarRadioGroup value={settings.theme} onValueChange={(theme) => set({ theme: theme as ThemePreset })}>
                  {THEMES.map((theme) => (
                    <MenubarRadioItem key={theme.value} value={theme.value} disabled={saving} onSelect={keepOpen}>
                      {theme.label}
                    </MenubarRadioItem>
                  ))}
                </MenubarRadioGroup>
              </MenubarSubContent>
            </MenubarSub>
          ),
        },
      ],
    },
    {
      title: t('App'),
      rows: [
        {
          words: [t('Sprache'), t('Wie Windows'), ...LANGUAGES.map((language) => language.label)],
          node: (
            <MenubarSub key="language">
              <MenubarSubTrigger inset>
                {t('Sprache')}
                <span className="ml-auto pl-3 text-xs text-muted-foreground">{LANGUAGES.find((language) => language.id === settings.language)?.label ?? t('Wie Windows')}</span>
              </MenubarSubTrigger>
              <MenubarSubContent className="max-h-[70vh] overflow-y-auto">
                <MenubarRadioGroup value={settings.language} onValueChange={(language) => set({ language })}>
                  <MenubarRadioItem value="System" disabled={saving}>
                    {t('Wie Windows')}
                  </MenubarRadioItem>
                  {LANGUAGES.map((language) => (
                    <MenubarRadioItem key={language.id} value={language.id} disabled={saving}>
                      {language.label}
                    </MenubarRadioItem>
                  ))}
                </MenubarRadioGroup>
              </MenubarSubContent>
            </MenubarSub>
          ),
        },
        {
          words: [t('Beim Start nach Updates suchen'), t('Updates')],
          node: (
            <MenubarCheckboxItem key="updates" checked={settings.check_updates_on_start} disabled={saving} onSelect={keepOpen} onCheckedChange={(checked) => set({ check_updates_on_start: checked })}>
              {t('Beim Start nach Updates suchen')}
            </MenubarCheckboxItem>
          ),
        },
        {
          words: [t('Protokolle beim Beenden löschen')],
          node: (
            <MenubarCheckboxItem key="clear-logs" checked={settings.clear_logs_on_exit} disabled={saving} onSelect={keepOpen} onCheckedChange={(checked) => set({ clear_logs_on_exit: checked })}>
              {t('Protokolle beim Beenden löschen')}
            </MenubarCheckboxItem>
          ),
        },
        {
          words: [t('Willkommensseite bei jedem Start')],
          node: (
            <MenubarCheckboxItem key="welcome" checked={settings.show_welcome} disabled={saving} onSelect={keepOpen} onCheckedChange={(checked) => set({ show_welcome: checked })}>
              {t('Willkommensseite bei jedem Start')}
            </MenubarCheckboxItem>
          ),
        },
        {
          words: [t('Fehler als Meldung anzeigen'), t('Protokoll')],
          node: (
            <MenubarCheckboxItem key="error-popups" checked={settings.error_popups} disabled={saving} onSelect={keepOpen} onCheckedChange={(checked) => set({ error_popups: checked })}>
              {t('Fehler als Meldung anzeigen')}
            </MenubarCheckboxItem>
          ),
        },
        {
          words: [t('Symbol im Infobereich')],
          node: (
            <MenubarCheckboxItem key="tray" checked={settings.show_tray} disabled={saving} onSelect={keepOpen} onCheckedChange={(checked) => set({ show_tray: checked })}>
              {t('Symbol im Infobereich')}
            </MenubarCheckboxItem>
          ),
        },
        {
          words: [t('Einstellungen sichern'), t('Exportieren'), t('Importieren')],
          node: (
            <MenubarSub key="backup">
              <MenubarSubTrigger inset>{t('Einstellungen sichern')}</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem onSelect={() => void exportSettings().then((path) => path && toast.success(t('Exportiert nach {path}', { path }))).catch(failed)}>{t('Exportieren')}</MenubarItem>
                <MenubarItem disabled={saving} onSelect={() => void importSettings().then((imported) => imported && save(imported, t('Einstellungen importiert'))).catch(failed)}>
                  {t('Importieren')}
                </MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
          ),
        },
      ],
    },
    {
      title: '',
      rows: [
        { words: [t('Lokaler Server …'), t('Paperclip-Server')], node: <MenubarItem inset key="server" onSelect={() => onPanel('server')}>{t('Lokaler Server …')}</MenubarItem> },
        { words: [t('Tastenkürzel …'), t('Tastenkürzel')], node: <MenubarItem inset key="shortcuts" onSelect={() => onPanel('shortcuts')}>{t('Tastenkürzel …')}</MenubarItem> },
        { words: [t('Beenden')], node: <MenubarItem inset key="quit" variant="destructive" onSelect={command('app.quit')}>{t('Beenden')}</MenubarItem> },
      ],
    },
  ]

  const needle = query.trim().toLocaleLowerCase()
  const visible = sections
    .map((section) => ({ ...section, rows: section.rows.filter((row) => needle === '' || row.words.some((word) => word.toLocaleLowerCase().includes(needle))) }))
    .filter((section) => section.rows.length > 0)

  return (
    <>
      <div className="mb-1 flex items-center gap-2 rounded-md border px-2 py-1 focus-within:ring-2 focus-within:ring-ring/50">
        <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          // The menu jumps to an entry by its first letter; typed text belongs to the search.
          onKeyDown={(event) => event.key !== 'Escape' && event.stopPropagation()}
          placeholder={t('Einstellung suchen …')}
          aria-label={t('Einstellung suchen …')}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {visible.map((section, index) => (
        <div key={section.title || index}>
          {index > 0 && <MenubarSeparator />}
          {section.title && <MenubarLabel inset className="text-xs font-normal text-muted-foreground">{section.title}</MenubarLabel>}
          {section.rows.map((row) => row.node)}
        </div>
      ))}
      {visible.length === 0 && <p className="py-2 pr-1.5 pl-7 text-sm text-muted-foreground">{t('Keine Treffer')}</p>}
    </>
  )
}

/// The gear at the right of the menu bar: the app's own settings, the view of Paperclip and the way out.
export default function SettingsMenu(props: Props) {
  return (
    <MenubarMenu value="settings">
      <MenubarTrigger aria-label={t('Einstellungen')} title={t('Einstellungen')} className="rounded-md px-2 py-1 hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent">
        <Gear className="size-4" />
      </MenubarTrigger>
      <MenubarContent align="end" sideOffset={5} className="w-80">
        <Content {...props} />
      </MenubarContent>
    </MenubarMenu>
  )
}
