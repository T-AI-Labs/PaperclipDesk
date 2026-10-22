import type { Message } from '@/i18n'

export type TemplateCategory = 'software' | 'security' | 'research' | 'creative' | 'business'

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: Message }[] = [
  { id: 'software', label: 'Software' },
  { id: 'security', label: 'Sicherheit' },
  { id: 'research', label: 'Forschung' },
  { id: 'creative', label: 'Kreativ' },
  { id: 'business', label: 'Business' },
]

/// A company of Paperclip's catalog github.com/paperclipai/companies, by its folder there. The description is the catalog's own, in English.
export interface Template {
  id: string
  name: string
  description: string
  agents: number
  skills: number
  category: TemplateCategory
  /// The environment values its agents read; a required one must be given for the import to succeed.
  inputs: { key: string; required: boolean }[]
}

/// As of the catalog's commit 514503b; a new template arrives with an app update.
export const TEMPLATES: Template[] = [
  {
    id: 'gstack',
    name: 'GStack',
    description: 'Engineering company powered by gstack workflow skills — distinct cognitive modes for product vision, design critique, technical planning, security auditing, code review, shipping, deployment, and QA',
    agents: 5,
    skills: 27,
    category: 'software',
    inputs: [{ key: 'GH_TOKEN', required: false }],
  },
  {
    id: 'superpowers',
    name: 'Superpowers Dev Shop',
    description: 'A disciplined software development company powered by the Superpowers workflow — brainstorm, plan, build with TDD, review, and ship',
    agents: 4,
    skills: 14,
    category: 'software',
    inputs: [{ key: 'GH_TOKEN', required: false }],
  },
  {
    id: 'agentsys-engineering',
    name: 'AgentSys Engineering',
    description: 'AI-powered software engineering company that orchestrates the full development lifecycle — from task discovery through production shipping',
    agents: 5,
    skills: 14,
    category: 'software',
    inputs: [{ key: 'GH_TOKEN', required: false }],
  },
  {
    id: 'fullstack-forge',
    name: 'Fullstack Forge',
    description: 'A full-service software development consultancy with 66 specialized skills covering 12 programming languages, 7 backend frameworks, frontend/mobile, infrastructure, security, data science, and DevOps',
    agents: 49,
    skills: 66,
    category: 'software',
    inputs: [],
  },
  {
    id: 'clawteam-engineering',
    name: 'ClawTeam Engineering',
    description: 'Agentic software engineering through self-organizing multi-agent teams that plan, build, review, test, and deploy software autonomously',
    agents: 5,
    skills: 1,
    category: 'software',
    inputs: [],
  },
  {
    id: 'redoak-review',
    name: 'RedOak Review',
    description: 'A boutique code quality, design, and security review agency powered by pragmatic, opinionated review workflows',
    agents: 5,
    skills: 6,
    category: 'software',
    inputs: [{ key: 'GH_TOKEN', required: false }],
  },
  {
    id: 'trail-of-bits-security',
    name: 'Trail of Bits Security',
    description: 'A prestigious security auditing and verification firm with expertise in smart contract security, cryptographic analysis, binary reverse engineering, and application security testing',
    agents: 28,
    skills: 35,
    category: 'security',
    inputs: [],
  },
  {
    id: 'kdense-science-lab',
    name: 'K-Dense Science Lab',
    description: 'A multi-disciplinary scientific research institute powered by 177 specialized skills spanning bioinformatics, drug discovery, clinical research, machine learning, quantum computing, and 37 scientific databases',
    agents: 54,
    skills: 177,
    category: 'research',
    inputs: [],
  },
  {
    id: 'clawteam-research-lab',
    name: 'ClawTeam Research Lab',
    description: 'Autonomous AI research automation through coordinated multi-agent teams that conduct literature surveys, design experiments, run analyses, and synthesize findings',
    agents: 4,
    skills: 1,
    category: 'research',
    inputs: [],
  },
  {
    id: 'aeon-intelligence',
    name: 'Aeon Intelligence',
    description: 'Autonomous AI intelligence company powered by Aeon — runs research, engineering, crypto monitoring, and productivity workflows on GitHub Actions via Claude Code',
    agents: 4,
    skills: 32,
    category: 'research',
    inputs: [{ key: 'GH_TOKEN', required: true }, { key: 'ALCHEMY_API_KEY', required: false }],
  },
  {
    id: 'taches-creative',
    name: 'TÂCHES Creative',
    description: 'A creative strategy and meta-skills agency specializing in thinking frameworks, research methodology, and AI workflow optimization',
    agents: 6,
    skills: 35,
    category: 'creative',
    inputs: [],
  },
  {
    id: 'minimax-studio',
    name: 'MiniMax Studio',
    description: 'Full-service digital studio that builds apps, creates visual effects, and produces professional documents',
    agents: 5,
    skills: 10,
    category: 'creative',
    inputs: [{ key: 'MINIMAX_API_KEY', required: false }],
  },
  {
    id: 'donchitos-game-studio',
    name: 'Donchitos Game Studio',
    description: 'Full-service indie game development studio with 49 coordinated AI agents spanning creative direction, engineering, design, art, audio, narrative, QA, and production',
    agents: 49,
    skills: 37,
    category: 'creative',
    inputs: [{ key: 'GH_TOKEN', required: false }],
  },
  {
    id: 'product-compass-consulting',
    name: 'Product Compass Consulting',
    description: 'Full-service AI product management consultancy with 65 specialized skills covering discovery, strategy, execution, research, analytics, go-to-market, marketing, and PM career tools',
    agents: 48,
    skills: 65,
    category: 'business',
    inputs: [],
  },
  {
    id: 'clawteam-capital',
    name: 'ClawTeam Capital',
    description: 'AI-powered investment analysis through specialized multi-agent teams that research securities from multiple angles and consolidate signals into risk-adjusted portfolio decisions',
    agents: 7,
    skills: 1,
    category: 'business',
    inputs: [],
  },
  {
    id: 'agency-agents',
    name: 'Agency Agents',
    description: 'A complete AI agency with 167 specialized agents across 10 divisions — engineering, design, marketing, product, sales, QA, operations, game development, spatial computing, and specialized operations',
    agents: 167,
    skills: 0,
    category: 'business',
    inputs: [{ key: 'GH_TOKEN', required: false }],
  },
]
