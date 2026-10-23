import type { TemplateAgent } from '@/lib/client'

export type Reports = Map<string | null, TemplateAgent[]>

/// Who reports to whom. An agent whose boss is missing, or who sits in a loop, goes to the top rather than getting lost.
export function reportsOf(agents: TemplateAgent[]): Reports {
  const known = new Set(agents.map((agent) => agent.slug))
  const reports: Reports = new Map()
  for (const agent of agents) {
    const boss = agent.reportsTo && agent.reportsTo !== agent.slug && known.has(agent.reportsTo) ? agent.reportsTo : null
    reports.set(boss, [...(reports.get(boss) ?? []), agent])
  }
  const reached = new Set<string>()
  const visit = (slug: string) => {
    if (reached.has(slug)) return
    reached.add(slug)
    for (const report of reports.get(slug) ?? []) visit(report.slug)
  }
  for (const top of reports.get(null) ?? []) visit(top.slug)
  for (const agent of agents) {
    if (reached.has(agent.slug)) continue
    reports.set(null, [...(reports.get(null) ?? []), agent])
    visit(agent.slug)
  }
  return reports
}

/// How many levels the hierarchy has; a company of peers has one.
export function levels(agents: TemplateAgent[]): number {
  const reports = reportsOf(agents)
  const depth = (slug: string, seen: Set<string>): number => (seen.has(slug) ? 0 : 1 + Math.max(0, ...(reports.get(slug) ?? []).map((report) => depth(report.slug, new Set(seen).add(slug)))))
  return Math.max(0, ...(reports.get(null) ?? []).map((top) => depth(top.slug, new Set())))
}
