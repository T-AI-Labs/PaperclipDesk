import { type ReactNode, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, ListFilter, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

export interface Column<Row> {
  id: string
  header: string
  cell: (row: Row) => ReactNode
  /// What the column sorts by; without it the column does not sort. Null sorts last either way.
  sort?: (row: Row) => string | number | null
  /// The first click sorts the largest first, for counts and stars.
  descFirst?: boolean
  align?: 'start' | 'end'
  className?: string
}

export interface FilterOption<Row> {
  id: string
  label: string
  test: (row: Row) => boolean
}

export interface Filter<Row> {
  id: string
  label: string
  options: FilterOption<Row>[]
  /// A row must pass every chosen option instead of one of them.
  every?: boolean
  /// Choosing an option drops the one chosen before, for ranges that contain each other.
  single?: boolean
  /// The column whose header holds the filter; without one it sits in the toolbar.
  column?: string
}

export interface Sort {
  column: string
  desc: boolean
}

/// Rows drawn at once; the rest follow on request, so a long list stays quick.
const PAGE = 200

interface Props<Row> {
  rows: Row[]
  rowKey: (row: Row) => string
  columns: Column<Row>[]
  filters?: Filter<Row>[]
  /// The row's text the search looks into, in lowercase.
  text: (row: Row) => string
  searchLabel: string
  initialSort?: Sort
  /// Given, the search is the caller's, e.g. to search elsewhere with the same words.
  query?: string
  onQueryChange?: (query: string) => void
  onSubmitQuery?: () => void
  onRowClick?: (row: Row) => void
  /// Controls at the end of the toolbar.
  actions?: ReactNode
  /// Rows below the table's own, e.g. a search beyond it.
  after?: ReactNode
  className?: string
}

function compare(a: string | number | null, b: string | number | null) {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

function FilterButton<Row>({ filter, chosen, count, onToggle, onClear }: { filter: Filter<Row>; chosen: ReadonlySet<string>; count: (option: FilterOption<Row>) => number; onToggle: (option: string) => void; onClear: () => void }) {
  const badge = chosen.size > 0 && <span className="rounded-sm bg-primary px-1 text-[11px] text-primary-foreground tabular-nums">{chosen.size}</span>
  return (
    <Popover>
      <PopoverTrigger asChild>
        {filter.column ? (
          <button
            type="button"
            aria-label={t('Nach {column} filtern', { column: filter.label })}
            title={t('Nach {column} filtern', { column: filter.label })}
            className={cn('inline-flex items-center gap-0.5 rounded p-0.5 hover:bg-accent hover:text-foreground', chosen.size > 0 ? 'text-primary' : 'opacity-50 hover:opacity-100')}
          >
            <ListFilter className="size-3.5" />
            {badge}
          </button>
        ) : (
          <Button variant="outline" size="sm" className={cn('h-8 border-dashed', chosen.size > 0 && 'border-solid border-primary/60')}>
            <ListFilter /> {filter.label}
            {badge}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <ul className="flex max-h-80 flex-col overflow-y-auto">
          {filter.options.map((option) => {
            const matches = count(option)
            return (
              <li key={option.id}>
                <label className={cn('flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent', matches === 0 && !chosen.has(option.id) && 'opacity-50')}>
                  <input type="checkbox" className="size-3.5 accent-primary" checked={chosen.has(option.id)} onChange={() => onToggle(option.id)} />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{matches}</span>
                </label>
              </li>
            )
          })}
        </ul>
        {chosen.size > 0 && (
          <button type="button" onClick={onClear} className="mt-1 w-full rounded border-t px-2 py-1.5 text-center text-xs hover:bg-accent">
            {t('Filter löschen')}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

/// A table with a search, filters of chosen values in the toolbar or a column's header, and sorting by any column header.
export default function DataTable<Row>({ rows, rowKey, columns, filters = [], text, searchLabel, initialSort, query: outerQuery, onQueryChange, onSubmitQuery, onRowClick, actions, after, className }: Props<Row>) {
  const [ownQuery, setOwnQuery] = useState('')
  const query = outerQuery ?? ownQuery
  const setQuery = onQueryChange ?? setOwnQuery
  const [sort, setSort] = useState<Sort | null>(initialSort ?? null)
  const [chosen, setChosen] = useState<Record<string, ReadonlySet<string>>>({})
  const [limit, setLimit] = useState(PAGE)

  const needle = query.trim().toLocaleLowerCase()
  const passes = (row: Row, except?: string) =>
    (needle === '' || text(row).includes(needle)) &&
    filters.every((filter) => {
      const ids = chosen[filter.id]
      if (filter.id === except || !ids || ids.size === 0) return true
      const picked = filter.options.filter((option) => ids.has(option.id))
      return filter.every ? picked.every((option) => option.test(row)) : picked.some((option) => option.test(row))
    })

  const sortColumn = columns.find((column) => column.id === sort?.column)
  const shown = rows.filter((row) => passes(row))
  if (sortColumn?.sort && sort) {
    const by = sortColumn.sort
    shown.sort((a, b) => {
      const [x, y] = [by(a), by(b)]
      // Missing values stay last in both directions.
      if (x === null || y === null) return compare(x, y)
      return sort.desc ? compare(y, x) : compare(x, y)
    })
  }
  const active = filters.flatMap((filter) => filter.options.filter((option) => chosen[filter.id]?.has(option.id)).map((option) => ({ filter, option })))

  function toggle(filter: Filter<Row>, option: string) {
    setChosen((current) => {
      const next = new Set(current[filter.id])
      if (!next.delete(option)) {
        if (filter.single) next.clear()
        next.add(option)
      }
      return { ...current, [filter.id]: next }
    })
    setLimit(PAGE)
  }

  const filterButton = (filter: Filter<Row>) => (
    <FilterButton
      key={filter.id}
      filter={filter}
      chosen={chosen[filter.id] ?? new Set()}
      count={(option) => rows.filter((row) => passes(row, filter.id) && option.test(row)).length}
      onToggle={(option) => toggle(filter, option)}
      onClear={() => setChosen((current) => ({ ...current, [filter.id]: new Set() }))}
    />
  )

  function sortBy(column: Column<Row>) {
    setSort((current) => {
      if (current?.column !== column.id) return { column: column.id, desc: column.descFirst ?? false }
      // The third click returns to the order the rows came in.
      if (current.desc !== (column.descFirst ?? false)) return null
      return { column: column.id, desc: !current.desc }
    })
  }

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex h-8 min-w-56 flex-1 items-center gap-2 rounded-md border px-2.5 focus-within:ring-2 focus-within:ring-ring/50"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmitQuery?.()
          }}
        >
          <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setLimit(PAGE)
            }}
            placeholder={searchLabel}
            aria-label={searchLabel}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button type="button" aria-label={t('Suche leeren')} onClick={() => setQuery('')} className="rounded p-0.5 text-muted-foreground hover:bg-accent">
              <X className="size-3.5" />
            </button>
          )}
        </form>
        {filters.filter((filter) => !filter.column).map(filterButton)}
        <span aria-live="polite" className="ml-auto rounded-md bg-muted px-2 py-1 text-xs font-medium whitespace-nowrap tabular-nums">
          {shown.length === rows.length ? t('{count} Einträge', { count: rows.length }) : t('{shown} von {count} Einträgen', { shown: shown.length, count: rows.length })}
        </span>
        {actions}
      </div>

      {(active.length > 0 || needle !== '') && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {active.map(({ filter, option }) => (
            <span key={`${filter.id}/${option.id}`} className="flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-2">
              <span className="text-muted-foreground">{filter.label}:</span> {option.label}
              <button type="button" aria-label={t('Entfernen')} onClick={() => toggle(filter, option.id)} className="rounded-full p-0.5 hover:bg-accent">
                <X className="size-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => {
              setChosen({})
              setQuery('')
            }}
            className="rounded-full px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {t('Alles zurücksetzen')}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
            <tr>
              {columns.map((column) => {
                const sorted = sort?.column === column.id ? sort : null
                const filter = filters.find((filter) => filter.column === column.id)
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={sorted ? (sorted.desc ? 'descending' : 'ascending') : undefined}
                    className={cn('border-b px-3 py-2 text-xs font-medium whitespace-nowrap text-muted-foreground', column.align === 'end' ? 'text-right' : 'text-left', column.className)}
                  >
                    <span className={cn('inline-flex items-center gap-1', column.align === 'end' && 'flex-row-reverse')}>
                      {column.sort ? (
                        <button type="button" onClick={() => sortBy(column)} className={cn('-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground', sorted && 'text-foreground', column.align === 'end' && 'flex-row-reverse')}>
                          {column.header}
                          {sorted ? sorted.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
                        </button>
                      ) : (
                        column.header
                      )}
                      {filter && filterButton(filter)}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((row) => (
              <tr
                key={rowKey(row)}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick && (() => onRowClick(row))}
                onKeyDown={onRowClick && ((event) => event.key === 'Enter' && event.target === event.currentTarget && onRowClick(row))}
                className={cn('group align-top [&:not(:last-child)>td]:border-b', onRowClick && 'cursor-pointer outline-none hover:bg-accent/50 focus-visible:bg-accent/60')}
              >
                {columns.map((column) => (
                  <td key={column.id} className={cn('px-3 py-2', column.align === 'end' && 'text-right tabular-nums', column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {t('Keine Treffer')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {shown.length > limit && (
          <div className="flex justify-center border-t p-2">
            <Button variant="ghost" size="sm" onClick={() => setLimit((current) => current + PAGE)}>
              {t('{count} weitere anzeigen', { count: Math.min(PAGE, shown.length - limit) })}
            </Button>
          </div>
        )}
        {after}
      </div>
    </div>
  )
}
