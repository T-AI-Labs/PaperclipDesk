// Reads Paperclip's catalog of ready-made companies from GitHub into ui/src/panels/templates.json:
// the agents with their hierarchy, the teams, the skills and the inputs of every template, and the stars
// of the repository each one was generated from. The app ships the snapshot and loads nothing of it at run time.
//
//   npm run catalog            the catalog's current main
//   npm run catalog -- <ref>   a commit, tag or branch
//
// Needs a GitHub token in GITHUB_TOKEN or a signed-in `gh` for the stars; the files come from raw.githubusercontent.com.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const yaml = createRequire(join(root, "ui", "package.json"))("js-yaml");
const OUT = join(root, "ui", "src", "panels", "templates.json");
const REPO = "paperclipai/companies";

// The catalog has no categories of its own; a template missing here fails the run, so a new one gets one on purpose.
const CATEGORIES = {
  gstack: "software",
  superpowers: "software",
  "agentsys-engineering": "software",
  "fullstack-forge": "software",
  "clawteam-engineering": "software",
  "redoak-review": "software",
  "trail-of-bits-security": "security",
  "kdense-science-lab": "research",
  "clawteam-research-lab": "research",
  "aeon-intelligence": "research",
  "taches-creative": "creative",
  "minimax-studio": "creative",
  "donchitos-game-studio": "creative",
  "product-compass-consulting": "business",
  "clawteam-capital": "business",
  "agency-agents": "business",
};

const token = process.env.GITHUB_TOKEN || execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();

async function api(path) {
  const response = await fetch(`https://api.github.com/${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`GitHub ${path}: HTTP ${response.status}`);
  return response.json();
}

async function raw(sha, path) {
  const response = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.text();
}

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return match ? (yaml.load(match[1]) ?? {}) : {};
}

/// Runs `work` over `items` with a few requests in flight, keeping the order.
async function each(items, work, parallel = 16) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: parallel }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }));
  return results;
}

const text = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : null);
/// `../../agents/cto/AGENTS.md` and `cto` both name the agent `cto`.
const agentSlug = (reference) => (typeof reference === "string" ? (/agents\/([^/]+)\/AGENTS\.md$/.exec(reference)?.[1] ?? reference) : null);

const ref = process.argv[2] ?? "main";
const { sha, commit } = await api(`repos/${REPO}/commits/${encodeURIComponent(ref)}`);
const { tree, truncated } = await api(`repos/${REPO}/git/trees/${sha}?recursive=1`);
if (truncated) throw new Error("The catalog's tree came back truncated.");
const paths = tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
const ids = paths.map((path) => /^([^/]+)\/COMPANY\.md$/.exec(path)?.[1]).filter(Boolean).sort();

const unknown = ids.filter((id) => !CATEGORIES[id]);
if (unknown.length) throw new Error(`No category for ${unknown.join(", ")}: add them to CATEGORIES.`);

const templates = await each(ids, async (id) => {
  const inside = (pattern) => paths.filter((path) => path.startsWith(`${id}/`) && pattern.test(path.slice(id.length + 1)));
  const company = frontmatter(await raw(sha, `${id}/COMPANY.md`));
  const readme = paths.includes(`${id}/README.md`) ? await raw(sha, `${id}/README.md`) : "";
  // The README names the project the template was generated from, e.g. "based on [gstack](https://github.com/garrytan/gstack)".
  const source = /based on \[[^\]]*\]\(https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?[/)]/i.exec(readme)?.[1];
  if (!source) throw new Error(`${id}: the README names no source repository.`);
  const config = paths.includes(`${id}/.paperclip.yaml`) ? (yaml.load(await raw(sha, `${id}/.paperclip.yaml`)) ?? {}) : {};

  const agents = await each(inside(/^agents\/[^/]+\/AGENTS\.md$/), async (path) => {
    const agent = frontmatter(await raw(sha, path));
    return { slug: path.split("/")[2], name: text(agent.name) ?? path.split("/")[2], title: text(agent.title), reportsTo: agentSlug(agent.reportsTo), skills: Array.isArray(agent.skills) ? agent.skills.map(String) : [] };
  });
  const teams = await each(inside(/^teams\/[^/]+\/TEAM\.md$/), async (path) => {
    const team = frontmatter(await raw(sha, path));
    return { slug: path.split("/")[2], name: text(team.name) ?? path.split("/")[2], description: text(team.description), manager: agentSlug(team.manager), members: (Array.isArray(team.includes) ? team.includes : []).map(agentSlug).filter(Boolean) };
  });
  const skills = await each(inside(/^skills\/[^/]+\/SKILL\.md$/), async (path) => {
    const skill = frontmatter(await raw(sha, path));
    return { slug: path.split("/")[2], name: text(skill.name) ?? path.split("/")[2], description: text(skill.description) };
  });

  const inputs = new Map();
  for (const agent of Object.values(config.agents ?? {})) {
    for (const [key, input] of Object.entries(agent?.inputs?.env ?? {})) inputs.set(key, inputs.get(key) || input?.requirement === "required");
  }
  const repository = await api(`repos/${source}`);
  return {
    id,
    name: text(company.name) ?? id,
    description: text(company.description) ?? "",
    category: CATEGORIES[id],
    goals: (Array.isArray(company.goals) ? company.goals : []).map(text).filter(Boolean),
    inputs: [...inputs].map(([key, required]) => ({ key, required })).sort((a, b) => a.key.localeCompare(b.key)),
    // A renamed repository answers under its new name, which the README may not know yet.
    source: repository.full_name,
    stars: repository.stargazers_count,
    sourceUpdated: repository.pushed_at.slice(0, 10),
    agents,
    teams,
    skills,
  };
});

const catalog = { commit: sha, date: new Date().toISOString().slice(0, 10), committed: commit.committer.date.slice(0, 10), templates };
writeFileSync(OUT, `${JSON.stringify(catalog, null, 1)}\n`);
console.log(`[catalog] ${templates.length} templates of ${REPO}@${sha.slice(0, 7)} written to ${OUT}`);
