# PaperclipDesk

A Windows desktop client for [Paperclip](https://docs.paperclip.ing/). It starts the Paperclip server on this machine
or connects to a remote one, and shows Paperclip's own web UI in a native window.

## The goal

PaperclipDesk exists to **create AI companies quickly and to run them professionally**. A feature belongs here when it
serves one of the two: setting a company up (templates, the wizard, the assistant) or running it day to day
(connections, the server, oversight, automation). An integration of another tool passes the same test, and Paperclip
stays the one place where companies, agents and tasks live; other tools connect to it instead of keeping a second copy.

## The core approach

**One window, a shell webview and one webview per open connection.** The Rust host lays them out by hand:

- **shell webview** (`shell`) — the menu bar and the app's own pages, served by Tauri from the local bundle: connection and log. The settings are
  no page: the gear menu at the right of the bar, and panels it opens over whatever is in front.
  It is the only webview with access to the app's commands.
- **Paperclip webviews** (`paperclip-N`) — Paperclip's web UI, one webview per open connection, loaded from the
  server's origin. Each is locked to that origin, opens every other link in the system browser, keeps its session in
  a browser profile of its own per connection, and has no capability at all.

Several remotes can be open at once, next to the one local server. One connection is in front; the others stay open
with their webviews hidden; the connection chip at the right of the menu bar switches between them. The shell draws the
menu bar: Paperclip's menus at the left, the first of them the company menu, the connection, the bell and the gear at the
right. While Paperclip is the main view, the shell is only that bar and the connection in front fills the window below
it; while a menu or a panel is open, the shell lies over Paperclip, see-through wherever it draws nothing. For the app's own pages the shell fills the
window. The host owns all state, the entries of the menu bar included. It sends the shell a snapshot whenever something
changes, and the shell renders what the snapshot says.

**The local server is a child process.** The host starts the bundled Node.js with the Paperclip server and its embedded
PostgreSQL, watches its health, and ends it with the app. Nothing of Paperclip is reimplemented here.

## Language

All documentation, comments, commit messages and diagram labels are written in **English**. The texts in the code are
German: they are the keys of the translations, see [Translations](#translations).

## Stack

| Layer | Technology |
| --- | --- |
| Host | Tauri 2 (Rust) in `crates/paperclipdesk`, WebView2, `unstable` feature for several webviews in one window |
| UI | React 19, TypeScript, Vite, in `ui` |
| UI kit | shadcn/ui on Radix, Tailwind v4 |
| Tests | `cargo test` (host); the UI is type-checked and linted with oxlint |

## Commands

```bash
npm run dev                 # the app from source, with hot reload
npm run check               # clippy, Rust tests, UI build, lint: run it before every commit
npm run build               # release build without an installer
npm run dist                # release build with the NSIS installer
npm run app:install         # build and copy to %LOCALAPPDATA%\PaperclipDesk, with a Start menu entry
npm run prepare-server      # stage the pinned Paperclip server and Node.js under build/
npm run bundle-server       # bundle the staged server into one file again; prepare-server does it too
npm run prepare-server-ui   # build Paperclip's web UI into the staged server
npm run pack-server         # pack the staged server into the archive a release build downloads
npm run server-catalog      # sign and publish the list of server packages the app may install; needs gh and SERVER_CATALOG_SIGNING_KEY
npm run licenses            # rewrite THIRD_PARTY_LICENSES.txt; needs cargo-license
npm run catalog             # read Paperclip's template catalog into ui/src/panels/templates.json and Clipmart's free templates into clipmart.json, the collections of agents and skills into collections.json and the icons of all of them into icons.json; needs a GitHub token or gh
```

`prepare-server` and `prepare-server-ui` are needed once before the first `npm run dev`, and again after the pinned
server version changes.

**After moving or renaming the repository folder, run `cargo clean`.** The build cache keeps absolute paths, and the
Tauri build script fails on the stale ones with "failed to read plugin permissions".

## Project layout

| Path | Contents |
| --- | --- |
| `crates/paperclipdesk/src/client.rs` | The state of the window, the layout of the webviews, starting and stopping connections |
| `crates/paperclipdesk/src/main.rs` | The commands the shell may call |
| `crates/paperclipdesk/src/menu.rs` | What is in the menu bar and what its entries do; `ui/src/shell/MenuBar.tsx` draws it, `SettingsMenu.tsx` is the gear |
| `crates/paperclipdesk/src/companies.rs` | The companies of the Paperclip in front, read through its page so its session stays there; template preview and import |
| `crates/paperclipdesk/src/assistant.rs` | The AI assistant: the user's Claude Code CLI, run without tools, settings or project |
| `crates/paperclipdesk/src/github.rs` | The search for company packages on GitHub and its token in the Windows credential store |
| `ui/src/panels/Templates.tsx`, `templates.json`, `clipmart.ts`, `clipmart.json`, `collections.ts`, `collections.json`, `icons.json` | The template page and the snapshots `npm run catalog` writes: Paperclip's catalog, Clipmart's templates, collections of single agents and skills on GitHub, and the icons of their sources; `clipmart.ts` builds the package of a Clipmart template the way its download does, so the app never loads anything from clipmart.ai; `collections.ts` fetches the files of a collection's agents and skills for the wizard, pinned to the snapshot's commit and SHA-256, and reads a `live` collection from its default branch once per run, so it always offers the newest agents there, and a repository with skills the GitHub search found when it is picked; `collection-agent.ts` turns an agent file into its entry for both the snapshot and the live read; it and the wizard fill the window and run before a connection, `NeedsPaperclip.tsx` starts the local server once they need it |
| `ui/src/components/data-table.tsx` | The table with search, filters and sorting the template page and the wizard use |
| `ui/src/shell/NotificationBell.tsx`, `ui/src/lib/notifications.ts` | The bell: Paperclip's inbox of the company in front, and every toast the app showed; import `toast` from `notifications.ts`, not from sonner |
| `ui/src/panels/Wizard.tsx`, `wizard/` | The company wizard; `wizard/compose.ts` puts the draft together as a company package, `wizard/assistant.ts` writes the assistant's prompt and reads its proposal |
| `crates/paperclipdesk/src/shortcuts.rs` | The keys of the actions, caught in every webview before its page sees them |
| `crates/paperclipdesk/src/server.rs`, `server_package.rs` | The local server process, the download of its package and the signed list of newer versions |
| `crates/paperclipdesk/src/instance.rs` | The local instance: `config.json`, `.env`, reset |
| `crates/paperclipdesk/src/connection/` | Saved connections, the check of a remote, what the Paperclip webview may open |
| `ui/src/App.tsx` | Which page or panel is shown; pages are in `ui/src/pages`, the settings panels in `ui/src/panels` |
| `ui/src/lib/client.ts` | Every command and type the shell shares with the host |
| `scripts` | Staging and packing the server, the local install script |
| `release-notes` | One file per app version; the release workflow publishes it |

## Hard rules

1. **The Paperclip webview gets no access to the app.** The capability in `capabilities/default.json` names the `shell`
   webview only. Never widen it to the window or to a remote origin.
2. **Every command is declared three times**: the function in `main.rs` with its entry in `generate_handler!`, the name
   in `build.rs`, and `allow-<name>` in `capabilities/default.json`. A command missing from the last two compiles and
   then fails at run time.
3. **The Paperclip webview stays on its origin.** Navigation elsewhere and new windows open in the system browser.
4. **Nothing is downloaded without a checksum.** A release build fetches the server package for its pinned version and
   checks it against the SHA-256 compiled into the app; a newer version the user picks it checks against the SHA-256 in
   `server-versions.json`, a list it accepts only with a signature of the key in `server-catalog.pub`. A collection's files are checked against the snapshot's SHA-256,
   or for a `live` collection and a repository with skills the search found against the Git blob SHA its branch named
   when the app read it.
5. **The local server must not outlive the app**, and neither may its PostgreSQL. A worker left behind holds the
   database's shared memory and the next start fails; `kill_stale_postgres` ends what belongs to this app's own server.
6. **User data is never deleted silently.** A reset asks first and offers a backup.
7. **Third-party licenses ship with the app.** `THIRD_PARTY_LICENSES.txt` is committed, goes into the installer and
   opens from the About box in the Help menu. Run `npm run licenses` after a dependency was added, removed or updated.
8. **No telemetry.** The app talks to the Paperclip it is connected to and to GitHub for updates, the server package, the list of newer
   server versions while the server settings are open, and,
   with the user's token or that of their GitHub CLI, the template search, the search for repositories with a `SKILL.md`,
   and the avatars of what it found; a found repository with skills it reads from its default branch once the user picks it. When the wizard creates a company
   with agents or skills of a collection, it fetches their files from raw.githubusercontent.com, at the snapshot's commit and checked
   against the snapshot's SHA-256. A `live` collection it reads from api.github.com once per run when the template page or the
   wizard opens: the head of its default branch, and the agent files changed since the snapshot. Only when the user turns the AI assistant on does it ask Claude, through
   the user's own Claude Code CLI, and then only with what the user wrote in the wizard and the template catalog.

## The Paperclip server version

`package.json` pins it under `paperclip.server`. A build from this repository uses the server staged under `build/`. A
release build has no server inside: it downloads the package for its pinned version on the first local start.

A newer server the user can install from the server settings, from the list `npm run server-catalog` publishes in the
release `server-catalog`: `server-versions.json` with each packaged version and its SHA-256, and `.sig` with its
signature, which the app checks with the public key in `crates/paperclipdesk/server-catalog.pub`. That key is not the
updater's: the list is signed next to packages built from Paperclip's code, and a key stolen there must not sign app
updates. The private key is the secret `SERVER_CATALOG_SIGNING_KEY` of the environment `server-catalog`, and its
local copy `~/.tauri/paperclipdesk-server-catalog.key` has no password. The app offers only
versions newer than the one it runs, because the new server migrates the database for good, and copies the data first
if the user keeps the backup switched on. The choice is `server_version` in `client-settings.json`, set only by the
upgrade itself; an app update whose pinned version is newer runs that one instead. `PAPERCLIP_SERVER_VERSION` makes
`prepare-server`, `prepare-server-ui` and `pack-server` build another version than the pinned one.

`prepare-server` also bundles the server into `dist/index.bundle.mjs`, which starts several seconds sooner than its
thousands of modules; the app starts it when it is there and `dist/index.js` otherwise. A package that was published
before the bundle existed keeps starting from `dist/index.js` until the next server version.

## Where data lives

| Path | Contents |
| --- | --- |
| `%APPDATA%\Paperclip` | `client-settings.json`, `connections.json`, logs, `paperclip-server.pid` |
| `%APPDATA%\Paperclip\instances\default` | The local server's database, companies, secrets, `config.json` and `.env` |
| `%LOCALAPPDATA%\Paperclip\webview` | Browser profiles, one per connection |
| `%LOCALAPPDATA%\Paperclip\app-server` | The downloaded server package |

If a Paperclip CLI installation exists in `~/.paperclip`, the app uses that as the server's home instead.

Environment variables move the data. **Use them for every test run**, so a test never touches a real installation:

| Variable | Effect |
| --- | --- |
| `PAPERCLIPDESK_USER_DATA_DIR` | Absolute path for settings, connections, logs and browser profiles |
| `PAPERCLIP_HOME` | Absolute path for the server's data |
| `PAPERCLIPDESK_REQUIRE_ISOLATED_DATA=1` | Refuses to start unless both paths above are set and neither is a real installation |

## Translations

Eleven languages, German first because the code is written in it.

- **Host**: `i18n::t("German text")` and `i18n::f("… {}", &[&value])`. `src/i18n/de.rs` lists every text; each other
  language is an array of the same length in the same order. A test fails when a text handed to `t` or `f` is missing
  from `de.rs`.
- **UI**: `t('German text')`. `ui/src/i18n/de.ts` lists every text and gives the `Message` type; each other language
  is a list of the same length in the same order, checked by the compiler.

A new text is appended to all eleven files, at the same position.

## Code style

- Rust: `cargo clippy -- -D warnings` is a gate. Follow the code around the change: long lines, expression bodies,
  doc comments that say what a thing is for.
- UI: `npm --prefix ui run lint` is a gate. Pages get `PageProps` from `App.tsx`; they call the host only through
  `ui/src/lib/client.ts`.
- Comments only when the _why_ is non-obvious. Never describe what the code does.
- No features, abstractions or error handling beyond what the task needs.
- No compatibility shims for names or files that were removed.

## CI and releasing

The `CI` workflow runs on every push to `main` and on every pull request, on Windows: lint and build of the UI, then
clippy and the Rust tests. Dependabot alerts report vulnerable dependencies in the repository's Security tab; it opens
no pull requests, so updates are made by hand.

The `Deploy Release` workflow runs on manual dispatch and on every push to `main` that changes the app version in
`tauri.conf.json` or a file under `release-notes`. A version that has its tag already is skipped. It tests the app,
publishes the server package for the pinned version once as a release of its own (`server-v<version>`), builds and signs
the NSIS installer, writes `latest.json` for the updater, tags `v<version>` and creates the GitHub release.

It needs the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the matching
public key is in `crates/paperclipdesk/tauri.conf.json`. The app version comes from the same file, and
`release-notes/v<version>.md` must exist.

The `Server Packages` workflow runs every day and on manual dispatch, with a version or without one for Paperclip's
latest release; the daily check runs on Linux and only a missing package starts a build. Its jobs keep Paperclip's code
away from secrets: `build` runs Paperclip's install scripts on Windows without any secret or write token and hands the
package on as an artifact, `publish` creates the `server-v<version>` release from it, and `sign` writes and signs the
list of server versions. `sign` runs in the environment `server-catalog`, which holds `SERVER_CATALOG_SIGNING_KEY`
and waits for a reviewer, so no version reaches the users before someone approved it. A manual dispatch for a version
that is packaged already signs the list again.

## Known rough edges

- Keyboard shortcuts are caught with WebView2's `AcceleratorKeyPressed` in every webview (`shortcuts.rs`), so they work
  wherever the focus is inside the window. Keys posted as window messages never reach that event; testing a shortcut
  needs real input.
