# PaperclipDesk

A Windows desktop client for [Paperclip](https://docs.paperclip.ing/). It starts the Paperclip server on this machine
or connects to a remote one, and shows Paperclip's own web UI in a native window.

## The core approach

**One window, a shell webview and one webview per open connection.** The Rust host lays them out by hand:

- **shell webview** (`shell`) — the app's own pages, served by Tauri from the local bundle: connection, settings, log.
  It is the only webview with access to the app's commands.
- **Paperclip webviews** (`paperclip-N`) — Paperclip's web UI, one webview per open connection, loaded from the
  server's origin. Each is locked to that origin, opens every other link in the system browser, keeps its session in
  a browser profile of its own per connection, and has no capability at all.

Several remotes can be open at once, next to the one local server. One connection is in front; the others stay open
with their webviews hidden; the Connect menu switches between them. The shell draws the menu bar. While Paperclip is
the main view, the shell is only that bar and the connection in front fills the window below it; while a menu is open,
the shell lies over Paperclip, see-through wherever it draws nothing. For the app's own pages the shell fills the
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
npm run prepare-server-ui   # build Paperclip's web UI into the staged server
npm run pack-server         # pack the staged server into the archive a release build downloads
npm run licenses            # rewrite THIRD_PARTY_LICENSES.txt; needs cargo-license
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
| `crates/paperclipdesk/src/menu.rs` | What is in the menu bar and what its entries do; `ui/src/shell/MenuBar.tsx` draws it |
| `crates/paperclipdesk/src/server.rs`, `server_package.rs` | The local server process and the download of its package |
| `crates/paperclipdesk/src/instance.rs` | The local instance: `config.json`, `.env`, reset |
| `crates/paperclipdesk/src/connection/` | Saved connections, the check of a remote, what the Paperclip webview may open |
| `ui/src/App.tsx` | Which page is shown; pages are in `ui/src/pages` |
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
   checks it against the SHA-256 compiled into the app.
5. **The local server must not outlive the app**, and neither may its PostgreSQL. A worker left behind holds the
   database's shared memory and the next start fails; `kill_stale_postgres` ends what belongs to this app's own server.
6. **User data is never deleted silently.** A reset asks first and offers a backup.
7. **Third-party licenses ship with the app.** `THIRD_PARTY_LICENSES.txt` is committed, goes into the installer and
   opens from the Help menu. Run `npm run licenses` after a dependency was added, removed or updated.
8. **No telemetry.** The app talks to the Paperclip it is connected to and to GitHub for updates and the server package.

## The Paperclip server version

`package.json` pins it under `paperclip.server`. A build from this repository uses the server staged under `build/`. A
release build has no server inside: it downloads the package for its pinned version on the first local start. A newer
server therefore arrives with a new app version.

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

## Known rough edges

- Menu entries have no keyboard shortcuts yet: it is untested whether they fire while a webview has the focus.
