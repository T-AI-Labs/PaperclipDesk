import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Copy, FolderOpen, Pause, Play, Search, Trash2 } from 'lucide-react'
import { toast } from '@/lib/notifications'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type LogTail, clearLog, errorMessage, getLog, openDataFolder } from '@/lib/client'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

const POLL_MS = 2000
const LINES = [500, 2000, 10000]

type Level = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE'
type MinLevel = 'all' | 'info' | 'warn' | 'error'

const RANK: Record<Level, number> = { ERROR: 4, WARN: 3, INFO: 2, DEBUG: 1, TRACE: 0 }
const MIN_RANK: Record<MinLevel, number> = { all: 0, info: 2, warn: 3, error: 4 }
const LEVEL_STYLE: Record<Level, string> = {
  ERROR: 'bg-destructive/15 text-destructive',
  WARN: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  INFO: 'bg-sky-500/12 text-sky-700 dark:text-sky-400',
  DEBUG: 'bg-muted text-muted-foreground',
  TRACE: 'bg-muted text-muted-foreground',
}

interface Entry {
  raw: string
  time: Date | null
  level: Level | null
  target: string | null
  message: string
  /// A server line's message without its further fields, and those fields; null for every other line.
  json: { message: string; fields: Record<string, unknown> } | null
}

const LINE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(ERROR|WARN|INFO|DEBUG|TRACE)\s+([\w:]+):\s?(.*)$/
// The server's banner is coloured for a terminal.
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
const SERVER_FIELDS = new Set(['level', 'time', 'pid', 'hostname', 'msg', 'service'])

function serverLevel(level: unknown): Level | null {
  if (typeof level !== 'number') return null
  return level >= 50 ? 'ERROR' : level >= 40 ? 'WARN' : level >= 30 ? 'INFO' : level >= 20 ? 'DEBUG' : 'TRACE'
}

/// The Paperclip server writes one JSON object per line: level, time, message and any number of further fields.
function parseServerLine(raw: string): Entry | null {
  if (!raw.startsWith('{"level"')) return null
  try {
    const line = JSON.parse(raw) as Record<string, unknown>
    const extra = Object.entries(line).filter(([key]) => !SERVER_FIELDS.has(key))
    const fields = extra.map(([key, value]) => ` ${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`).join('')
    const message = typeof line.msg === 'string' ? line.msg : ''
    return {
      raw,
      time: typeof line.time === 'number' ? new Date(line.time) : null,
      level: serverLevel(line.level),
      target: typeof line.service === 'string' ? line.service : 'server',
      message: `${message}${fields}`,
      json: { message, fields: Object.fromEntries(extra) },
    }
  } catch {
    return null
  }
}

function parse(raw: string): Entry {
  const server = parseServerLine(raw)
  if (server) return server
  const match = LINE.exec(raw)
  if (!match) return { raw, time: null, level: null, target: null, message: raw.replace(ANSI, ''), json: null }
  return { raw, time: new Date(match[1]), level: match[2] as Level, target: match[3], message: match[4], json: null }
}

/// Lines without a timestamp that follow each other are one entry: the server's banner, not twenty rows of it.
function group(entries: Entry[]): Entry[] {
  const plain = (entry: Entry) => entry.time === null && entry.level === null
  const grouped: Entry[] = []
  for (const entry of entries) {
    const last = grouped.at(-1)
    // The app's own "--- Server start ---" marker opens a block of its own.
    if (last && plain(last) && plain(entry) && !entry.raw.startsWith('--- ')) {
      grouped[grouped.length - 1] = { ...last, raw: `${last.raw}\n${entry.raw}`, message: `${last.message}\n${entry.message}` }
    } else {
      grouped.push(entry)
    }
  }
  return grouped
}

function stamp(time: Date) {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const clock = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}.${pad(time.getMilliseconds(), 3)}`
  return time.toDateString() === new Date().toDateString() ? clock : `${pad(time.getDate())}.${pad(time.getMonth() + 1)}. ${clock}`
}

function size(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/// `key=value` fields after the message, dimmed so the message stands out.
function Message({ text }: { text: string }) {
  const parts = text.split(/(\s[\w.]+=)/g)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="text-muted-foreground">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}

const PRETTY_KEY = 'paperclip.logs.prettyJson'

/// Indented JSON; line breaks inside strings (stack traces) become real ones, so they read as text.
function pretty(fields: Record<string, unknown>) {
  return JSON.stringify(fields, null, 2).replace(/\\n/g, '\n    ')
}

const SHORT_KEY = 'paperclip.logs.short'

/// Both options are on until the user turns them off.
function stored(key: string) {
  try {
    return localStorage.getItem(key) !== '0'
  } catch {
    return true
  }
}

function store(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // Remembering the choice is a convenience only.
  }
}

/// The local server's output and the app's own log, live.
export default function Logs() {
  const [log, setLog] = useState<LogTail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [lines, setLines] = useState(LINES[0])
  const [minLevel, setMinLevel] = useState<MinLevel>('info')
  const [query, setQuery] = useState('')
  const [live, setLive] = useState(true)
  const [prettyJson, setPrettyJson] = useState(() => stored(PRETTY_KEY))
  const [short, setShort] = useState(() => stored(SHORT_KEY))
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  const refresh = useCallback(
    () =>
      getLog(file, lines)
        .then((tail) => {
          setLog(tail)
          setError(null)
        })
        .catch((e: unknown) => setError(errorMessage(e))),
    [file, lines],
  )

  useEffect(() => {
    void refresh()
    if (!live) return
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void refresh(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [refresh, live])

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase()
    return group((log?.lines ?? []).map(parse)).filter((e) => (e.level === null ? true : RANK[e.level] >= MIN_RANK[minLevel]) && (!q || e.raw.toLowerCase().includes(q)))
  }, [log, minLevel, query])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [entries])

  function onScroll() {
    const el = scroller.current
    if (!el) return
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAtBottom(pinned.current)
  }

  function toBottom() {
    pinned.current = true
    setAtBottom(true)
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(entries.map((e) => e.raw).join('\n'))
      toast.success(t('{count} Zeilen kopiert', { count: entries.length }))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  function clear() {
    if (!log?.file) return
    clearLog(log.file)
      .then(() => {
        toast.success(t('Protokoll geleert'))
        return refresh()
      })
      .catch((e: unknown) => toast.error(errorMessage(e)))
  }

  const counts = useMemo(() => {
    const all = (log?.lines ?? []).map(parse)
    return { errors: all.filter((e) => e.level === 'ERROR').length, warnings: all.filter((e) => e.level === 'WARN').length }
  }, [log])

  return (
    <div className="flex h-[calc(100vh-9.5rem)] min-h-96 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={log?.file ?? ''} onValueChange={(value) => setFile(value)}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder={t('Keine Protokolldatei')} />
          </SelectTrigger>
          <SelectContent>
            {log?.files.map((f) => (
              <SelectItem key={f.name} value={f.name}>
                <span className="flex w-full items-center justify-between gap-3">
                  <span className="font-mono text-xs">{f.name}</span>
                  <span className="text-xs text-muted-foreground">{size(f.size)}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup type="single" variant="outline" size="sm" value={minLevel} onValueChange={(v) => v && setMinLevel(v as MinLevel)}>
          <ToggleGroupItem value="all">{t('Alles')}</ToggleGroupItem>
          <ToggleGroupItem value="info">Info</ToggleGroupItem>
          <ToggleGroupItem value="warn">
            {t('Warnungen')}{counts.warnings > 0 && <span className="ml-1 rounded bg-amber-500/20 px-1 text-[10px] tabular-nums">{counts.warnings}</span>}
          </ToggleGroupItem>
          <ToggleGroupItem value="error">
            {t('Fehler')}{counts.errors > 0 && <span className="ml-1 rounded bg-destructive/20 px-1 text-[10px] tabular-nums">{counts.errors}</span>}
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="relative min-w-44 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Filtern')} className="h-8 pl-8" />
        </div>
        <Select value={String(lines)} onValueChange={(v) => setLines(Number(v))}>
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LINES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {t('{count} Zeilen', { count: n.toLocaleString() })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs select-none">
          <input
            type="checkbox"
            className="size-3.5 accent-primary"
            checked={prettyJson}
            onChange={(event) => {
              setPrettyJson(event.target.checked)
              store(PRETTY_KEY, event.target.checked)
            }}
          />
          {t('JSON formatieren')}
        </label>
        <label className="flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs select-none">
          <input
            type="checkbox"
            className="size-3.5 accent-primary"
            checked={short}
            onChange={(event) => {
              setShort(event.target.checked)
              store(SHORT_KEY, event.target.checked)
            }}
          />
          {t('Nur erste Zeile')}
        </label>
        <Button variant={live ? 'secondary' : 'outline'} size="sm" onClick={() => setLive(!live)} title={live ? t('Live-Aktualisierung anhalten') : t('Live aktualisieren')}>
          {live ? <Pause /> : <Play />} {live ? 'Live' : t('Angehalten')}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => void copy()} title={t('Angezeigte Zeilen kopieren')} aria-label={t('Kopieren')}>
          <Copy />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={!log?.file} onClick={clear} title={t('Protokoll leeren')} aria-label={t('Protokoll leeren')}>
          <Trash2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('Datenordner öffnen')}
          aria-label={t('Datenordner öffnen')}
          onClick={() => openDataFolder().catch((e: unknown) => toast.error(errorMessage(e)))}
        >
          <FolderOpen />
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="absolute inset-0 overflow-auto rounded-xl border bg-card/70 py-2 font-mono text-xs leading-relaxed shadow-xs">
          {error && <p className="px-4 py-2 text-destructive">{error}</p>}
          {!error && entries.length === 0 && (
            <p className="px-4 py-8 text-center font-sans text-sm text-muted-foreground">{log?.file ? t('Keine Zeilen für diesen Filter.') : t('Noch kein Protokoll vorhanden.')}</p>
          )}
          {entries.map((e, i) => (
            <div key={i} className={cn('flex gap-3 px-4 py-0.5 hover:bg-muted/50', e.level === 'ERROR' && 'bg-destructive/5')}>
              {e.time && <span className="shrink-0 text-muted-foreground tabular-nums">{stamp(e.time)}</span>}
              {e.level && <span className={cn('h-fit w-12 shrink-0 rounded px-1 text-center text-[10px] font-semibold', LEVEL_STYLE[e.level])}>{e.level}</span>}
              {e.target && (
                <span className="w-28 shrink-0 truncate text-muted-foreground" title={e.target}>
                  {e.target.replace(/^paperclipdesk(::)?/, '') || 'app'}
                </span>
              )}
              {short ? (
                <span className="min-w-0 truncate" title={e.message}>
                  {prettyJson && e.json ? e.json.message : <Message text={e.message.split('\n', 1)[0]} />}
                </span>
              ) : (
                <span className="min-w-0 break-words whitespace-pre-wrap">
                  {prettyJson && e.json ? (
                    <>
                      {e.json.message}
                      {Object.keys(e.json.fields).length > 0 && <span className="block text-muted-foreground">{pretty(e.json.fields)}</span>}
                    </>
                  ) : (
                    <Message text={e.message} />
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
        {!atBottom && entries.length > 0 && (
          <Button size="sm" variant="secondary" className="absolute right-4 bottom-4 shadow-md" onClick={toBottom}>
            <ArrowDownToLine /> {t('Zum Ende')}
          </Button>
        )}
      </div>
    </div>
  )
}
