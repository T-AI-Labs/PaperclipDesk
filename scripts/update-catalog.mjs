// Reads Paperclip's catalog of ready-made companies from GitHub into ui/src/panels/templates.json:
// the agents with their hierarchy, the teams, the skills and the inputs of every template, and the stars
// of the repository each one was generated from. Then the free templates of clipmart.ai into clipmart.json, the
// collections of agents and skills into collections.json and the icons of all of them into icons.json.
// The app ships the snapshots; at run time it fetches only the files of a collection's agents and skills a new company takes,
// and for a live collection the agents its default branch added or changed since.
//
//   npm run catalog            the catalog's current main
//   npm run catalog -- <ref>   a commit, tag or branch
//
// Needs a GitHub token in GITHUB_TOKEN or a signed-in `gh` for the stars; the files come from raw.githubusercontent.com.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PLAIN_PATH, agentEntry, distinctAgents } from "../ui/src/panels/collection-agent.ts";

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
    const slug = path.split("/")[2];
    // Without an adapter here, Paperclip imports the agent as a plain process without AI.
    const adapter = config.agents?.[slug]?.adapter;
    return {
      slug,
      name: text(agent.name) ?? slug,
      title: text(agent.title),
      reportsTo: agentSlug(agent.reportsTo),
      skills: Array.isArray(agent.skills) ? agent.skills.map(String) : [],
      adapterType: text(adapter?.type),
      model: text(adapter?.config?.model),
    };
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

// Clipmart has no repository and no API: its start page carries every template as data, and its download builds the
// package from that data in the browser. The agents below follow that download, so an import here gets what it gets.
const CLIPMART = "https://www.clipmart.ai/";
const CLIPMART_OUT = join(root, "ui", "src", "panels", "clipmart.json");
const CLIPMART_CATEGORIES = { Agency: "business", SaaS: "software", Marketing: "marketing", "E-commerce": "commerce", Finance: "finance", Media: "media" };

/// The objects of a Next.js page's flight data that start with `"slug"` and have agents: Clipmart's templates.
function clipmartData(html) {
  let flight = "";
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) flight += JSON.parse(match[1]);
  const found = new Map();
  for (const match of flight.matchAll(/\{"slug":"/g)) {
    let depth = 0;
    let quoted = false;
    let end = match.index;
    for (; end < flight.length; end++) {
      const char = flight[end];
      if (quoted) {
        if (char === "\\") end++;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) break;
    }
    const template = JSON.parse(flight.slice(match.index, end + 1));
    if (Array.isArray(template.agents)) found.set(template.slug, template);
  }
  return [...found.values()];
}

const tier = (model) => (model.includes("opus") ? 0 : model.includes("sonnet") ? 1 : 2);

/// Clipmart's download ranks by model: the first Opus agent leads, Sonnet agents report to it, Haiku agents to the first Sonnet one.
/// Every agent gets the same first third of the company's skills.
function clipmartAgents(template) {
  const counts = {};
  for (const agent of template.agents) counts[agent.role] = (counts[agent.role] ?? 0) + 1;
  const numbered = {};
  const slugged = template.agents.map((agent) => {
    const base = agent.role.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return { agent, slug: counts[agent.role] > 1 ? `${base}-${(numbered[agent.role] = (numbered[agent.role] ?? 0) + 1)}` : base };
  });
  const lead = slugged.find(({ agent }) => tier(agent.model) === 0);
  const firstSonnet = slugged.find(({ agent }) => tier(agent.model) === 1);
  const skills = template.skills.length > 0 ? template.skills.slice(0, Math.max(2, Math.ceil(template.skills.length / 3))) : ["web-search"];
  return slugged.map(({ agent, slug }) => {
    const rank = tier(agent.model);
    const boss = rank === 0 ? (lead.slug === slug ? null : lead.slug) : rank === 1 ? (lead?.slug ?? null) : (firstSonnet ?? lead ?? slugged[0]).slug;
    return {
      slug,
      name: agent.role,
      title: agent.role,
      reportsTo: boss === slug ? null : boss,
      skills,
      adapterType: "claude_local",
      model: agent.model,
      schedule: agent.schedule,
      responsibilities: agent.responsibilities,
    };
  });
}

const clipmartPage = await fetch(CLIPMART);
if (!clipmartPage.ok) throw new Error(`${CLIPMART}: HTTP ${clipmartPage.status}`);
const clipmartHtml = await clipmartPage.text();
const clipmartTemplates = clipmartData(clipmartHtml)
  .map((template) => {
    const category = CLIPMART_CATEGORIES[template.category];
    if (!category) throw new Error(`Clipmart ${template.slug}: no category for ${template.category}, add it to CLIPMART_CATEGORIES.`);
    const [low, high] = template.estimatedMonthlyRevenue.split("-").map(Number);
    return {
      id: template.slug,
      name: text(template.name),
      tagline: text(template.tagline),
      description: text(template.description) ?? "",
      category,
      author: template.author,
      tags: template.tags,
      goals: template.goals.map(text).filter(Boolean),
      created: template.createdAt ?? "",
      monthlyCost: template.estimatedMonthlyCost,
      monthlyRevenue: [low, high],
      firstOutput: template.timeToFirstOutput,
      knowledgeBase: template.knowledgeBase,
      agents: clipmartAgents(template),
      skills: template.skills,
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
if (clipmartTemplates.length === 0) throw new Error(`${CLIPMART}: no templates found, the page has changed.`);
writeFileSync(CLIPMART_OUT, `${JSON.stringify({ date: new Date().toISOString().slice(0, 10), templates: clipmartTemplates }, null, 1)}\n`);
console.log(`[catalog] ${clipmartTemplates.length} templates of ${CLIPMART} written to ${CLIPMART_OUT}`);

// Collections of single agents and skills to put a company together from: no company of their own, so no teams and one level.
// Agents are Claude Code subagents, a Markdown file each; skills are folders with a SKILL.md, the format Paperclip uses too.
// `group` names the folder an entry sits in, which the collection uses as its own categories. A `live` collection the app
// reads from its default branch at run time; its agents carry the Git blob SHA the branch is compared by.
const COLLECTIONS_OUT = join(root, "ui", "src", "panels", "collections.json");
const COLLECTIONS = [
  { repository: "wshobson/agents", name: "Agents & Skills by wshobson", agents: /^plugins\/([^/]+)\/agents\/([^/]+)\.md$/, skills: /^plugins\/([^/]+)\/skills\/([^/]+)\/SKILL\.md$/ },
  { repository: "VoltAgent/awesome-claude-code-subagents", name: "Awesome Claude Code Subagents", agents: /^categories\/\d+-([^/]+)\/(?!README)([^/]+)\.md$/ },
  // The repository has no licence of its own; each skill brings one, and only those under Apache 2.0 are free to pass on.
  { repository: "anthropics/skills", name: "Anthropic Skills", license: "Apache-2.0", skillLicense: /Apache License/, skills: /^skills\/()([^/]+)\/SKILL\.md$/ },
  { repository: "Jeffallan/claude-skills", name: "Claude Skills by Jeffallan", skills: /^skills\/()([^/]+)\/SKILL\.md$/ },
  { repository: "addyosmani/agent-skills", name: "Agent Skills by Addy Osmani", skills: /^skills\/()([^/]+)\/SKILL\.md$/ },
  { repository: "msitarzewski/agency-agents", name: "The Agency by msitarzewski", live: true, agents: /^(?!strategy\/|examples\/|integrations\/|scripts\/)([a-z-]+)\/(?:[^/]+\/)?(?!README)([^/]+)\.md$/ },
];
/// A skill's files go into the company package whole; a larger one, mostly fonts or media, stays out.
const SKILL_LIMIT = 2 * 1024 * 1024;

async function rawBytes(repository, sha, path) {
  const response = await fetch(`https://raw.githubusercontent.com/${repository}/${sha}/${path}`);
  if (!response.ok) throw new Error(`${repository}/${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const groupName = (folder) => folder.replace(/[-_]+/g, " ").trim();

const collections = [];
for (const collection of COLLECTIONS) {
  const repository = await api(`repos/${collection.repository}`);
  const { sha } = await api(`repos/${collection.repository}/commits/${repository.default_branch}`);
  const listing = await api(`repos/${collection.repository}/git/trees/${sha}?recursive=1`);
  if (listing.truncated) throw new Error(`${collection.repository}: the tree came back truncated.`);
  const blobs = listing.tree.filter((entry) => entry.type === "blob");
  const license = collection.license ?? repository.license?.spdx_id;
  if (!license || license === "NOASSERTION") throw new Error(`${collection.repository}: no licence to pass its files on with.`);

  const agents = distinctAgents(
    (await each(collection.agents ? blobs.filter((entry) => collection.agents.test(entry.path)) : [], async (entry) => {
      const [, group, file] = collection.agents.exec(entry.path);
      const bytes = await rawBytes(collection.repository, sha, entry.path);
      let meta;
      try {
        meta = frontmatter(bytes.toString("utf8"));
      } catch {
        return null;
      }
      const agent = agentEntry(entry.path, group, file, meta.name, meta.description);
      return agent && { ...agent, ...(collection.live ? { blob: entry.sha } : { sha256: sha256(bytes) }) };
    })).filter(Boolean),
    (agent) => agent.blob ?? agent.sha256,
  );

  const skillSlugs = new Set();
  const skills = (
    await each(collection.skills ? blobs.filter((entry) => collection.skills.test(entry.path)) : [], async (entry) => {
      const [, group, slug] = collection.skills.exec(entry.path);
      const folder = entry.path.slice(0, -"/SKILL.md".length);
      const inside = blobs.filter((blob) => blob.path.startsWith(`${folder}/`));
      const size = inside.reduce((sum, blob) => sum + blob.size, 0);
      if (size > SKILL_LIMIT || !inside.every((blob) => PLAIN_PATH.test(blob.path))) return console.log(`[catalog] ${collection.repository}: ${slug} left out, ${size} bytes or an unusual file name`), null;
      if (collection.skillLicense) {
        const licence = inside.find((blob) => /\/LICENSE(\.txt|\.md)?$/i.test(blob.path));
        if (!licence || !collection.skillLicense.test((await rawBytes(collection.repository, sha, licence.path)).toString("utf8"))) return null;
      }
      const files = await each(inside, async (blob) => ({ path: blob.path.slice(folder.length + 1), sha256: sha256(await rawBytes(collection.repository, sha, blob.path)) }), 8);
      let meta;
      try {
        meta = frontmatter((await rawBytes(collection.repository, sha, entry.path)).toString("utf8"));
      } catch {
        return null;
      }
      return { slug, name: text(meta.name) ?? slug, description: text(meta.description), group: groupName(group), folder, files };
    })
  )
    .filter(Boolean)
    .filter((skill) => !skillSlugs.has(skill.slug) && skillSlugs.add(skill.slug));

  collections.push({
    id: collection.repository,
    name: collection.name,
    description: text(repository.description) ?? "",
    commit: sha,
    ...(collection.live && { live: collection.agents.source }),
    license,
    stars: repository.stargazers_count,
    updated: repository.pushed_at.slice(0, 10),
    agents,
    skills,
  });
  console.log(`[catalog] ${collection.repository}: ${agents.length} agents, ${skills.length} skills`);
}
writeFileSync(COLLECTIONS_OUT, `${JSON.stringify({ date: new Date().toISOString().slice(0, 10), collections }, null, 1)}\n`);

// The icons the template page shows: the avatar of each source's owner on GitHub and Clipmart's own. They are shipped
// with the app, so opening the page asks no one for them.
const ICONS_OUT = join(root, "ui", "src", "panels", "icons.json");
async function dataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return `data:${response.headers.get("content-type")?.split(";")[0] ?? "image/png"};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
}
const owners = [...new Set([...templates.map((template) => template.source), ...collections.map((collection) => collection.id)].map((repository) => repository.split("/")[0]))].sort();
const clipmartIcon = /<link rel="icon" href="(\/icon[^"]*)"[^>]*type="image\/png"/.exec(clipmartHtml)?.[1];
if (!clipmartIcon) throw new Error(`${CLIPMART}: no icon found.`);
const icons = { clipmart: await dataUrl(new URL(clipmartIcon, CLIPMART).href), owners: Object.fromEntries(await each(owners, async (owner) => [owner, await dataUrl(`https://github.com/${owner}.png?size=48`)], 8)) };
writeFileSync(ICONS_OUT, `${JSON.stringify(icons, null, 1)}\n`);
console.log(`[catalog] ${owners.length + 1} icons written to ${ICONS_OUT}`);
