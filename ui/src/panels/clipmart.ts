import type { TemplateAgent, TemplateSkill } from '@/lib/client'

import snapshot from './clipmart.json'
import type { TemplateCategory } from './catalog'
import { type Files, setFrontMatter } from './wizard/compose'

export interface ClipmartAgent extends TemplateAgent {
  /// When it runs, in Clipmart's words, e.g. "every 4h"; it only reaches the agent's instructions.
  schedule: string
  responsibilities: string[]
}

/// A free template of clipmart.ai, a community site with neither a repository nor an API. The texts are its own, in English.
export interface ClipmartTemplate {
  id: string
  name: string
  tagline: string | null
  description: string
  category: TemplateCategory
  /// The name the template was submitted under on Clipmart.
  author: string
  tags: string[]
  goals: string[]
  /// When it was added, as YYYY-MM-DD; empty for those that do not say.
  created: string
  /// Clipmart's own estimates in US dollars a month: the AI running costs, and the revenue as a range.
  monthlyCost: number
  monthlyRevenue: [number, number]
  firstOutput: string
  /// The files Clipmart names as the company's knowledge; its package brings none of them.
  knowledgeBase: string[]
  agents: ClipmartAgent[]
  /// Only slugs: Clipmart writes the same placeholder instructions for every skill.
  skills: string[]
}

/// Read by `npm run catalog` from clipmart.ai; a new template arrives with an app update.
export const CLIPMART_TEMPLATES = snapshot.templates as ClipmartTemplate[]

export const CLIPMART_DATE = snapshot.date

const words = (slug: string) => slug.replace(/-/g, ' ')

export const clipmartSkills = (template: ClipmartTemplate): TemplateSkill[] =>
  template.skills.map((slug) => ({ slug, name: slug, description: `Provides ${words(slug)} capability. Use when the agent needs to ${words(slug)} as part of its workflow.` }))

/// What the evaluation of a template found that its page does not say; each is the key of a text and its values.
export function clipmartFindings(template: ClipmartTemplate): { text: 'unused' | 'tops' | 'knowledge'; count: number; total?: number }[] {
  const used = new Set(template.agents.flatMap((agent) => agent.skills))
  const unused = template.skills.filter((skill) => !used.has(skill)).length
  const tops = template.agents.filter((agent) => agent.reportsTo === null).length
  return [
    ...(unused > 0 ? [{ text: 'unused' as const, count: unused, total: template.skills.length }] : []),
    ...(tops > 1 ? [{ text: 'tops' as const, count: tops }] : []),
    ...(template.knowledgeBase.length > 0 ? [{ text: 'knowledge' as const, count: template.knowledgeBase.length }] : []),
  ]
}

/// The package Clipmart's download builds, with two corrections: the front matter is quoted, which breaks on a colon in
/// Clipmart's own, and each agent's model is its adapter's setting instead of a comment Paperclip does not read.
/// Clipmart asks every agent for an ANTHROPIC_API_KEY; Claude Code runs with the user's own sign-in, so the package does not.
export function clipmartPackage(template: ClipmartTemplate): Files {
  const files: Files = {}
  const revenue = template.monthlyRevenue.map((amount) => `$${amount}`).join('–')
  files['COMPANY.md'] = setFrontMatter(
    [
      `# ${template.name}`,
      '',
      template.description,
      '',
      '## Tags',
      '',
      template.tags.join(', '),
      '',
      '## Estimated Economics',
      '',
      `- Monthly AI cost: ~$${template.monthlyCost}`,
      `- Estimated monthly revenue: ${revenue}`,
      `- Time to first output: ${template.firstOutput}`,
      '',
      '---',
      '',
      `*Imported from [Clipmart](https://www.clipmart.ai/templates/${template.id}) — Community-built templates for the Paperclip ecosystem.*`,
      '',
    ].join('\n'),
    { name: template.name, description: template.description, slug: template.id, schema: 'agentcompanies/v1', version: '1.0.0', license: 'MIT', goals: template.goals },
  )
  files['README.md'] = `# ${template.name}\n\n${template.description}\n\nBy ${template.author}, [on Clipmart](https://www.clipmart.ai/templates/${template.id}).\n`
  files['LICENSE'] = `MIT License\n\nCopyright (c) 2026 ${template.author}\n`
  files['.paperclip.yaml'] = ['schema: paperclip/v1', 'agents:', ...template.agents.flatMap((agent) => [`  ${agent.slug}:`, '    adapter:', `      type: ${agent.adapterType}`, '      config:', `        model: ${agent.model}`]), ''].join('\n')
  for (const agent of template.agents) {
    const body = [
      `# ${agent.name}`,
      '',
      '## What triggers you',
      '',
      agent.schedule,
      '',
      '## What you do',
      '',
      ...agent.responsibilities.map((responsibility) => `- ${responsibility}`),
      '',
      '## What you produce',
      '',
      'Completed outputs as defined by the responsibilities above, passed downstream.',
      '',
      '## Who you hand off to',
      '',
      agent.reportsTo ? `Reports up to \`${agent.reportsTo}\`. Hands work to peers or subordinates as needed.` : 'Orchestrates all other agents in the company.',
      '',
    ].join('\n')
    files[`agents/${agent.slug}/AGENTS.md`] = setFrontMatter(body, { name: agent.name, title: agent.title, reportsTo: agent.reportsTo, skills: agent.skills })
  }
  for (const skill of clipmartSkills(template)) {
    const title = words(skill.slug)
    const body = [
      `# ${title.replace(/\b\w/g, (letter) => letter.toUpperCase())}`,
      '',
      `Enables agents to perform **${title}** tasks.`,
      '',
      '## When to use',
      '',
      `Activate this skill when the agent's current task requires ${title}.`,
      '',
      '## Instructions',
      '',
      `Follow standard best practices for ${title}. Produce clean, structured output that downstream agents can consume without transformation.`,
      '',
      '## Notes',
      '',
      '- Keep outputs concise and actionable',
      '- Document any assumptions made during execution',
      '',
    ].join('\n')
    files[`skills/${skill.slug}/SKILL.md`] = setFrontMatter(body, { name: skill.slug, description: skill.description, license: 'MIT' })
  }
  return files
}
