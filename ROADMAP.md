# Roadmap

Ideas that are wanted but not scheduled yet. The focus of the app moves towards setting up Paperclip companies with
wizards; the items below are ordered by that focus, not by size. The worked-out plan for n8n next to Paperclip, and
why Agno is not part of it, is in `PLAN.md`.

## Company wizard

A wizard that builds a new company step by step instead of importing one template as a whole. Done: name, purpose and
goals, agents from any catalog template or of the user's own, whom each reports to with a live org chart, skills per
agent, and a check by Paperclip before the company is created from an inline package. Left from the ideas below:
drag and drop in the org chart, teams, packages found on GitHub as a source, and example projects and tasks.

- Start empty or from a template, then add agents from any template of the catalog, remove some, rename them.
- Arrange the hierarchy by drag and drop as an org chart; the templates carry it already (`reportsTo` in each agent's
  `AGENTS.md`, plus `teams/`), so a template opens with its own chart.
- Pick the skills per agent; an agent from another template brings its skills along.
- Ask for the required secrets of the chosen agents at the end, as the template panel does today.
- The result is a company package in the `companies.sh` format, built locally and imported through Paperclip like a
  template, so nothing of Paperclip is reimplemented. Paperclip's import takes an `inline` source with the package's
  files, and its preview (`POST /api/companies/import/preview`) returns the manifest and every file of a template, so
  agents of several templates can be put together from what Paperclip read.
- The free templates have no projects or tasks; an optional step could create a first project and a few example tasks
  through Paperclip's REST API.
- Compare with the Paperclip plugin `Yesterday-AI/paperclip-plugin-company-wizard` (MIT), which builds companies from
  presets, modules and roles inside Paperclip, with an AI mode.

## Template catalog

The catalog snapshot with agents, hierarchy, teams and skills, the content search, sorting and filters, the org chart and
the GitHub search are done. Left:

- Filter by licence.
- Hierarchy depth and required secrets of a GitHub result are known only once it is opened; reading them for the
  whole list would need a preview per result.

## AI assistant for the wizards

Done for the company wizard: off by default, the user's Claude subscription through Claude Code when turned on; it asks
up to three questions and proposes name, goals, agents, hierarchy and skills from the catalog. Left:

- API keys and other providers next to Claude Code.
- The assistant in later wizards, e.g. the export to a remote, and refining a draft the user already changed.

## Several companies side by side

- Open another company of the same connection in a tab or in a split view next to the one in front.
- Each view is one more Paperclip webview on the connection's profile, so the session is shared; the layout in
  `client.rs` gets a second pane.
- Costs memory per view (one more WebView2 renderer, roughly 100 to 200 MB).

## Export to a remote

- A wizard that exports chosen companies of the local server and brings them to a remote Paperclip.
- Lists the common hosting options (to be researched: the Paperclip hosting services, a VPS with Docker, platforms
  with a CLI) with what each needs.
- Either step-by-step instructions or an automated run through the provider's CLI, with a token entered in the wizard
  or the CLI's own sign-in.

## Tutorials

- Links to tutorials and videos about Paperclip in the app, with search and sorting by views.
- Preferably a curated list compiled into the app like the template catalog, refreshed with each release: no network
  at run time and no API key.
- A live YouTube search needs a YouTube Data API key and its daily quota; playing videos inside the app would load
  Google's player, so videos open in the browser or use `youtube-nocookie.com`, in line with hard rule 8.

## Multilingual installer

- The NSIS installer of the GitHub release in the app's eleven languages, with the language selector of Tauri's NSIS
  bundler (`bundle.windows.nsis.languages`, `displayLanguageSelector`).

## Paperclip in the app's language

- Switch Paperclip's web UI to the app's language when it changes in the settings.
- Blocked upstream: Paperclip's UI starts i18next with a fixed `lng: "en"`, has no language detector and no switch, and
  its locale files hold only the empty-company texts so far. Once Paperclip offers a language setting or detector, the
  app passes its language on.
