# Plan: n8n next to Paperclip

Paperclip runs the company: agents, hierarchy, tasks, approvals, budgets. What it lacks for daily operation is the
connection to the outside world: mail, CRM, calendars, chat, forms, schedules. n8n is built for exactly that, with a
visual editor, 1500 integrations and its own web UI. Together they cover "set the company up" and "run it
professionally" (see the goal in `CLAUDE.md`). Agno is not part of this plan; see the end.

Nothing of this is built yet. The facts about n8n below were checked against its source in `C:\Sources\n8n`; routes
and commands are to be checked again against the n8n version the work starts with.

## Decisions

- **Off by default.** n8n is an option the user turns on (Gear → App → n8n). Turned off, the app shows no n8n tab,
  menu, process or setting beyond the switch, and talks to no n8n.
- **Local or remote, like Paperclip.** Each Paperclip connection can have one n8n next to it: a remote n8n by its URL,
  or a local one the app starts. The local Paperclip pairs with the local n8n by default.
- **Connect n8n, do not bundle it.** n8n is under the Sustainable Use License: use for one's own business is free, but
  distributing it is allowed only free of charge for non-commercial purposes. The app ships no n8n. A local n8n is one
  the user installed (`npm i -g n8n`), which the app finds and starts the way it starts the local Paperclip.
- **n8n gets its own webview, shown as a tab of the connection.** One webview per open origin, its own browser profile,
  locked to its origin, no capability: hard rules 1 and 3 apply unchanged.
- **Paperclip stays the source of truth.** n8n triggers and carries out; tasks, agents and approvals live in Paperclip.
  No data is copied between the two apart from what a workflow passes on.

## Step 1: the switch, the connection and the tab

- **Setting** `n8n: off | on` in `client-settings.json`, off by default.
- **Connection:** a saved connection gets an optional n8n part: none, local, or a remote URL with the same check and
  `allow insecure http` choice as a Paperclip remote (n8n answers `GET /healthz`). The remotes panel edits it; the
  connection page offers it when the switch is on.
- **Tab:** the connection chip shows two tabs, **Paperclip** and **n8n**; a shortcut switches between them. The n8n
  webview loads only when its tab is first opened, so an n8n that is set up but not used costs nothing.
- **Webview:** browser profile per connection under `%LOCALAPPDATA%\Paperclip\webview`, navigation outside its origin
  goes to the system browser, n8n's own sign-in stays in the webview. The colour scheme follows the app where n8n
  supports it.

## Step 2: navigation over the n8n tab

The menu bar keeps its shape; over the n8n tab its menus are n8n's, built by the host like Paperclip's and reaching
the page by navigation inside its origin. Every entry is a menu action, so it can have a key (Gear → Keyboard
shortcuts).

| Menu | Entries (n8n route) |
| --- | --- |
| **n8n** (named after the instance) | Overview (`/home`), Projects (`/projects`), Settings (`/settings`), API keys (`/settings/api`), Users (`/settings/users`), Community nodes (`/settings/community-nodes`) |
| **New** | Workflow (`/workflow/new`), Credential (the credentials page with its create dialog), Data table |
| **Go to** | Workflows (`/home/workflows`), Executions (`/home/executions`), Credentials (`/home/credentials`), Data tables (`/home/datatables`), Variables (`/variables`), Templates (`/templates/`), Chat (`/home/chat`) |
| **Help** | n8n documentation, the app's entries as today |

The gear, the connection chip and the tab switch stay on the right as now.

## Step 3: a local n8n

- The app looks for `n8n.cmd` on the PATH (npm's global folder) and shows its version; without one it explains how to
  install it and offers the remote way instead.
- It starts n8n as a child process with a free port from 5678 on, waits for `/healthz`, and ends it with the app; hard
  rule 5 applies, including a PID file for an n8n left behind by a crash.
- Environment: `N8N_PORT`, `N8N_USER_FOLDER`, `N8N_DIAGNOSTICS_ENABLED=false` and
  `N8N_VERSION_NOTIFICATIONS_ENABLED=false`, so the app's n8n sends no telemetry (hard rule 8).
- Data: an existing `~/.n8n` is used as it is, as the app does with an existing Paperclip CLI home; otherwise
  `%APPDATA%\Paperclip\n8n`. A new environment variable moves it for test runs, and
  `PAPERCLIPDESK_REQUIRE_ISOLATED_DATA` covers it.
- Its log joins the app's log page as a third source.

## Step 4: backup and restore

Gear → **n8n backup …** opens a panel; a combined backup per company is the goal, n8n alone comes first.

- **Local n8n:** n8n's own commands, run by the app with the instance's `N8N_USER_FOLDER`:
  - `n8n export:workflow --backup --output=<folder>` and `n8n export:credentials --backup --output=<folder>`;
    credentials stay encrypted, so the backup also takes the encryption key from the instance's `config` file.
  - The folder is zipped to a place the user picks, with a note that the archive holds the key to all credentials
    and is to be kept like a password.
  - Restore: `n8n import:workflow --separate --input=<folder>` and `n8n import:credentials …`, with n8n stopped
    while it runs.
- **Remote n8n:** n8n's public API with an API key the user creates in n8n (kept in the Windows credential store, like
  the GitHub token): workflows, tags, variables and data tables. n8n's API never hands out the secrets of credentials,
  so a remote backup holds their names and types only, and a restore asks for the secrets again. The panel says so
  before the backup starts.
- **Per company:** workflows tagged with a company's prefix belong to it; a company backup puts Paperclip's company
  export and those workflows into one archive.
- Hard rule 6 applies: a restore asks first and offers a backup of what it replaces.

## Step 5: let them work together

Both directions exist already and need no change to either product:

- **Paperclip → n8n:** a Paperclip agent with the `http` adapter posts each run as JSON to a URL; an n8n webhook
  workflow receives it, does the work, and answers. So a workflow can be an agent of the company, e.g. "Mailroom" or
  "CRM clerk". Agents that run Claude Code can also use n8n's MCP server as a tool source.
- **n8n → Paperclip:** an n8n HTTP request with a Paperclip API key creates issues, comments or approvals, e.g.
  "mail from a customer → issue for Support".

A wizard, **Connect automation …**, sets this up on both sides:

- creates the webhook workflow in n8n through its public API and the matching `http` agent in Paperclip,
- or creates a Paperclip API key and an n8n credential with it, plus a starter workflow from a short list
  (mail → issue, form → issue, issue done → message),
- tags what it creates with the company's prefix, so backups and the n8n tab can tell companies apart.

Later: a small Paperclip plugin (its plugin SDK has events such as `issue.created` and inbound webhooks) that forwards
chosen events to n8n, so workflows react to what happens in the company without polling.

## Step 6: templates that include automation

Company templates of the catalog get matching n8n starter workflows where it makes sense (a software company: GitHub
and release notes; an agency: mail and CRM). The company wizard offers them in its last step when n8n is on.

## Costs and risks

- Memory: one more WebView2 renderer per open n8n tab, roughly 150 to 250 MB; a local n8n needs another 300 to 600 MB
  and takes a while to start the first time. Estimates, not measured.
- Licence: as long as the app neither ships nor modifies n8n, the user's own use is covered by n8n's licence; a
  release that bundles n8n is ruled out.
- n8n's routes and CLI change between versions; the menus and the backup check the version they run against.
- Two logins: n8n has its own accounts; the app keeps both sessions in the connection's profile and does not merge them.
- A backup with the encryption key is as sensitive as all credentials together.

## Open questions

- How a Paperclip API key for n8n is best created: by the board through Paperclip's UI, or by the app through the REST
  API.
- Whether n8n's MCP server can be offered to Paperclip's Claude Code agents per company without the user editing
  configuration files.
- Which n8n version is the oldest the menus and the backup support.

## Agno: not now

Agno (`C:\Sources\agno`) is a Python framework and runtime for agents. It is not a good fit as a second webview:

- Its management UI is not in the repository; it is the hosted `os.agno.com`, which needs an Agno account and connects
  from the cloud to the local runtime. The app would show a third-party cloud page.
- The runtime sends a telemetry event per agent run unless `AGNO_TELEMETRY=false` is set.
- Its opt-in "Company" domain (tasks, projects, products, heartbeat, playbook) overlaps with Paperclip. Two places for
  tasks and agents contradict the goal of one place where the company lives.
- It would add a Python runtime to an app that ships Node.js for Paperclip.

What could make sense later: a single Agno agent as the worker behind a Paperclip agent, through the `http` adapter
and a small endpoint that turns Paperclip's run payload into an AgentOS run. That is worth doing only once someone
builds agents in Python with Agno; until then Paperclip's own adapters (Claude Code, Codex, Gemini and others) cover it.
