import { ChevronRight } from 'lucide-react'

import type { TemplateAgent } from '@/lib/client'
import { t } from '@/i18n'
import { type Reports, reportsOf } from './hierarchy'

function Node({ agent, reports, depth, open, above }: { agent: TemplateAgent; reports: Reports; depth: number; open: number; above: ReadonlySet<string> }) {
  const below = above.has(agent.slug) ? [] : (reports.get(agent.slug) ?? [])
  const label = (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="truncate font-medium">{agent.name}</span>
      {agent.title && agent.title.toLocaleLowerCase() !== agent.name.toLocaleLowerCase() && <span className="truncate text-xs text-muted-foreground">{agent.title}</span>}
      {agent.skills.length > 0 && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{agent.skills.length === 1 ? t('1 Skill') : t('{count} Skills', { count: agent.skills.length })}</span>}
    </span>
  )
  if (below.length === 0) return <li className="py-0.5 pl-5">{label}</li>
  const inside = new Set(above).add(agent.slug)
  return (
    <li>
      <details open={depth < open}>
        <summary className="flex cursor-pointer list-none items-center gap-1 rounded py-0.5 hover:bg-accent/60 [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform [details[open]>summary>&]:rotate-90" />
          {label}
        </summary>
        <ul className="ml-2 border-l pl-2">
          {below.map((report) => (
            <Node key={report.slug} agent={report} reports={reports} depth={depth + 1} open={open} above={inside} />
          ))}
        </ul>
      </details>
    </li>
  )
}

/// The agents as a tree from the top down; levels from `open` on start folded, so a company of a hundred agents stays readable.
export default function OrgChart({ agents, open = 2 }: { agents: TemplateAgent[]; open?: number }) {
  const reports = reportsOf(agents)
  return (
    <ul className="flex flex-col text-sm">
      {(reports.get(null) ?? []).map((agent) => (
        <Node key={agent.slug} agent={agent} reports={reports} depth={0} open={open} above={new Set()} />
      ))}
    </ul>
  )
}
