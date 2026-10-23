# Roadmap

Ideas that are wanted but not scheduled yet. The focus of the app moves towards setting up Paperclip companies with
wizards; the items below are ordered by that focus, not by size.

## Company wizard

A wizard that builds a new company step by step instead of importing one template as a whole.

- Start empty or from a template, then add agents from any template of the catalog, remove some, rename them.
- Arrange the hierarchy by drag and drop as an org chart; the templates carry it already (`reportsTo` in each agent's
  `AGENTS.md`, plus `teams/`), so a template opens with its own chart.
- Pick the skills per agent; an agent from another template brings its skills along.
- Ask for the required secrets of the chosen agents at the end, as the template panel does today.
- The result is a company package in the `companies.sh` format, built locally and imported through Paperclip like a
  template, so nothing of Paperclip is reimplemented.
- The free templates have no projects or tasks; an optional step could create a first project and a few example tasks
  through Paperclip's REST API.

## Template catalog

- Search GitHub for further templates (repositories with a `COMPANY.md` and `.paperclip.yaml`) next to the fixed catalog.
  GitHub's code search needs a token; without one only the fixed catalog and the providers are shown.
- Sort and filter by what a template contains: agents, skills, teams, depth of the hierarchy, required secrets, stars,
  last update, licence.
- Show the hierarchy of a template before the import.

## AI assistant for the wizards

- An assistant that asks questions and proposes agents, hierarchy and skills for the company the user describes.
- The provider is chosen in the settings. First the user's Claude subscription (through the signed-in Claude Code
  CLI), later API keys and other providers.
- Strictly opt-in: it adds a party the app talks to, so hard rule 8 in `CLAUDE.md` changes with it.

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
