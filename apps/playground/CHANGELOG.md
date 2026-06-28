# Changelog

## [Unreleased]

### Added

- **Explorer now supports drag/drop upload, drag-move, path copy, and compare.**
  Dropped files write exact owner bytes, in-tree drags use owner rename frames,
  and compares open Monaco blob-vs-blob text diffs instead of raw git diff text.
- **Explorer rows now support copy, cut, paste, and duplicate.** The file tree
  keeps an ephemeral page clipboard, but every paste/duplicate mutation routes
  through owner `copy` or atomic `rename` frames with VS Code-style copy names.
- **Source Control can now stage, unstage, discard, and commit through the owner.**
  SCM actions call the owner git RPC, resolve commit identity in the owner, and
  refresh the owner status feed after ack instead of mutating rows optimistically.
- **Explorer file rows can now download exact working bytes.** The playground
  serves a full-byte owner read bridge for single-file downloads, so over-cap and
  binary files save from the owner instead of the capped page snapshot.
- **Explorer rows now show rifty-git decorations.** The playground subscribes to
  the owner-pushed SCM status feed and tints changed files/folders with honest
  M/U/A/D badges without reading `.git` from the page snapshot.
- **Source Control has a read-only rifty-git panel.** The sidebar can show
  Staged/Changes groups from the shared owner status feed plus branch and commit
  history read through the owner git RPC channel.
- **Source Control rows now open blob-vs-blob Monaco diffs.** The page fetches
  `HEAD:<path>` blobs through the owner git RPC channel and compares them with
  the live working model, avoiding raw structured-LCS diff text.
- **Explorer mutations now have an owner-routed writable VFS target.** `OwnerRpcFs`
  sends async create, rename, copy, and delete frames to the workspace owner and
  resolves only after the read-only snapshot reflects the owner result.
- **Playground SCM now has an owner-pushed rifty-git status feed.** The owner
  debounces status recomputes from existing snapshot mutation triggers, skips
  unchanged deltas, serves late subscribers, and exposes a page path→code cache.
- **Playground SCM can now call git in the workspace owner.** A keyed
  page↔owner `rifty:git` RPC bridge exposes real `@riftydev/git` status, show,
  diff, log, branch, add, unstage, commit, restore, and reset operations without
  reading `.git` from the page snapshot.
- **Explorer owner VFS frames can now rename and copy paths.** The owner-side
  write bridge applies no-clobber recursive rename/copy mutations and fails
  loudly after owner exit instead of routing them through a stale fallback.
- **Vite 7 production build/preview (ADR-0173).** The default Vite template now
  supports `vite build` -> real hashed/minified `dist/` and `vite preview` ->
  `/preview/4173/` serving that built bundle through the existing SW bridge.
  The production preview is registered as `source:'preview'` and auto-selected
  when it starts; Vite 8 build/preview stay loud-rejected.

### Changed

- The default Vite template now installs `vite@^7.0.0` plus
  `@rollup/wasm-node@4.62.2`; snapshot baking asserts the Rollup and
  `@rollup/wasm-node` versions remain lockstep. The opt-in `vite8` template
  keeps `vite@8.0.16` and its own baked snapshot.
- The TypeScript starter now declares its own `typescript@5.9.3`
  devDependency and uses a dedicated baked node_modules snapshot instead of the
  plain Vite snapshot.

### Fixed

- **SCM now sees Monaco editor edits immediately.** Opening Source Control flushes
  pending editor writes before requesting owner git status, and dirty gutters can
  mark changed lines from the local buffer while the owner status feed catches up.
- **Saved projects now re-root the workspace owner after Save.** A plain
  Save-as-project respawns the owner at `/projects/<id>`, so Explorer, SCM, git
  gutters, terminal cwd, and dev-server reads agree on the saved project root.
- **Terminal Problems stays pinned to the left.** The Problems tab sits before
  terminal session tabs, and empty Enter in running/idle terminals submits a
  blank shell line without showing `terminal is busy` or extra blank prompt rows.
  The Problems count badge now keeps its number vertically centered, and closing
  the active idle terminal focuses the previous terminal tab.
- **Real Vite CLI children no longer advertise unwired stdin as a TTY.** `.bin`
  and `node <file>` children keep TTY stdout/stderr for ANSI output but expose
  non-TTY stdin until terminal stdin forwarding lands, so Vite dev skips
  readline shortcuts instead of tripping the loud stdin guard.
- **Starter templates now open as initialized git repositories.** Every
  template root seeds a real `Initial commit` on `main` plus a project
  `.gitignore`, and starter-generated `package-lock.json` is folded into that
  baseline, so terminal `git status` starts clean and later reports only the
  user's edits while ignoring generated `node_modules`/build output.
- **Preset switches no longer replay stale debounced program edits.** A pending
  program-tab write is discarded before reseeding a picked starter, so an edit
  from the previous template cannot clobber the freshly seeded `/src/main.*`
  entry after the switch.
- **TS diagnostics refresh after project re-init.** When starter/dev-server
  changes bump `tsProjectRevision`, the TS-LS client replays open documents and
  immediately refreshes diagnostics for them, so Problems/markers do not stay
  stale until the next keystroke.
- **TS-LS init failures are visible in Problems.** Missing or broken workspace
  TypeScript now surfaces as an actionable Problems diagnostic instead of only a
  console warning.
- **TS-LS provider fallbacks stay quiet when workspace TypeScript is unavailable.**
  Monaco provider calls now return empty editor results for the same missing or
  unreadable workspace TypeScript errors that Problems already reports, so
  production boot smoke does not see duplicate page errors.
- **TypeScript starter restores its own dependency snapshot after starter switches.**
  The owner no longer reuses a same-root Vite install stamp against the previous
  package.json, so workspace `node_modules/typescript` is present before TS-LS
  initializes.
- **Project chip no longer labels a broken active project as scratch.** The
  playground now rejects project-index states whose `activeId` points at no saved
  project, names active scratches from their Starter label (for example,
  `Project files scratch`), and exposes a missing project instead of falling back
  to scratch copy; the top-bar chip now also pins the app font instead of
  inheriting the browser's button default.
- **New terminal tabs now take keyboard focus immediately.** Creating a
  terminal switches back to the terminal view, focuses the active xterm instance,
  and keeps the terminal DOM renderer pinned to the JetBrains Mono metrics.
- **Terminal command overlays no longer leave colored command rails or cover output.** The
  playground terminal no longer mounts the command-block rail/preview or sticky current-command
  pill, and the xterm viewport no longer reserves the old rail gutter.
- **Terminal caret and palette now read closer to modern integrated terminals.** The playground
  terminal uses a slim light bar caret, a matte console surface, denser type, and an explicit
  ANSI palette instead of the old lime block cursor on the panel background.
- **TypeScript starter instant boot keeps real Vite deps.** The starter now
  declares the Vite snapshot owner separately from its template id and keeps its
  install deps in lockstep with the shared Vite snapshot, so `vite` no longer
  starts without `node_modules` after a starter pick.
- **TS-LS Monaco providers no longer recurse through Solid path accessors.**
  `EditorHost` resolves provider model paths through its cached current program
  path, so program-tab edits can produce fresh rifty-TS markers instead of
  `Maximum call stack size exceeded`.
- **TypeScript go-to-definition activates declaration tabs.** Monaco's real
  `F12`/go-to-definition action now routes through `EditorHost` tab selection,
  so starter declarations such as `@rifty/example-types/index.d.ts` open as the
  active editor instead of being created as an inactive background model.
- **Production TypeScript editor intelligence boots the real worker.** The
  TS-LSP child bootstrap now keeps the package endpoint in the production bundle,
  and provider calls wait for project init/replay before asking for diagnostics
  or definitions.
- **Vite 7 production builds accept esbuild supported flags.** The build bridge
  now forwards Vite's `supported.dynamic-import` option to the real esbuild-WASI
  transform instead of loud-rejecting the build.
- **Honest `vite` command dispatch (ADR-0174).** `vite` is no longer an
  owner-registered curated command: shell resolution reaches
  `node_modules/.bin/vite`, so the installed Vite CLI owns flags, help/version,
  config loading, build, and preview. The generic `.bin` child path is now
  server-capable (`serve:true` + node-entry lifecycle), and the owner only mirrors
  real child listen events into the playground preview/dev-server UI.
- **Vite npm scripts now use the same honest CLI path.** `npm run vite` executes
  the seeded package script through shell/bin resolution instead of the old
  co-resident dev-server shortcut; editor writes are forwarded into the active
  real Vite CLI child for HMR, and the late-listen lifecycle poll no longer keeps
  successful `vite build` children alive until the drain cap.
- **Project files edits update the live preview again.** The default Vite 7
  template keeps the native HMR bridge enabled (Vite 8 remains HMR-off per
  ADR-0161), and the dev-server child no longer feeds native `server.watcher`
  change events back through the synthetic editor-write invalidation path. A
  Monaco edit to `src/main.js` now reaches the iframe text instead of either
  spamming `module invalidation failed ... Maximum call stack size exceeded` or
  silently waiting for a manual reload.
- **From-scratch starter dev lines keep their freshly installed deps.** Switching
  from the default Vite starter to a from-scratch starter (`Express + SQLite`,
  `Socket Lab`) no longer deletes `node_modules` between the explicit
  `npm install` and the following `npm run dev`; the dev-server child now sees
  packages such as `express` and `ws` that the terminal just installed.
- **Parallel playground owners no longer share one OPFS workspace.** Each page
  session now scopes the owner VFS under a stable workspace id, so full e2e runs
  cannot have one test wipe another test's `/scratch`, `/projects`, or project
  index while the UI mirror still points at the old owner state.
- **Saving a project no longer copies derived stamped `node_modules`.** A Save
  now persists the scratch source tree but skips install/snapshot-restored deps,
  so the project-index ack is not held behind tens of MB of dependency copying;
  the next boot restores deps through the normal install/snapshot path, while
  unstamped user-created `node_modules` content is still copied.
- **Project Save is resilient to owner-bridge startup races.** The project-index
  bridge now has an applied ack (sync commit) separate from the durable flush ack,
  retries save frames until the owner listener is live, and treats a replayed
  already-committed save as idempotent.
- **Dirty scratch prompts survive late owner index publishes.** A real editor
  write can no longer be overwritten by a stale `dirty:false` project-index
  mirror publish before the user switches projects.
- **Project switches wait for the durable active-root ack and serialize owner
  respawns.** Switching between saved projects no longer tears down the owner
  after a timed-out mirror poll or starts a second switch before the first owner
  respawn is fully rewired.
- **Project switches rebind terminal sessions to the respawned owner.** Existing
  terminal tabs now reopen their `pty` session ids against the new owner root,
  retry `pty:open` until the owner replies ready, and release switch serialization
  when the dev server reports booted instead of waiting for the long-running
  `vite` foreground command to exit.
- **Starter dev-server restarts finish before preset boot continues.** Picking a
  starter while Vite is already running no longer races the restart against the
  remaining preset flow or a still-busy terminal, which could leave the console at
  `terminal is busy` instead of the new root's boot log.
- **TS-LSP replies no longer cross-match between page clients.** Request ids are
  allocated across the page realm instead of per client instance, so a late
  `ack` from one client cannot satisfy a hover/rename/completion request from
  another during owner respawns or provider re-registration.
- **Vite 8 sandbox honesty follow-ups (PR #55 audit).** (a) Vite 8 `build`/`preview`/`optimize` no longer silently boot the dev server; with ADR-0174 they route through the real installed CLI, with remaining Rolldown/runtime ceilings tracked in `backlog/playground/vite8-production-build-preview`. (b) The `[real-vite/worker] hmr bridge ready` log + the bridge token are no longer emitted when HMR is disabled (Vite 8 template) — no false "bridge ready" signal for a bridge that is never installed. (c) `PreviewPanel` header comment corrected — with HMR off (ADR-0161) an editor save re-transforms on next fetch but pushes nothing and non-editor changes aren't watched, so seeing an edit needs a manual Reload (was: "file edits are refreshed by the iframe HMR client itself"). (d) compat `incompatible-packages.md` esbuild/rollup rows corrected — Vite 8 transforms via oxc and parses via `rolldown/parseAst`, so those shim overlays are off the Vite 8 path. New `vite8-*` backlog items track the remaining divergences (watcher-over-VFS, TS/JSX parity coverage, dead esbuild/rollup overlays, lightningcss-wasm init, dev-server UX parity).

### Documented

- **PR #76 review gaps recorded explicitly.** Added backlog contracts for the
  playground dev-server synthetic watcher branch and the dev esbuild warning
  path, with `TODO(backlog:)` seams in the worker code.

### Changed

- **Node-faithful boot — the dev line no longer installs (ADR-0135 corrected).** `vite`
  / `npm run dev` now RUN the program; they never fetch deps as a side effect (real
  npm's `npm run dev` does not install — a missing `node_modules` is a loud
  `Cannot find module`). `node_modules` is a precondition, settled before the dev line:
  from-scratch presets boot `cd /workspace && npm install && <dev>` — an explicit,
  honest `npm install` is the only dep source (a fresh preset starts clean → real cold
  install, no EBROKENLOCK); instant presets pre-seed deps from the baked snapshot into
  the owner store at project-seed (`restoreInstantDeps`, a RESTORE not an install), so
  the dev line just runs. Removed the dev-server-boot's auto-`install()`/restore and the
  template-keyed clean; the from-scratch cold-start lives in the `npm install` command,
  the instant restore in `restoreInstantDeps`. m1 (instant: no install line) + m7 +
  fullstack-demo (from-scratch: explicit `npm install`) all green.

### Fixed

- **Project-files preview no longer black-screens on Vite 8.** The `project-files`
  preset rendered a blank `#app` (`Unexpected token ':'`): its `freshUrl()` appended a
  `?t=` cache-bust to the `project.json?import` URL, and Vite 8 serves a QUERIED `.json`
  raw (only a bare specifier / `?import` is JSON-transformed — verified head-to-head vs
  real `vite@8.0.16`), so the entry imported raw JSON as an ES module and threw. The
  JSON import is no longer cache-busted (Vite 5 masked this because `import.meta.hot` was
  falsy with HMR off; Vite 8 always injects it). rifty stays faithful to Vite 8 — the bug
  was in the demo source. New CI-active regression in `tests/e2e/m7-preview-sw.spec.ts`
  drives the real preview iframe and asserts the JS+JSON module graph RENDERED (the prior
  m7 only checked the served shell HTML, so a black screen passed).
- **The launcher remembers its tab** (ADR-0165 §9). The active tab (Starters / Projects)
  is persisted to `localStorage` (`rf.launcher.tab`) and restored on the next open —
  EXCEPT with zero saved projects, where it always opens on Starters (nothing to switch
  to, only a starter to pick). New solid-free, storage-injected `glue/launcher-prefs.ts`
  (`initialLauncherTab`/`loadLauncherTab`/`saveLauncherTab`), unit-tested.

### Fixed

- **Stale TypeScript Monaco providers no longer surface lifecycle disposal as a page
  error.** Provider calls now treat an exact `ts-lsp client disposed` from an obsolete
  LS client as cancellation-shaped empty results, keeping prod boot smoke clean while
  preserving real TS failures.
- **Problems is now a permanent terminal-tab, and the TypeScript starter boots clean.**
  The old Terminal/Problems view switcher could leave terminal output visible over the
  Problems panel, and the TS starter shipped with built-in diagnostics (`count` as a
  string, a missing `formatWidgetName` import, and no `vite/client` types for HMR), so
  user edits did not produce a clear before/after signal.
- **TypeScript starter UX now survives owner/dev-server rebinds.** TS LS request ids
  are globally monotonic across client instances, starter-owned declaration packages
  under `node_modules` are re-seeded in the owner/dev-server after install snapshot
  restore, the LS reinitializes once the owner reports the dev server running, and
  program-tab writes are debounced so Monaco edits do not flood the terminal with
  one Vite HMR line per content event.
- **Starter picks now seed boot-critical template files before Vite starts without
  clobbering installed deps.** A mid-session switch to the TS starter could update
  `src/main.ts` while Vite still served the old `index.html` pointing at
  `src/main.js`; the synchronous owner seed now refreshes the starter files but leaves
  the root `package.json` to durable reset / npm install, so installed CLIs survive
  reload.
### Changed

- **Generic `npm run <script>` now routes through the shell `.bin` path in the owner.**
  Dev-line script names (`dev`/`vite`/`start`, per template) still boot the
  co-resident dev server, but arbitrary scripts such as `format` and `lint` now
  run in a child shell with the same owner-worker `.bin` executor instead of
  being rejected or accidentally treated as dev-server aliases. This is the
  script path needed for `npm run format` / `npm run lint` with real
  Prettier/ESLint installs. Arguments after the script name are forwarded only
  after npm's `--` separator, so `npm run lint -- --fix` reaches the installed
  ESLint CLI while `npm run lint --fix` stays an npm CLI flag like real npm.
  Forwarded args are quoted before the child shell reparses them, preserving
  literal `$HOME`/glob patterns for formatter/linter file selectors.
  `pre<script>` / `post<script>` hooks now run in npm order (without
  main-script forwarded args) and stop on the first non-zero exit.
- **Foreground CLI sessions now pass TTY metadata into child Node workers.**
  `.bin` and `node <file>` children receive stdin/stdout/stderr TTY flags, so
  packages that inspect `process.stdout.isTTY` (including ESLint formatting)
  see the same terminal shape as the owning shell.
- **`npm install` shell preflight now preserves npm-client ceilings.**
  Non-registry CLI specs such as `.`, `file:../x`, `owner/repo`, git/URL tarballs,
  and npm aliases throw the same named `NotImplementedError` before package.json
  is written, root lifecycle scripts are not swallowed by the empty-install
  fast path, and malformed dependency maps no longer collapse to a successful
  empty install.
- **`npm run` reads only scripts, not install metadata.** A valid script can run
  even when `dependencies` contains an install-only unsupported/nested entry
  that `npm install` would loudly reject.

### Fixed (CI-red + visual regressions, ADR-0165)

- **The launcher / dialogs / projects-tab / starters-tab / project-cards / row-menu /
  toast-undo were UNSTYLED** — only the chip + degraded banner + status got CSS, so the
  launcher rendered as a plain block at the page bottom instead of a centered modal.
  Added the full `theme.css` section (1040×624 launcher modal + veil, 400px dialog cards
  with lime/amber/danger tones, scratch banner, 2-col project cards, row menu, ACTIVE
  badge + `soon` pill, button tones) keyed to the existing design tokens, + a `theme.test.ts`
  guard so the modal styles can't silently regress again.
- **A switch never persisted `activeId` to the index** — so the respawned owner
  re-published the STALE `activeId` and `hydrateIndex` reverted the switch (a race that
  reddened CI's "Save…then continue" e2e), and a reload booted the wrong project. New
  `index-set-active` frame persisted to the current owner BEFORE teardown
  (`awaitActiveDurable` gates the respawn on it). Switches are now durable across the
  respawn and a reload.
- **The store toast never auto-dismissed** — it lingered forever and, at top-right
  (z-index 1000), sat over the launcher's close button. It now self-clears (delete-Undo
  toasts persist for the grace window so Undo stays clickable).

### Fixed (post-review hardening, ADR-0165)

- **Named-project "Reset to starter" is now a REAL on-disk restore (fidelity).** The
  Projects-tab row menu offered Reset on every saved project and the dialog promised
  "restores the clean starter files… can't be undone", but `onConfirmReset` re-seeded
  only the scratch — a named-project reset just toasted + bumped `editedAt` while the
  tree was untouched (a lying happy-path). New owner frame `index-reset-project`
  (`resetProjectToStarter` wipes + re-derives `/projects/<id>` from the project's
  starter, read authoritatively from the index); when the reset target is the ACTIVE
  root the page also resets the program editor + reboots the dev server. Owner index
  re-seeds now republish the FILE snapshot (`serveProjectIndex(refresh=publishSnapshot)`)
  — they bypass `onVfsWrite`, so without it even the scratch reset left a stale live view.
- **Dirty-scratch switch dialog: both resolutions were broken.** "Discard & continue"
  re-invoked the dirty-guarded transition → the dialog re-opened and `activeId` never
  flipped, so the owner respawned at the new root with the OLD template/starter; "Save
  scratch, then continue" saved the draft but never continued. Added unguarded
  `confirmSwitchTo`/`confirmPickStarter` store transitions; `applyPendingTarget` uses
  them, and `onConfirmSave` resumes a stashed pending switch AFTER a durability handshake
  (`awaitProjectDurable` — the owner publishes the index only post-flush, so the cpSync'd
  tree is durable before the switch hard-kills the owner).
- **Durable delete ordering could brick boot.** `deleteTree` removed the tree BEFORE
  persisting the index drop; a crash mid-flush left an indexed-but-missing tree →
  `recoverIndex` case (D) throws on every boot (unrecoverable). Reordered to commit the
  index FIRST, then `rmSync` — a crash now leaves a case-(A) orphan that boot silently
  rolls back.
- **Deferred on-disk delete is eventually-consistent.** A delete posted during the owner
  teardown→respawn gap reached no listener and the project resurrected on the next
  publish; pending deletes are now tracked + re-fired on each owner re-wire and cleared
  once the published index reflects them.
- **Save allocates a collision-free id** (`crypto.randomUUID`, `Math.random` fallback) —
  a collision made the owner throw `already exists` while the page optimistically pointed
  `activeId` at another project's tree.
- **Launcher: Escape closes the topmost overlay** (dialog → launcher) and the inaccurate
  "focus-trap close" suppression comment was corrected to match reality.
- **`awaitReady` is a real readiness gate** — it now resolves on the new owner's first
  published snapshot frame (was `setTimeout(0)`); `page-store.dirty()` is derived from the
  active scratch (the vestigial standalone signal is gone); owner/realVite root fallbacks
  `/workspace` → `/scratch`.

### Tests

- **e2e workspace-root specs migrated `/workspace` → `/scratch` (ADR-0165).** The
  active workspace root moved to the unnamed scratch (`/scratch`); seven specs hard-coded
  `/workspace` and broke (`cat: /workspace/...: No such file`). Updated the workspace-root
  paths in `m1-terminal-shell`, `node-command`, `owner-persistence-reload`,
  `owner-single-source-byte-identity`, `owner-snapshot-restore-exec`,
  `terminal-command-blocks`, `terminal-persistence` to the new root — no assertion weakened.
  The terminal-history file stays `/workspace/.rifty/terminal-history.json` (keyed to a
  constant via `createTerminalPersistence(WORKSPACE)`, unchanged by ADR-0165).

### Fixed

- **TypeScript starter Vite transforms now use real esbuild WASI output.** The
  playground's `esbuild` overlay used to return pass-through code plus `map: ''`;
  Vite's `.ts` transform then crashed on `JSON.parse(result.map)` before the
  `typescript-ls` starter could render. The dev-server child now installs a
  real `@esbuild/wasi-preview1` transform bridge (via `@riftydev/runtime-wasi`)
  before importing Vite, and normalizes the inline CLI sourcemap into Vite's JS
  API `{ code, map }` shape. Unsupported transform options now loud-throw
  `NotImplementedError('esbuild.transform.<option>')` instead of being silently
  ignored.

- **TS Monaco workspace edits are now atomic at the editor boundary.** Rename,
  code-action, and completion workspace edits first resolve every target Monaco
  model; if any target cannot be opened, the provider rejects instead of applying
  a partial project edit. Completion resolve also stops falling back to same-file
  text edits when TypeScript returns a workspace edit with unsupported commands,
  so the editor never pretends command side effects ran.

- **Rifty TS editor providers now consume the full edit/link wire shape.**
  Go-to-definition uses definition links (origin + target selection ranges);
  workspace edits preserve new-file creation through Monaco; model changes are
  tracked per Monaco model so edits in inactive/new files still write back to
  the owner; completion resolve now forwards editor format settings and visible
  TS metadata (deprecated/recommended/source display); code actions resolve edits
  lazily so browsing quick fixes does not create new-file tabs; and TS
  completion resolve applies workspace text edits through a Monaco command while
  code actions that need unsupported post-edit rename are not exposed as
  applyable editor actions; diagnostics carry a per-path generation guard so
  older async results cannot overwrite newer buffers or close/reopen cycles.

- **Fast foreground exits can no longer leave the terminal permanently busy.**
  The page-side pty client registers `openSession`/`exec` waiters before
  sending IPC frames, so a synchronous `pty:ready` or quick non-zero `pty:exit`
  cannot be dropped. This fixes the real ESLint failure path where the prompt
  was visible but the next typed command was routed as stale stdin.
- **TS diagnostics now appear on a slow (2-core CI) cold boot** (ADR-0166; fixes the chromium e2e `ts-language-service.spec.ts` timeout where the type-error marker never rendered). The page LS client's per-request timeout was 15s, but the LS endpoint serializes every frame behind the first `ts:init` — which on a constrained CI runner co-resident with the dev-server child takes tens of seconds (TS engine + ~3 MB lib over the relay + tsconfig over fs.* sync-RPC). So the `lsp-check.ts` open/diagnostics frames rejected at 15s before the service finished building, and the page never re-sent → no marker. Raised the default to 60s (warm requests still resolve in <1s, so the ceiling only bites a genuinely dropped frame, which then rejects loud). The endpoint-side serialization + out-of-program-honest-empty fixes live in `@riftydev/ts-language-service`.
- **Express `res.json`/`res.send` no longer crash with `TypeError: argument entity must be string, Buffer, or fs.Stats`** (express + sqlite preset, PROD build only). Each `?worker&url` child entry is self-contained, so it carries its OWN `@riftydev/io` `Buffer` copy; the kernel pre-entry hook had set `globalThis.Buffer` from the kernel-worker-entry copy, so `etag` (reads the global) rejected a buffer express built via `require('buffer')` (the child copy). The `kind:'url'` child bootstraps (dev-server-child, node-entry, real-vite owner) now call `installBundleLocalBuffer()` to pin the global to THIS bundle's copy — mirrors `runtime-js/worker-entry.ts`. DEV was unaffected (one shared ESM module instance), which is why the dev e2e never caught it; new PROD-build guard `tests/e2e-prod/buffer-realm-identity.spec.ts` + unit `bundle-local-buffer.test.ts`. Root (shared runtime classes duplicated per worker bundle) tracked in backlog/toolchain-build/worker-bundle-shared-runtime-dedup.
- **Editor program mirror + entry re-seed follow the active root and template entry (ADR-0165 §4).**
  `PROGRAM_MIRROR_PATH` was hardcoded `/workspace/src/main.js`; after ADR-0165 moved
  roots to `/scratch`|`/projects/<id>`, the editor program write + live HMR landed on
  a dead `/workspace` path the dev server never reads, and a starter pick that changed
  the template (Vite → an express/socket node-server) kept the prior `<root>/src/main.js`
  — so a node-server starter ran the STALE browser entry → `document is not defined`.
  The path is now derived from the active root plus the active template entry via
  `programMirrorPath(root, template)` (new solid-free `glue/program-path.ts`), threaded
  reactively into `EditorHost` (program-tab focus + the active program path it reports)
  and App's program write / seed / HMR. A TypeScript starter now edits
  `<root>/src/main.ts`, while a JS starter still edits `<root>/src/main.js`. A page
  `writeFile` is a non-idempotent OVERWRITE (unlike the owner's idempotent
  `seedProject`), so `seedWorkspaceOwner` re-seeds the entry with the picked starter's
  source on a template switch — the dev server runs the NEW server entry, not the stale
  browser one. Un-blocked `fullstack-demo.spec.ts` / `socket-lab.spec.ts` (node-server
  starters now boot their real server).

- **Page store is the single source of truth for the active id/root (ADR-0165 §4).**
  `App.tsx` derived `activeRoot()` from the interim `activePreset` signal
  (`rootForId(activePreset())`), so a cold boot keyed the workspace root + owner
  spawn at `/projects/project-files` — mistaking the boot STARTER id for a PROJECT
  id — and a switch left the page surfaces (snapshotFs, writeFile, presetBootLines,
  mode hint, command palette) pointing at the OLD root. Now `activeRoot()` follows
  `store.activeId()` (the truth: `scratch` on boot, a projectId after switch); the
  active STARTER (template / boot lines / `setDevConfig` / spawn `setup`) follows the
  store-derived `activeStarterId()` so a switch boots the destination project's
  template, never a stale one. The owner spawn `slug` now follows `store.activeId()`
  too. `page-store.hydrateIndex` preserves a local boot scratch when the owner's
  published index is still scratch-active but lacks a scratch entry (the owner does
  not model the scratch in its on-disk index until a Save), so the chip/banner/Save
  reflect the real `/scratch` tree from a cold boot. New e2e coverage:
  `project-boot-root.spec.ts` (boot root = `/scratch`, RED-checked against the old
  `rootForId(activePreset())`) and `project-switch.spec.ts` (a starter pick re-roots
  a fresh scratch and the dev server re-boots at the active root, surfaces following
  the store).

- **Dev-boot esbuild/rollup shim re-rooted onto the active root (ADR-0165 §4).** The
  `@riftydev/shadow-registry` shim files are keyed on the historical
  `/workspace/node_modules/...` path; ADR-0165 moved the dev root to
  `/scratch`|`/projects/<id>`, so `overlayShims()` was writing the shim to a dead
  `/workspace` path → the REAL native Rollup loaded → every Vite dev boot threw
  `platform 'rifty' arch 'wasm' not supported by the native Rollup build`.
  `overlayShims(root)` now re-roots each shim key onto the active root
  (`reRootShimPath`), so the Vite dev server boots at `/scratch`. The sibling editor
  program-mirror root/template-entry desync is closed by the program-mirror fix above.

### Changed

- **Shared `runForegroundChild` driver** (closes backlog/playground/owner-child-foreground-shared-driver). The owner `node <file>` executor and the `.bin` executor no longer each re-implement decode + stream + Ctrl-C-kill/mute + settle-on-exit (ADR-0155 §1 recorded the drift risk) — both ride `glue/run-foreground-child.ts`. The node executor passes its `rifty:node-listening` hook + preview-registry remove; the bin executor passes neither. Side benefit: the bin executor inherits the exit-listener-before-pre-abort ordering its inline copy lacked, so a `node_modules/.bin/<cmd>` launched with an already-aborted signal no longer hangs (kill() emits `'exit'` synchronously). The dev-server child keeps its own driver (resolves on a `rifty:dev-ready` message, not exit).

- **`node <file>` missing-entry diagnostic is now real Node's `MODULE_NOT_FOUND`** (closes backlog/runtime-js/node-entry-miss-node-shape). `resolveNodeEntry` no longer pre-checks existence (it just absolutizes the arg); a missing entry flows into `runNodeEntry` → the module loader, which emits Node's `Error: Cannot find module '<abs>' … { code:'MODULE_NOT_FOUND', requireStack: [] }` on the child stderr (exit 1) instead of the old terse `node: cannot find module '<abs>'`. The empty-arg usage error is the only owner-side `ok:false` left.

### Fixed

- **Vite 8 preview boot — Rolldown WASI pthread pool now serves end-to-end.**
  (a) Force the WASI path for Rolldown's napi-rs loader via `NAPI_RS_FORCE_WASI=1`
  in the dev-server child env — rifty has no native bindings by construction
  (ADR-0051/0156), and the loader otherwise SWALLOWED its
  `@rolldown/binding-wasm32-wasi` load error, surfacing only the generic
  `Cannot find native binding`. (b) Vite 8 removed `optimizeDeps.disabled`
  (Vite 5.1) and warns+ignores it, then ran dep discovery on the first request
  (driving Rolldown's WASI bundler and holding the request to a 30s timeout) —
  switched to the supported `noDiscovery: true` + empty `include`. (c) The
  dev-server child now registers `fs.*` sync-RPC HANDLERS (not just the client),
  so it RELAYS its nested Rolldown pthread workers' `fs.statOrNull`/reads to the
  owner store — they crashed with "no handler for 'fs.statOrNull'" otherwise.
  (d) Emit a `[vite] dev server ready on port N` readiness line on listen.
  (e) Re-baked the `vite@8.0.16` node_modules snapshot and restored
  `bakedNodeModulesUrl` on the template, so the default (instant) preset boots
  from the snapshot again (ADR-0135) instead of a cold install; the snapshot now
  carries `@rolldown/binding-wasm32-wasi` (14.3 MB gz, up from 9 MB — tracked by
  the baked-snapshot-regeneration backlog). Net result: `m1` (instant boot,
  baked-snapshot restore) and `m7-preview-sw` (from-scratch cold install →
  Rolldown WASI bundle → SW-routed `/preview/5174/`) are both CI-active and pass.

### Added

- **TypeScript language-service sandbox preset + long-tail editor providers.**
  The new `typescript-ls` preset opens a real `.ts` Vite project with strict
  `tsconfig`, cross-file symbols, seeded dependency `.d.ts` files, and
  demonstrable diagnostics/hover/defs/refs/rename/quick-fix/formatting. Monaco
  providers now cover the shipped TS-LS long tail where Monaco exposes a public
  provider, including document-range semantic tokens; completions now carry TS
  replacement spans, snippets, commit characters, and auto-import edits through
  Monaco. The editor program path follows the active template entry instead of
  hardcoding `/workspace/src/main.js`.

- **Editor quick-fixes / organize-imports / formatting now come from the rifty LS, not Monaco's built-in worker** (ADR-0166 task 4.2). The task-4.1 engine queries (`getCodeFixes`/`organizeImports`/`getFormattingEdits`/`getRangeFormattingEdits`, parity-proven) are wired as REAL Monaco providers over the page↔owner↔LS relay, so a missing-import quick-fix adds an import from a SIBLING file, organize-imports sorts + drops unused imports, and formatting applies tsserver's real edits — what VSCode shows. Validated by chromium e2e assertions (`tests/e2e/ts-language-service.spec.ts`).
  - **4.2a client methods.** `glue/ts-ls-client.ts` gains `getCodeFixes(path, range, errorCodes)`/`organizeImports(path)`/`getFormattingEdits(path, options)`/`getRangeFormattingEdits(path, range, options)` (same id-correlated reject-on-timeout pattern; positions/ranges on the wire are LSP 0-based; code-fixes use the `codeActions` response kind, organize-imports reuses `workspaceEdit`, formatting uses `textEdits`).
  - **4.2b Monaco providers.** `glue/ts-ls-monaco-providers.ts` registers a code-action provider (quickfixes + an always-offered `source.organizeImports`) + document/range formatting providers for `typescript` + `javascript`, each re-checking the `CancellationToken` across the relay hop. Quick-fixes source their `errorCodes` from the rifty markers (`monaco.editor.getModelMarkers({owner:'rifty-ts'})`) intersecting the request range, querying `getCodeFixes` per diagnostic with THAT diagnostic's own span + code (tsc only fixes when the request span lies within the diagnostic span). The LSP `CodeAction` maps to monaco `CodeActionList {actions:[{title,kind,edit:{edits:[{resource,textEdit}]},diagnostics?}], dispose()}` (uris → model Uri via `ensureModel`, shared with rename via a new `toMonacoWorkspaceTextEdits`); formatting pulls `tabSize`/`insertSpaces` from `model.getOptions()`. `glue/lsp-position.ts` gains `monacoToLspRange`.
  - **4.2c retire built-in formatting.** `EditorHost` `retireBuiltinTsIntelligence()` now also `setModeConfiguration`s OFF `documentFormattingEdits` / `documentRangeFormattingEdits` / `onTypeFormattingEdits` on `typescriptDefaults` + `javascriptDefaults`, so rifty owns formatting with no competing built-in (only the syntactic `documentSymbols` stays on). Code-actions were already off (task 2.2c).
- **Editor find-references / rename / signature-help now come from the rifty LS, not Monaco's built-in worker** (ADR-0166 task 3.2). The task-3.1 engine queries (`getReferences`/`prepareRename`/`getRenameEdits`/`getSignatureHelp`, parity-proven) are wired as REAL Monaco providers over the page↔owner↔LS relay, so references span cross-file uses, rename edits touch every affected file, and signature help reflects the real overload — what VSCode shows — instead of Monaco's isolated lib.d.ts-only guess. Validated by chromium e2e assertions (`tests/e2e/ts-language-service.spec.ts`).
  - **3.2a client methods.** `glue/ts-ls-client.ts` gains `getReferences`/`prepareRename`/`getRenameEdits`/`getSignatureHelp` (same id-correlated reject-on-timeout pattern; positions on the wire are LSP 0-based; references reuse the `locations` response kind).
  - **3.2b Monaco providers.** `glue/ts-ls-monaco-providers.ts` registers reference / rename / signature-help providers for `typescript` + `javascript`, each re-checking the `CancellationToken` across the relay hop. References resolve each `Location.uri` via `ensureModel`; rename flattens the LSP `WorkspaceEdit.changes` (per-uri `TextEdit[]`) into Monaco's flat `edits: IWorkspaceTextEdit[]` (uri → model Uri via `ensureModel`), and `resolveRenameLocation` rejects (via `rejectReason`) when the element isn't renameable so Monaco shows "cannot rename here"; signature help maps to `SignatureHelpResult {value, dispose}` with trigger chars `(` `,` and retrigger `)`. The built-in worker's references/rename/signatureHelp were already retired (`setModeConfiguration` in `EditorHost`).
- **Editor hover / completion / go-to-definition now come from the rifty LS, not Monaco's built-in worker** (ADR-0166 task 2.2; closes backlog/playground/ts-ls-hover-completion-monaco-transient). The task-2.1 engine queries (`getQuickInfo`/`getDefinition`/`getTypeDefinition`/`getCompletions`/`getCompletionDetails`) are wired as REAL Monaco providers over the page↔owner↔LS relay, so hover types, go-to-def targets, and completion candidates reflect the project's tsconfig + cross-file types + installed node_modules — what VSCode shows — instead of Monaco's isolated lib.d.ts-only guess. Validated by chromium e2e assertions (`tests/e2e/ts-language-service.spec.ts`) that exercise real project/dependency knowledge the built-in worker could not have.
  - **2.2a client methods.** `glue/ts-ls-client.ts` gains `getQuickInfo`/`getDefinition`/`getTypeDefinition`/`getCompletions`/`getCompletionDetails` (same id-correlated reject-on-timeout pattern as the diagnostics methods; positions on the wire are LSP 0-based).
  - **2.2b Monaco providers + editor seam.** `glue/ts-ls-monaco-providers.ts` registers hover / definition / type-definition / completion providers (trigger char `.`, lazy `resolveCompletionItem` for detail + docs) for `typescript` + `javascript`, each re-checking the `CancellationToken` across the relay hop. `glue/lsp-position.ts` is the tested Monaco↔LSP off-by-one mapper. `EditorHost` exposes `pathForModel` (model → VFS path, via a private `model.uri ↔ tab id` reverse index) and `ensureModel` (open a go-to-def target — sibling file or node_modules `.d.ts` — read-only and return its `Uri`). `App` registers + disposes the providers alongside the LS client.
  - **2.2c retire the built-in approximation.** `EditorHost` `retireBuiltinTsIntelligence()` now also `setModeConfiguration`s OFF every project-aware built-in provider (completionItems / hovers / definitions / references / documentHighlights / rename / signatureHelp / codeActions / inlayHints) on `typescriptDefaults` + `javascriptDefaults`, keeping only the syntactic ones (documentSymbols, formatting). No competing built-in hover/completion/goto (ADR-0166's "isolated approximation that lies").

- **TS language service wired into the editor — real semantic squiggles + a Problems tab** (ADR-0166 task 1.9; closes backlog/playground/problems-tab-bottom-panel). The worker-resident `@riftydev/ts-language-service` now drives Monaco diagnostics in the playground, validated by a chromium e2e (`tests/e2e/ts-language-service.spec.ts`).
  - **1.9a owner LS lifecycle + relay.** The owner spawns the LS as a `serve:true` grandchild (`workers/ts-lsp-worker-entry.ts`, URL injected as `RIFTY_TS_LSP_WORKER_URL` in `glue/realVite.ts`) reading the owner's authoritative VFS over `fs.*` sync-RPC — exactly the dev-server child shape (`RIFTY_REMOTE_FS=1`). Spawned lazily on the first `rifty:ts-lsp` frame. There is no page→grandchild channel, so frames RELAY through the owner: page →(page↔owner fork-IPC)→ owner → `lsChild.send` → LS; LS → `process.send` → owner → `kernelIpc.send` → page (`workers/real-vite-bootstrap.ts`). The page exposes `sendTsLsp`/`onTsLsp` on the workspace-owner handle.
  - **1.9b page client + editor seam + Monaco disable.** `glue/ts-ls-client.ts` — id-correlated request/response over the relay (per-request reject-on-timeout, `dispose()` rejects in-flight) + `lspToMonacoMarkers` (LSP 0-based → Monaco 1-based, severity 1..4). `EditorHost` gains `setMarkers(path, markers)` (owner `'rifty-ts'`) + `onDocument` (open/change/close, replays open buffers to a late subscriber). `App` inits the active root, debounces edits (~300ms) → `ts:open`/`ts:update`/`ts:close` → `getSemantic`+`getSyntactic` diagnostics → markers + an aggregated `path→diags` signal. Monaco's built-in JS/TS validation is turned OFF (rifty is the single source of truth).
  - **1.9c Problems panel.** `components/ProblemsPanel.tsx` + a Terminal|Problems view switcher in `BottomPanel` (count badge, click-to-jump via `openFile({reveal})`).
- **Durable scratch→project Save + cross-respawn index persistence (ADR-0165 §7,
  closes backlog/playground/durable-save-switch-persistence).** Save now MOVES the
  tree on disk instead of only flipping the page mirror: the page posts an
  `index-save {id,name,starter}` frame and the owner runs `saveScratchAsProject`
  (copy `/scratch` → `/projects/<id>`, flip+persist the index LAST, delete the
  source) then drains the OPFS write-through (`flushSyncMirror`) so the move is
  durable BEFORE a switch tears the owner down. Switching to a saved project
  respawns the owner at its real tree (not an empty re-seed), so files survive.
  Sibling durable frames mirror the same pattern: `index-rename` (rewrite a
  project's name), `index-reset` (re-seed the active scratch from its starter
  baseline + clear dirty), and `index-new-scratch` (re-establish the scratch entry
  + re-seed `/scratch` after a Save left the index `scratch:null`, so the next Save
  works). The owner reconciles its on-disk index at boot
  (`reconcileOwnerIndexAtBoot`: `recoverIndex` half-move rollback/finish + synthesize
  a scratch entry keyed on the spawn `RIFTY_RFV_STARTER` when `/scratch` exists but
  the index is a cold-boot empty) — the index becomes the real source the page mirror
  hydrates from. Save/reset carry the page's CURRENT active starter so a mid-session
  starter pick (no respawn) records the right starter. New e2e: the full
  save→switch-away→switch-back round-trip with two FRONTEND-starter projects, each
  tree intact + distinct across owner respawns, asserted straight off OPFS
  (`project-switch.spec.ts`). RED-checked: no-op the owner `index-save` handler →
  the round-trip + owner unit tests fail.

- Honest-loud degraded path (ADR-0165 §8): degraded banner + status-bar `Memory · session only`/`EPHEMERAL` badge wired to the real `BootResult`/`detectVfsBackend` probe (not a manual toggle); every save affordance marked ephemeral in memory mode; `Re-enable` reloads to re-probe; COI hard-assert unchanged (distinct gate).

- **Durable project delete (ADR-0165 §56).** Deleting a saved project from the
  launcher is now DURABLE end-to-end: after the Undo grace window the page posts an
  `index-delete` frame on the project-index channel (`glue/project-index-port.ts`
  `deleteProjectTree`); the owner `rmSync`s `/projects/<id>` from OPFS, drops the
  entry from the index, re-points `activeId` if the deleted project was active
  (→ scratch if a draft exists, else the first remaining project), and re-publishes
  so every page mirror reconciles. A delete of an unknown id is an idempotent no-op
  publish. App's `onDiskDelete` no longer throws `NotImplementedError` — the
  page-mirror flip + Undo were always real; the on-disk removal is now wired.

- **Project switch = owner teardown+respawn (ADR-0165).** Switching the active
  project is a strictly-sequential owner kill→await-exit→respawn with the new
  `RIFTY_RFV_ROOT` (the env is frozen per spawn — no live re-point), never a
  two-owner window (`glue/switch-owner.ts` `requestSwitch`). The page derives the
  active root from `rootForId(activeId)` threaded through every surface — the
  `WORKSPACE='/workspace'` constant is deleted — and holds an in-memory mirror of
  the owner's OPFS project index (`glue/project-index-port.ts` `bridgeProjectIndex`,
  re-published authoritatively on each respawn); the owner serves that index for the
  mirror. UI callers (launcher chip + command palette) land with the launcher; the cross-project
  switch e2e runs once those surfaces exist.

- **Durable-scratch lifecycle (ADR-0165).** `glue/project-index.ts` seeds
  `/scratch` (`seedScratch`, idempotent) from a re-derived Starter bundle
  (`glue/starter.ts` `seedFilesForStarter(starter, root)`, baseline = the registry
  definition, never stored) and one-shot whole-workspace resets it
  (`resetScratchToStarter`). Save converts scratch→project and re-keys the moved
  tree's install-stamp slug to the project id (sync `restampSlugSync` inside the
  atomic copy→flip→delete; async twin `restampSlug` in `glue/install-stamp.ts` for
  the boot/page callers), so two projects from the same Starter never share
  `node_modules`. The owner dev-boot clean (`workers/dev-boot-clean.ts`
  `shouldCleanForDevBoot`) now fires on a root OR template change, not template
  alone (first boot still never cleans).

- Multi-project storage layer (ADR-0165): owner-side project index (`loadIndex`/`writeIndex`/`recoverIndex`/`saveScratchAsProject`/`seedScratch`/`resetScratchToStarter`, loud on corrupt JSON + un-reconcilable half-move, atomic-safe copy→flip→delete Save), Preset→Starter map (shared `.source` refs preserved), owner↔page index bridge, and the page store replacing the bare `activePreset` signal. No UI wiring yet.

- **Page preview bridge advertises served ports** (ADR-0160). The window-owner
  `rifty:preview:ready`/`goodbye` frames now carry the `ports` the page owns, so
  the SW routes copied-tab (`/preview/<port>/`) traffic port-keyed to the owning
  window instead of misrouting across multiple playground windows.

- **Terminal `node <file>` command** (ADR-0155). Runs an arbitrary entry as a supervised child of
  the workspace owner — the symmetric twin of the `.bin` child (`runNodeEntry`, ADR-0137), NOT the
  template dev-server. A run-to-completion script streams stdout/stderr and exits on event-loop drain
  (ADR-0152) with its code; a script that calls `listen()` stays alive (`serve:true`), registers its
  port for preview, and is stopped by Ctrl-C — server-vs-script decided by what the program does, not
  a flag. New `workers/owner-child-node-executor.ts` (spawn spec `RIFTY_BIN=0`/`RIFTY_NODE_SERVE=1`/
  `serve:true` + stream/SIGINT-kill/exit + `rifty:node-listening` IPC), `workers/node-program-lifecycle.ts`
  (run-vs-serve decision), `workers/node-entry-resolve.ts` (cwd-resolve + `node: cannot find module`),
  `workers/preview-registry.ts` (multi-port set), `glue/node-child-ipc.ts`; `node-entry-bootstrap.ts`
  gains the `RIFTY_NODE_SERVE` serve branch (net builtins always); `real-vite-bootstrap.ts` registers
  the `node` command + the preview registry; `PreviewPanel.tsx` gains a multi-port switcher;
  `pty-protocol.ts` gains `pty:preview`/`pty:preview-req`. Interactive stdin is not forwarded — the
  child's `process.stdin` consume surface throws `NotImplementedError` (`node-stdin-guard.ts`) rather
  than hanging (Fidelity). Other gaps (bare-node `node:sqlite`, cross-realm loopback) are backlogged;
  trailing `node x.js &` runs via the shell's generic background path (job-control builtins are the
  gap). E2E: `tests/e2e/node-command.spec.ts`.

- **Page preview-port registry + per-node-port preview bridge** (ADR-0155). `glue/pty-client.ts`
  gains `onPreview`/`requestPreview` mirroring the `onDevServer`/`requestDevServer` discipline:
  routes owner→page `pty:preview{ports}` snapshots to subscribers + sends `pty:preview-req`.
  `glue/realVite.ts` exposes them on `WorkspaceOwnerHandle` (preview listener set, spawn-time
  handshake beside the dev-server one, empty-set publish on owner exit). `App.tsx` keeps a
  `previewPorts()` signal fed to `PreviewPanel`'s switcher, requests a re-publish on subscribe, and
  wires a per-port SW preview bridge for NODE-source ports ONLY (the dev-server port keeps its
  existing `onDevServer` bridge — never double-wired) via a diffing effect over a port→teardown Map.

- **Vite 8 template/runtime wiring.** The Vite project spec now installs
  `vite@8.0.16`, overlays the LightningCSS WASM shim, and threads
  `RIFTY_KERNEL_WORKER_URL` / `RIFTY_NODE_ENTRY_WORKER_URL` into the supervised
  dev-server child so Rolldown's WASI worker pool can spawn real kernel-backed
  worker_threads children. HMR remains disabled here by the Vite 8 HMR-scope ADR;
  sockets/HMR are tracked outside this change.

- **Event-loop keepalive + drain wired into the kernel worker** (child-realm-async-lifecycle,
- **Event-loop keepalive + drain wired into the kernel worker** (ADR-0152,
  ADR-0152). `workers/kernel-worker-entry.ts` now calls `installEventLoopKeepalive()` (right after
  `installTimerGlobals()`), so a run-to-completion child drains its event loop before reaping —
  post-top-level async (timers, detached `import().then(run)`) completes — and fails loudly (stderr +
  exit 1) on an unhandled rejection or a never-draining loop, instead of silently exiting 0.

- **Supervised dev-server child entry + config resolver** (P6b, ADR-0150).
  `workers/dev-server-child-config.ts` is a pure, LIGHT-import resolver
  (`resolveDevServerChildConfig`) that rebuilds the boot config (spec/cfg/port/root/slug/
  fromScratch) from the spawn env, with loud throws on a missing required var (and a
  non-integer port) — unit-tested without pulling vite/sql.js. `workers/dev-server-child-bootstrap.ts` is the heavy
  `kind:'url'` child entry the owner spawns to run the dev server out of the owner thread: it reads
  the owner store over fs.* sync-RPC (`installRemoteSyncFs`, RIFTY_REMOTE_FS=1), boots via
  `bootDevServer`, and talks to the owner over fork-IPC (`rifty:dev-ready`/`-error`/`-snapshot` out,
  `rifty:dev-file-changed` in). `registerNetBuiltins`/`registerSqliteBuiltin` + the boot run INSIDE a
  guarded entry fn (only when `readKernelProcessSpec() !== null`), so importing the module under
  vitest has no heavy side effects. The owner spawn-to-child flip is a later task.

### Changed

- **Owner spawns the dev server as a supervised child instead of booting it in-realm** (P6b flip,
  ADR-0150). The owner's dev-line boot closure (`real-vite-bootstrap.ts`) no longer calls
  `bootDevServer` in its own thread; it now spawns the dev server through
  `createOwnerChildDevServer(devServerWorkerUrl)` — a serve:true child (`dev-server-child-bootstrap`)
  that reads+writes the owner store over fs.* sync-RPC. The owner stays a free async supervisor; the
  driver resolves when the child reports listening, and the controller's stop() kills the child (a
  fresh child per run → re-listen on restart). The new child entry URL threads page→owner over
  `RIFTY_DEV_SERVER_WORKER_URL` (`realVite.ts` spawn env → owner bootstrap guard → `bootShellOwner`).
  The owner-realm template-switch clean (rm node_modules/lockfile/package.json on a preset switch)
  and the editor-write→HMR + snapshot wiring are unchanged. The owner no longer imports/calls
  `bootDevServer` (kept only for the child + `flushSyncMirror`).
- **Extracted the co-resident dev-server boot core into `workers/dev-server-boot.ts`** (P6b prep,
  ADR-0148/0150). `bootDevServer` + the vite/node-server tails (`bootNodeServer`,
  `waitForListeningPort`, `overlayShims`, `toRootRelativePath`,
  `flushSyncMirror`, the Vite interfaces) moved verbatim out of `real-vite-bootstrap.ts` (which has a
  top-level `await bootstrap()` so it can't be imported) into an importable, side-effect-free module
  so a P6b child realm can import it. No behavior change: the owner still imports `bootDevServer` and
  calls it in-realm exactly as before; the spawn-to-child flip is a later task.
- **One spec-seeded mutable Node `process` at the pre-entry seam; removed the post-spawn
  `globalThis.process` swap** (ADR-0157). `node-entry-bootstrap.ts` no longer calls
  `installRuntimeGlobals()` (the `installProcessGlobals` swap that orphaned argv/cwd/stdin);
  `proc = globalThis.process` is the rich seeded process throughout (`postListening` uses
  `proc.send`). `worker-runtime-globals.ts installRuntimeGlobals()` degrades to a thin fork-IPC
  handle accessor (no process/Buffer/timers swap) — still used by `dev-server-child-bootstrap` +
  `real-vite-bootstrap` for `{send,onMessage}`; `setProcessCwd(root)` retained where the realm
  overrides cwd. The pre-entry hook (`kernel-worker-entry.ts`) installs the rich process gated to
  Node workers (`isNode = no __RIFTY_WASI_WASM_URL`). Brittle `real-vite-bootstrap.test.ts`
  source-greps for `installRuntimeGlobals()` replaced with behavioral assertions.
- **Preview panel mounts on node-server ports even when the dev server is stopped** (ADR-0155 §3
  follow-up). `hasPreview()` now ORs `previewPorts().length > 0`, the `<Show>` no longer re-keys on
  `realVitePort()` (PreviewPanel self-reconciles its selection — a dev-port change no longer resets
  the chosen node port), and `previewUrl`/`openPreviewTab` accept any registered preview port (not
  only when the dev server runs) so "open in new tab" no longer silently no-ops for a node-only preview.

### Fixed

- **`node <file>` server now sees its real `process.argv`/`process.cwd()`/`process.stdin`** (ADR-0157).
  The `RIFTY_NODE_SERVE` bootstrap previously read `proc = globalThis.process` (the seeded shim) then
  swapped `globalThis.process` to the default `riftyProcess` (`argv=['rifty','repl']`, `cwd='/workspace'`,
  bare stdin), so user code saw the wrong argv/cwd and the stdin loud-guard was installed on the
  ORPHANED old object. The unified seeded process eliminates the swap → argv/cwd/stdin are correct by
  construction and the loud-guard patches the object user code actually reads.
- **`node-stdin-guard.test.ts` was false-green** (ADR-0157) — it asserted against a synthetic
  `{ stdin: {} }` the guard fully replaced, so it never exercised the real `makeStdinReader`
  EventEmitter and missed that `setRawMode`/`setEncoding`/`pause`/`resume` were not neutralized. The
  guard now patches the real seeded stdin in place (every consume method throws `NotImplementedError`,
  `'data'`-listener-add gated, `isTTY`/`'end'` passive) and the test runs against a real seeded process.
- **`.bin`/`execSync` children now get `Buffer` + `process.nextTick` ordering** (ADR-0157) — the
  else-branch previously skipped `installRuntimeGlobals`, so a `.bin` tool using `Buffer` threw
  ReferenceError and `process.nextTick` threw TypeError; the gated rich pre-entry install closes the gap.
- **A `node` server that picks the live dev-server port no longer deletes the shared preview route**
  (ADR-0157 review C3). `preview-registry` dedups by port (dev slot wins) and `App.tsx` never wires a
  second SW bridge for the active dev port — previously both the `onDevServer` and node-port paths
  registered the same `/preview/<port>/`, and a teardown of either dropped the other's route (502).
- **`node <file>` natural exit honours `process.exitCode`** (ADR-0157 review D4). A clean return after
  `process.exitCode = N` now exits N (Node uint8 coercion) instead of a hardcoded 0; an uncaught tail
  throw still maps to exit 1 (uncaught wins). `node-program-lifecycle` reads the exit code at the
  drain-then-exit step. (D1: relative `node:fs` reads + `process.cwd()` now agree at a non-`/workspace`
  cwd — the seeded process backs both the loader and `node:fs`/`path`, guarded by a unit at a subdir cwd.)
- **From-scratch preset boots clean over a prior preset's tree — no more EBROKENLOCK** (ADR-0135).
  Selecting a from-scratch vite preset (`real-vite`) after an instant one (`project-files` /
  `node-worker`) installed over the instant preset's baked-snapshot tree: its `package-lock.json`
  omits the boot-overlaid esbuild shim, so the installer's lockfile-coverage check threw
  `EBROKENLOCK` and the dev server stopped (or, on a partial tree, `Cannot find module 'vite'`).
  The owner's preset-switch clean is keyed on `templateId`, so it skipped switches that share one
  (all three presets are `vite`). `ensureProjectDependencies` now clears a foreign `node_modules` +
  lockfile right before the `install()` fallback (reaching it means no stamp matched this slug and
  no snapshot applied → the on-disk tree is another preset's), so a from-scratch install is always
  truly clean — independent of the owner's in-memory switch state, so it holds across a reload too.
- **`stop()` no longer hangs after a post-ready dev-server child crash** (P6b review, ADR-0150). The
  driver's `DevServerHandle.stop()` killed the child then awaited its `'exit'` — but `WorkerHandle.kill()`
  on an ALREADY-exited child returns `false` and emits NO `'exit'`, so a Ctrl-C after a mid-run child
  crash awaited a frame that never came and hung the dev-run (and the controller's `stopped`
  transition) forever. `stop()` now resolves immediately when `kill()` returns `false`, so Ctrl-C
  recovery works; the remaining AUTOMATIC post-ready-exit observation stays the disclosed follow-up
  (`backlog: shell/dev-server-child-exit-unobserved`).
- **Removed the inert `setupPreviewBridge` no-op + dead `ownerToken`/`RIFTY_DEV_SERVER` plumbing from
  the dev-server child** (P6b review, ADR-0150 corrected). `bootDevServer` runs only in the child
  realm, where `setupPreviewBridge` no-ops (`!('serviceWorker' in navigator)`) — the ADR's own
  correction names that placement a forbidden silent no-op. Dropped the call + `dispatchSerializedPreview`
  + `tearDirectSwBridge` and the whole `ownerToken` chain it fed (`RIFTY_PREVIEW_OWNER_TOKEN` env →
  resolver → boot opts) and the never-read `RIFTY_DEV_SERVER` env. The live SW-direct preview route is
  page-anchored (`mountPlaygroundPreviewBridge`); the child serves `/preview/<port>/` via
  `serveCrossRealmPreview` (keyed by port). No behavior change — only dead code removed.
- **Owner flushes its OPFS after the dev-server child's install — shell writes survive reload** (P6b
  regression, ADR-0072/0150; caught by `owner-persistence-reload` e2e). Pre-P6b `bootDevServer` ran in
  the owner, so its `ensureProjectDependencies({ flush: flushSyncMirror })` drained the OWNER's OPFS
  write-through queue. Post-P6b that flush runs in the CHILD, where `syncMirror()` is the remote
  `SyncRpcFsSync` (no `flush` → no-op), while the child's node_modules install writes land in the
  OWNER's write-through queue over fs.* RPC and were never drained. A subsequent small shell write
  (`echo > persist.txt`) queued behind the undrained node_modules backlog and was lost when the reload
  terminated the owner worker before the queue reached durable OPFS. Fix: `DevServerChildBootOpts` gains
  an optional `flush`; the owner driver awaits it on `rifty:dev-ready` BEFORE resolving boot (the
  controller goes LIVE only once the owner store is durable), and `bootShellOwner` passes
  `flush: flushSyncMirror` (owner realm → real OWNER OPFS drain). Boot-scoped (once per dev-server
  boot in the supervisor), NOT the P5-reverted per-`pty:exit` flush stall.
- **Dev-server child binds the preset's dev port, not the owner's spawn default** (P6b, ADR-0150).
  The node-server template entry binds `process.env.PORT`; in the supervised child that env came from
  the owner's spawn-time default (the default vite port 5174), not the active preset's dev port (e.g.
  express-sqlite 3210) — so the entry listened on 5174, the harness `waitForListeningPort(3210)` timed
  out, and `/preview/3210/` 502'd (caught by the `fullstack-demo` gold e2e). The owner's in-realm
  `globalThis.process.env.PORT` mutation does not reach the child entry (it reads its env from the
  clobber-safe `KernelProcessSpec`). `buildDevServerChildSpawnSpec` now sets `PORT`=devPort in the
  child spawn env, the source the entry actually reads. Vite presets are unaffected (vite binds via its
  config port, not `process.env.PORT`).
- **`npm run <script>` no longer silently boots the dev server for non-dev scripts.** The owner's
  `runScript` ignored the script command and always ran the dev server, so `npm run build`
  (`vite build`) exited 0 having silently booted dev. It now boots only for the spec's dev-line
  script NAMES (`dev`/`vite`/`start`, via `isDevScriptName`); any other script loud-rejects to
  stderr + non-zero. Matched by NAME, not command: a preset switch updates the active spec before
  the tree's package.json is re-seeded, so a node preset's `npm run dev` can read a stale `vite`
  command — command-matching wrongly rejected it and broke the node-server boot (fullstack-demo
  e2e). Generic `npm run` now routes non-dev scripts through the owner `.bin` path.
- **Owner death no longer leaves a stale LIVE pill + silently drops edits.** On owner-worker exit
  `realVite` only resolved `closed`, never notifying `onDevServer` listeners — so the UI stayed
  'running'; and a post-exit `writeFile` fell through `worker.send`'s false return into the
  snapshot-port channel, which silently drops with no worker listening. Exit now synthesizes a
  `pty:dev-server` `stopped` frame (UI leaves 'running') and `writeFile` after exit throws loudly
  instead of vanishing.
- **Seeded preset files open EDITABLE despite the publish race.** A just-seeded project file
  opened before the owner snapshot reflected its write classified read-only (sync miss → async
  owner read-port) and stayed so until close+reopen. `openFile` now routes via a pure
  `classifyOpen` helper: a non-node_modules snapshot miss is `await-snapshot` — it subscribes to
  the next `SnapshotFs` publish frame (event, not timer) and opens editable when the file lands.
  node_modules / present-but-over-cap / binary stay view-only exactly as before.
- **Workspace owner boots on the PRODUCTION build (broken deploy, green checks).** In the prod
  bundle a stray top-level `installProcessGlobals()` side-effect (`runtime-js/worker-entry`,
  pulled into the owner chunk + evaluated at module-eval) swapped `globalThis.process` for a
  fresh EMPTY-env one AFTER the kernel pre-entry hook set the spawn env, so the owner read
  undefined worker URLs and threw `missing RIFTY_KERNEL_WORKER_URL / RIFTY_NODE_ENTRY_WORKER_URL`
  → dev server never came up, explorer stuck "Loading the workspace…". `pnpm dev` never loaded
  that module in the owner realm, so the dev e2e stayed green while the deploy was dead.
  `real-vite-bootstrap` now reads its env from the kernel's published process spec
  (`readKernelProcessSpec()`, a dedicated non-enumerable global the swap can't touch) and
  re-asserts it onto the live process. Root cause filed:
  `backlog: runtime-js/worker-entry-process-globals-side-effect`.

### Added

- **Socket Lab preset.** Adds a node-server sandbox template that runs a live
  socket capability matrix: HTTP request body streaming, `ServerResponse`
  drain, `Readable.fromWeb(...).pipe(res)`, npm `ws` over `http.Server`
  upgrade, optional external `ws` egress, and loud ceiling checks for raw
  TCP/UDP/TLS/HTTP2/unbounded cross-realm cases. A dedicated Playwright e2e
  selects the preset and fails CI if the supported probes stop passing or the
  ceiling probes stop failing loudly.

- **Prod-artifact smoke e2e (`playwright.prod.config.ts` + `pnpm test:e2e:prod`, wired into
  CI).** Builds the app and serves it with `pnpm preview` (the Netlify COOP/COEP headers), then
  asserts the workspace owner boots — COI is live, the co-resident dev server reaches `LIVE`, and
  no `missing RIFTY_*_URL` boot error. Closes the green-checks-but-broken-deploy gap: the default
  e2e runs against `pnpm dev`, so a prod-ONLY regression shipped green before.

- **PTY: no more hung terminal on owner death (review #3a).** `pty-client.disconnect()` now
  settles EVERY waiter — in-flight runs resolve nonzero (unchanged), pending `openSession()`
  waiters resolve, and post-death `openSession()`/`exec()` settle immediately — instead of
  leaving the terminal line / Run button hanging forever (it only resolved in-flight runs
  before; reload/tab-close/preset-switch/owner-crash fire `disconnect()`).
- **PTY: `exec` on an unknown session emits `pty:exit{error}` (review #3b).** The owner handler
  silently `return`ed on a missing session, hanging the page run; it now emits a synthetic
  error-exit so a protocol-order violation surfaces loud.

### Removed

- **Dropped the wired-no-op `pty:resize` frame (review #3c).** Live terminal resize was
  advertised (`PtyClient.resize`, `WorkspaceOwnerHandle.resize`, `PtyResize` frame) but the
  owner silently ignored it (and nothing on the page called it). Removed the whole chain rather
  than keep advertising an unimplemented capability; dims stay per-exec. Real live-resize →
  `backlog: shell/pty-live-resize`. With #3b this closes + retires
  `backlog: shell/pty-server-protocol-honesty`.

### Changed

- **`FileExplorer` is a pure read-only viewer (review #4).** The page never mutates the owner
  store directly (`snapshotFs` throws on write; owner = SSoT, ADR-0148/0150), so the explorer's
  disabled create/rename/delete machinery — wired to the throwing snapshot — is removed rather
  than left hidden behind a `readOnly` prop. Create/rename/delete happen via the editor or
  terminal (routed to the owner) and reflect on the next poll. Owner-routed in-tree CRUD was
  later implemented by the SCM file-manager work.

- **The page holds no authoritative VFS store — the owner is the single store
  owner (D-acceptance A1/A2; `d-owner-worker-milestone`).** P4 left a SECOND
  authoritative `syncMirror` on the PAGE (`initBackend`) written-through as a
  workspace-archive copy, so the archive diverged from owner-side (shell/CLI)
  writes and the "one store owner" invariant held only `partial`. Now retired:
  workspace archive export/import is owner-served (`glue/workspace-archive-port`,
  reusing the realm-agnostic `glue/workspace-archive` against the owner
  `syncMirror` — full content, no 128 KB cap, so a downloaded archive includes
  shell/CLI-authored files); seeding + the default README are owner-only
  (`real-vite-bootstrap` `seedProject`); the persisted terminal cwd is validated
  in the owner (`glue/reachable-cwd` in `makeShell`) instead of against the page
  store; and the storage badge reads `detectVfsBackend` (the page installs no
  backend — this also fixes the prior page-main-thread "OPFS-sync-fails → badge
  shows memory" misreport). Authoritative-store count == 1; A1/A2 hold. Tests:
  `glue/workspace-archive-port.test.ts`, `glue/reachable-cwd.test.ts`; e2e
  `owner-*` + `sandbox-fs-rpc` green.

### Tests

- **Single-store-owner behavioral acceptance — the cross-realm cases parity
  can't reach.** Four new owner e2e specs:
  `owner-editor-write-exec-read` (a page editor write is read back by exec in the
  owner — no stale page store shadows it), `owner-single-source-byte-identity`
  (the same file reads identical from the page viewer `SnapshotFs` and from
  `cat`), `owner-snapshot-restore-exec` (install + write → reload → the installed
  CLI still runs + the file still reads — the spec that caught the reload-persist
  bug above), and `owner-responsive-under-load` (the page main thread stays
  responsive during the co-resident dev-server boot). Byte-identity is scoped to
  in-cap files; over-cap files report an honest "too large to preview", already
  unit-asserted in `glue/snapshot-fs.test.ts` (the viewer never shows WRONG
  bytes). All owner/COI specs now carry a `test.skip(browserName!=='chromium')`
  guard so the firefox/webkit projects skip them instead of failing.

### Fixed

- **A user `npm install` now survives a reload — an installed CLI still runs
  after teardown/restore.** Two coupled bugs dropped the user's install on every
  reload: (1) the shell `npm` stamped the tree with slug `''` instead of the
  owner's project slug, so the boot's `installStampSatisfied(slug)` missed and
  the dependency arrival re-ran; (2) `bootDevServer` force-overwrote
  `package.json` with the template default on every boot, reverting the user's
  added deps — which then failed the stamp's dep check and restored the baked
  snapshot, REPLACING `node_modules` (the install was already OPFS-persisted, but
  got clobbered on boot). Now the shell `npm` stamps with the current project
  slug (`npm-shell-command` `projectSlug`), and `bootDevServer` seeds
  `package.json` if-absent (a genuine preset switch resets it in the `boot`
  closure alongside the node_modules/lockfile clear). A same-template reload
  reuses the persisted tree (stamp no-op). Caught by `owner-snapshot-restore-exec`
  e2e; unit-guarded in `npm-shell-command.test.ts`.

- **Honest module HMR for real-Vite previews (ADR-0145, superseded transport by
  ADR-0151).** Real-Vite no longer turns every edit into a hand-rolled
  `{type:'update', path}` plus `location.reload()`. Vite now keeps its native
  `server.ws` path, attaches to rifty `http.Server.on('upgrade')`, and generates
  real HMR payloads (`update.updates[]`, `full-reload`, `prune`, `error`). The
  injected iframe script installs the generic `@riftydev/net` browser
  `WebSocket` bridge, so Vite's own `@vite/client` patches self-accepting
  modules in place without a Vite-only socket shim. The seeded Vite entry is
  self-accepting, and editor writes wake Vite's native watcher path instead of
  manually broadcasting a fake update.
  Tests: `apps/playground/src/glue/hmr-bridge.test.ts`,
  `apps/playground/src/workers/real-vite-bootstrap.test.ts`,
  `apps/playground/src/workers/real-vite-invalidation.test.ts`,
  `apps/playground/src/templates/project-spec.test.ts`,
  `tests/integration/vite-hmr-channel.test.ts`, opt-in browser
  `tests/e2e/m10-hmr.spec.ts`, and opt-in manual install browser
  `tests/e2e/manual-vite-install.spec.ts`.

- **Editable project files in real-vite mode (ADR-0076 §Decision-4, corrected).**
  Editing a seeded source tab (e.g. `src/project-summary.js`) while the dev
  server ran threw `writeFileSync: "…" is read-only — it lives in the Vite
  worker realm`: the editor wrote through `activeVfs()`, which flips to the
  read-only worker `SnapshotFs` once Vite boots, and a tab opened before the
  flip kept a stale write path. The editor now splits its READ view (the
  snapshot) from its WRITE target (the always-writable page `syncMirror()`, new
  `EditorHost` `writeVfs` prop + `glue/editor-write-router.ts`): a file is
  editable iff the page mirror owns it, and the edit rides the existing
  `onFileWritten` → `syncWorkspaceFileToWorker` → write port (ADR-0043) to the
  worker (Vite watcher → HMR). Worker-only files (`node_modules`,
  worker-generated) stay read-only. ADR-0076's original view-only-for-file-tabs
  decision was wrong (a read-only sandbox is nonsense) and is corrected in place;
  its snapshot bridge is unchanged. Regression test: `glue/editor-write-router.test.ts`.

- **Writable file explorer in real-vite mode (ADR-0076 §Decision-6).** The
  explorer showed a `read-only` badge and hid new/rename/delete while editing
  worked — inconsistent. It now uses `glue/real-vite-explorer-vfs.ts`
  (`RealViteExplorerVfs`): reads the worker snapshot, writes the page mirror, and
  propagates each op to the worker over the write port — which gains an `rm`
  frame (delete + rename) alongside `write`/`mkdir`, pushed via
  `RealViteHandle.applyVfsFrame`. `node_modules` rows stay read-only. Badge gone,
  CRUD controls shown. Tests: `glue/real-vite-explorer-vfs.test.ts`,
  `glue/vfs-write-port.test.ts` (rm frame).

- **No white flash on preview full-reload fallbacks.** Vite still full-reloads
  for HTML/config/non-accepted boundaries; the worker-seeded `index.html` had no
  background, so entry code that sets `body` bg via JS flashed white between
  reload and module-eval. `buildIndexHtml` now seeds
  `<style>html,body{margin:0;background:#101218}</style>` so the document paints
  dark from the first frame. Test: `templates/project-spec.test.ts`.

### Added

- **Foreground CLIs run in a supervised child worker (P6a of ADR-0150).** Each
  shell-resolved `.bin`/node CLI now runs in a child worker-process the owner
  SUPERVISES — resolution stays owner-side, the child reads+writes the owner store
  over `fs.*` sync-RPC (`RIFTY_REMOTE_FS=1`) instead of running in-realm — so the
  owner stays a free async supervisor while a CLI runs (ADR-0150 `waitAsync`
  invariant). `createOwnerChildBinExecutor` (over `globalProcessManager.spawnWorker`)
  replaces the in-realm `createOwnerBinExecutor` at the frozen `BinExecutor` seam
  (ADR-0137); the owner registers the `fs.*` handlers + receives the kernel +
  node-entry worker URLs via env (recursive spawn). New e2e
  `owner-shell-responsive`: two terminals' children run concurrently + Ctrl-C kills
  a running child; `owner-shell-cowsay` now exercises the child path. (P6b — the
  dev server → child — is the remaining D phase.)

- **OPFS persistence in the workspace owner (P5 of ADR-0143 "D").** The owner now
  `await initBackend()` at boot like every other worker realm
  (`runtime-js/worker-entry`, `rifty/sandbox`) — it was the only realm left on
  memory, so the workspace (installed `node_modules`, edited + shell-written files)
  vanished on `page.reload()`. The OPFS content-cache write-through (ADR-0072) is
  the durability mechanism on its own; there is no per-command flush barrier — an
  awaited drain coupled command latency to the unrelated boot write-through queue,
  stalling the shell during boot (graceful drain-on-terminate →
  `docs/backlog/shell/owner-graceful-drain-on-terminate`). New e2e
  `owner-persistence-reload`: `echo > /workspace/persist.txt` → `page.reload()` →
  `cat` survives (honest — fails on the memory backend).

- **Unified workspace owner: co-resident dev-server + single source of truth
  (ADR-0148, P4 of ADR-0143 "D").** The `vite`/dev server now runs CO-RESIDENT
  inside the ONE persistent workspace owner — started on demand by the owner's
  `vite` / `npm run <script>` shell command, stopped on Ctrl-C via `server.close()`
  without killing the owner — so it reads the SAME store `npm install` writes
  (closes the two-owners trap: `npm install <pkg>` then `npm run dev` share
  `node_modules`). The per-run `startRealVite` preview worker and the entire
  page-driven dev path (`dispatchDevServerLine`/`runViteCommand`/`isDevServerLine`)
  are deleted; dev-server start/stop + the listen port flow to the page over a new
  structured `pty:dev-server` frame + the P3 request handshake (no stdout
  log-match). The owner becomes the SINGLE SOURCE OF TRUTH: the editor + explorer
  always read the owner snapshot (the `activeVfs`/`snapshotFs` `vite`-gated swap is
  retired), editor + program edits write to the owner (HMR against the same store
  it serves), and the `node_modules` read-port is widened to a general workspace
  read-port whose consumer is the editor opening owner-only files. New
  `dev-server-controller` (single-active guard + dev-server frame emit + HMR
  forward); `wirePreviewBridge` replaces the per-run page preview wiring. COI e2e:
  co-resident vite preview through the SW (`m7-preview-sw`), node-server
  (`fullstack-demo`), shell CLI (`owner-shell-cowsay`), explorer coherence
  (`owner-explorer-coherence`).

- **Owner snapshot coherence + readiness handshake (ADR-0146, P3 of ADR-0143
  "D").** The page file explorer now reflects files the owner-resident shell
  writes: the owner republishes its `syncMirror` snapshot on every command exit
  (`pty:exit`), so a bare `echo > f` / a program's output shows up without a
  dev-server restart (e2e `owner-explorer-coherence.spec.ts`). The blind
  owner-side snapshot retry-storm (`[300,1200,3000]ms` re-publish) is replaced by
  a structured handshake: the page posts `snapshot-req` on subscribe and the
  owner replies via `serveSnapshotRequests`, so the initial sync is deterministic
  whichever side comes up first (and survives page reload). Deferred to P4: the
  general (non-`node_modules`) on-demand read-port widening — it needs an editor
  consumer for large/owner-only files and lands when the preview owner unifies.
- **Owner-resident shell + pty channel (ADR-0146, P2 of ADR-0143 "D").** The
  `Shell`, cwd/env, `npm install`, and bin/`execSync` now run inside ONE
  persistent workspace-owner worker (the real-vite bootstrap generalized to a
  mode-parametrized `shell`|`preview` owner, spawned `serve:true` at App-mount,
  addressed by a stable `workspaceId`); the PAGE terminal is a thin client over a
  `pty:*` frame channel on the kernel fork-IPC port (control AND stdout/stderr
  chunks on one ordered channel, `sessionId`+`runId` correlated, cwd/env pushed
  on `pty:exit`, structured `pty:ready` handshake). npm + bin share the owner's
  `syncMirror`, so an installed CLI (`cowsay hi`) finally runs end-to-end —
  closes the ADR-0143 ENOENT dead link. New `pty-protocol`/`pty-server`/
  `pty-client`/`owner-bin-executor`; `terminal-manager` is now a pty port client;
  the dead `useShellSession` adapter is removed. Persisted cwd/env restore via the
  `pty:open` seed; `npm run <dev>` routing stays page-driven. COI e2e
  `owner-shell-cowsay.spec.ts` (CI-only). The dev-server preview owner stays
  separate (page-driven) until **P4** folds it into this owner — a tracked
  two-owners transient (no residual debt at D close).
- **Wire installed-CLI execution to the node-entry loader bootstrap (ADR-0137,
  Opt-Y).** `createBinExecutor` spawns the `kind:'url'` node-entry bootstrap
  (`workers/node-entry-bootstrap.ts`) for a shell-resolved `node_modules/.bin/<name>`
  shim; in the worker it reads the shim, resolves its launcher target, and runs
  THAT through the module loader (shebang stripped, relative imports resolved vs
  VFS) — streams stdout/stderr to the terminal, `ctx.signal` (Ctrl+C) kills it.
  Wired via `createTerminalManager({ execBin })`; `main.tsx` injects the bootstrap
  URL for runtime-js (`setNodeEntryWorkerUrl`). SAB-IPC-gated. Registered commands
  (`vite`) still win. Replaces the earlier `kind:'source'` approach, which threw
  on the shim's shebang (ADR-0137 §Rejected).
  - The execution MECHANISM (`runNodeEntry` + loader) is proven by node unit
    tests + parity. The historical worker-VFS transport residual was later
    closed by the owner-worker child executor; real package CLIs now run through
    the owner store.

- **Baked node_modules snapshots — instant presets are instant on the FIRST
  boot too (ADR-0135 item 6).** `pnpm snapshots:bake` runs a real `install()`
  per baked template and ships node_modules + lockfile as a committed gzipped
  asset (`public/snapshots/`, vite ≈9 MB gz). The worker's dependency arrival
  (`glue/project-deps.ts`) is now stamp → snapshot → install: a stampless boot
  restores the baked tree (deps-equality gated, REPLACE semantics, then
  stamped) instead of resolving/fetching; any snapshot failure falls back to a
  real install. Gzip is sniffed by magic bytes (vite dev pre-decodes `.gz` via
  Content-Encoding; static hosts serve raw bytes). Regeneration policy:
  `docs/backlog/playground/baked-snapshot-regeneration.md`.

- **Sandbox setup kinds: instant vs from-scratch (ADR-0135).** Presets carry
  `setup: 'instant' | 'from-scratch'`. BOTH kinds boot the template's dev line;
  the difference lives in the WORKER realm (carried over `RIFTY_RFV_SETUP`).
  From-scratch presets (`real-vite`, `express-sqlite`) run a VISIBLE, honest
  `install()` inside the worker — the realm that owns the OPFS tree the preview
  is served from — skipping the baked snapshot and streaming live
  `npm: + <name>@<version>` per-package output (ADR-0134) before the dev server
  starts. Instant presets (`project-files`, `node-worker`) take the quiet
  snapshot/stamp path. Node_modules reuse is keyed on the **project slug**
  (preset id, `node_modules/.rifty-install-stamp.json` in OPFS), not the deps:
  `project-files` and `real-vite` both run `vite` but must not reuse each
  other's tree, so a from-scratch preset always shows its install even when an
  instant preset already warmed OPFS — re-selecting the same project reuses
  (fast). Switching projects clears the terminal first. Template switcher groups
  presets under "Instant start" / "From scratch" with kind pills. Stamp
  invalidation is provisional —
  `docs/backlog/playground/install-stamp-invalidation.md`.

### Changed

- **Production npm registry proxy moved to Yandex Cloud (ADR-0163).** Netlify
  now deploys only the static playground artifact; production builds set
  `VITE_RIFTY_REGISTRY_URL=https://registry.rifty.dev/npm-registry`, and
  tarball URL rewriting uses that configured proxy origin. The old Netlify
  Function source and `/npm-registry` redirects are removed; CI smoke tests the
  Yandex Cloud streaming proxy directly.

- **Mono font → JetBrains Mono.** Code surfaces (Monaco editor, xterm terminal,
  code chips, seeded sandbox preview CSS, `--rf-font-mono`) now use self-hosted
  JetBrains Mono (OFL, variable woff2, latin + cyrillic subsets) in place of
  Roboto Mono; `index.html` preload and `public/fonts/LICENSE.md` updated,
  Roboto Mono woff2 removed. Editor, terminal, and sandbox preview templates
  share a single `glue/fonts.ts` `MONO_FONT_STACK` constant.

- **JetBrains Mono throughout the playground (ADR-0140).** Playground chrome now
  points `--rf-font-sans` at the same JetBrains Mono stack as code surfaces, and
  critical `index.html` styles preload/use JetBrains Mono instead of Inter.

- **Netlify deploy automation.** GitHub Actions now deploys `main` to the
  production site and same-repo PRs to stable `pr-<number>` preview aliases;
  `netlify/functions/npm-registry.mts` carries the npm-registry proxy while
  `public/_redirects` keeps the SPA fallback in the built artifact.

- **ADR-0126 records the preview reload policy.** Preview iframe reloads are
  HMR-client-driven; the snapshot-driven `previewRevision`/`refreshKey` reload
  removed in the preview-routing branch is now ADR-recorded (options,
  rationale, stale-iframe trade-off). Docs/comments only; no behavior change.

- **"Soft Panels" visual redesign (ADR-0124).** UI rebuilt to the Gravity-UI
  design handoff: rounded card panels (`#1D1F26`) with 12px gaps on a
  `#131419` page, rifty lime `#C7F05A` accent, originally Inter (UI) + Roboto
  Mono (code/terminal), now superseded by ADR-0140's single JetBrains Mono
  stack. Top bar now
  hosts the template switcher (dropdown; replaces the activity bar + sidebar
  gallery, same e2e selectors), a LIVE/STARTING/STOPPED status pill, a ⌘K
  command bar, a GitHub link, and a Share button (copies the URL, success
  toast). Preview pane gained browser-frame chrome (address bar with editable
  port, phase pill, reload / open-in-tab). Monaco and xterm re-themed to the
  panel surface with handoff syntax colors; splitters now live invisibly in
  the panel gaps. Layout defaults follow the mockup, with later feedback
  widening preview and raising the terminal.

- **Default preview pane is wider.** Fresh layout state now starts the browser
  preview at 560px instead of the original Soft Panels 464px.

### Fixed

- **Terminal history/state saves serialized (P5 of ADR-0143 "D").** The page
  persists best-effort (`void saveHistory(...)`) per command; under the now
  OPFS-backed owner's write-through I/O the fire-and-forget OPFS writes could
  reorder — an earlier full-array write landing after a later one and dropping the
  most recent command (`terminal-persistence … OPFS after reload` flaked).
  `createTerminalPersistence` now queues writes onto one tail so the latest save
  wins. The reload e2e also waits for a command to finish before typing the next
  (a command typed while the previous runs lands in its stdin — correct terminal
  semantics the OPFS-slowed owner boot exposed; owner boot responsiveness → P6).

- **P2 owner regressions caught only by CI e2e (ADR-0146).** Four baseline
  chromium specs broke under the owner-resident shell and are green again:
  (1) a fork-IPC message-drop race (fixed in `runtime-js`) hung EVERY shell
  command with no output — `pty:open` was posted before the slow owner bootstrap
  registered its `process.on('message')`; (2) preset files (`src/project-summary.js`
  …) reached only the preview worker, so the owner shell `cat`'d ENOENT —
  `seedViteWorkspace` now pushes them to the owner via the new
  `WorkspaceOwnerHandle.writeFile` (a `rifty:vfs-write` frame); (3) the
  PAGE-driven dev-server tab showed `data-running=false` (its session never runs
  through `manager.runLine`) — the tabs now reflect `devServerRunning` for the
  owning session; (4) the cowsay e2e matched the mid-stream `+ cowsay@` and typed
  `cowsay hi` into the still-running install (keystrokes → npm stdin), so it never
  ran — it now waits for the install-complete summary. These slipped past local
  green because the owner path is cross-origin-isolation-gated (CI-only).

- **Seeded sandbox previews now use JetBrains Mono.** The playground chrome,
  Monaco, and xterm had already switched, but the project preview templates
  still carried Roboto/system monospace literals.

- **Netlify npm registry proxy deploy (ADR-0133, supersedes ADR-0028).** CI and
  one-off Netlify deploy docs now run `netlify build` before artifact deploys
  so the function bundle and metadata stay in Netlify's build state; checked-in
  redirects now route `/npm-registry/*` to the production proxy before the SPA
  fallback. The function also falls back to
  `process.env.RIFTY_NPM_REGISTRY_UPSTREAM`, and deploys smoke-test
  `/npm-registry/vite` metadata plus its latest tarball on the live URL.

- **Real Vite worker registers net/sqlite builtins through explicit calls.**
  Production bundling could drop side-effect-only imports and make Vite fail on
  `Built-in 'node:http' is not implemented`; the bootstrap now calls the
  idempotent `@riftydev/net` registrars directly.

### Added

- **Storage persistence + workspace archive.** Playground boot now probes
  `navigator.storage.persisted()` / `persist()` / `estimate()`, threads the
  result into the status badge, and exposes command-palette actions to
  download/import a dependency-free JSON workspace archive that excludes
  derived/heavy directories (`node_modules`, `.git`, `.vite`, `dist`).
- **Production npm registry proxy source.** Netlify routes `/npm-registry/*`
  to `netlify/functions/npm-registry.mts`, preserving metadata/tarball paths
  and adding CORS/CORP headers so the cross-origin isolated playground can use
  the same `/npm-registry` base outside dev.
- **Global command palette (⌘K / Ctrl-K).** Searches project templates,
  workspace files, and shell actions (new terminal, toggle terminal/files
  panels, open preview tab, stop dev server, copy share link). Modal dialog
  semantics with a focus trap, document-level Escape, focus restore on close,
  and keep-in-view arrow navigation. The hotkey is capture-phase and matches
  the physical key, so it works with Monaco/xterm focus and on non-Latin
  keyboard layouts.
- **Express + SQLite fullstack demo template (ADR-0130).** Second runnable
  project template (`node-server` runtime): real `express@4` installed from
  npm inside the worker, static client served from the VFS via
  `express.static`, `node:sqlite` (DatabaseSync over the sql.js WASM engine)
  as the database. New "Express + SQLite" preset in the gallery; covered by
  `tests/e2e/fullstack-demo.spec.ts` plus the opt-in
  `tests/integration/fullstack-demo-live-run.opt-in.test.ts`.
- **`ProjectSpec` is a discriminated union** (`vite` | `node-server`); the
  worker bootstrap dispatches on it — node servers run the ENTRY itself (cwd
  at project root, loud no-listen failure); HMR bridge + esbuild/rollup shims
  stay vite-only. sqlite engine bring-up uses an explicit `wasmBinary` +
  pinned `locateFile` from the bundled same-origin asset.
- **`RIFTY_PLAYGROUND_PORT` env** overrides the dev/e2e port (vite +
  playwright configs) so parallel git worktrees run side by side.

### Changed (migration)

- **Layout persistence key bumped to `rf.layout.v2`.** Old v1 sizes fit the
  pre-redesign shell, and a stale `sidebarCollapsed=true` from the removed
  activity bar would have hidden the files panel with no recovery UI; v1
  state is orphaned and defaults apply on first load.

### Changed (2026-06-11 design feedback)

- **Terminal Stop button removed.** Server state shows in the status pills;
  stopping goes through Ctrl-C in the terminal or the ⌘K palette ("Stop dev
  server"). Matches the handoff, which dropped the button.
- **Default terminal height raised to 280px** (mockup's 212px was too shallow
  for real logs).
- **Preview address copies the real URL.** The shown `localhost:<port>` host
  is virtual; clicking the address copies this origin's SW-routed
  `/preview/<port>/` URL with a toast. The URL serves only tabs the
  playground opens itself (`↗` button) — SW routing scopes a port to its
  owner window (backlog: `service-worker/cross-tab-preview-routing`).

### Fixed

- **Command palette opened pinned to the top-left corner.** `<dialog>` UA
  positioning (absolute + auto margins) escaped the flex centering; the panel
  is now statically positioned inside the scrim.
- **Editor code no longer collides with the right-edge ruler strip.** The
  overview ruler is disabled (minimap already off).
- **Terminal no longer flips to a light theme on light-OS machines.** The
  shell is dark-only; both `prefers-color-scheme` branches now resolve to the
  panel-surface xterm theme.
- **Undefined CSS variables in terminal overlays.** `--rf-ok` and
  `--rf-shadow-2` were referenced but never defined (block-rail / history
  exit-status colors and overlay shadows silently fell back); the token set
  now defines `--rf-ok` and real shadow tokens.
- **Real Vite editor writes are now checked through the real Monaco path.** The
  HMR e2e no longer uses a production-only source setter; it focuses Monaco's
  input, edits the visible model, then waits for the worker-applied write, an
  actual iframe HMR bridge `update` event, and the iframe update. The parent
  preview panel no longer reloads the iframe for every worker VFS snapshot, so
  the e2e cannot pass via explorer refresh alone.
- **Real Vite HMR invalidates by Vite file-change semantics.** Worker-side
  writes now call `moduleGraph.onFileChange(file)` instead of probing
  `getModuleById(file)` and falling back to `invalidateAll()`.
- **HMR bridge channels are per-server tokenized.** The iframe client and bridge
  server share a nonce-scoped URL/channel, so unrelated same-origin code cannot
  join the old predictable port-only HMR channel.
- **Cross-origin isolation failures now explain embedded-browser requirements.**
  The fatal COI guard still refuses to boot without `crossOriginIsolated === true`,
  but the message now calls out iframe/app-browser embeds: the parent page must
  also be cross-origin isolated and the iframe must include
  `allow="cross-origin-isolated"`.
- **`preset.templateId` wired (ADR-0130).** App follows the selected preset's
  template (reactive `activeTemplate()`) instead of always booting the
  registry default; boot line is template-dispatched (`terminalDevLine`:
  `vite` | `npm run dev`), `npm run dev` routes the template's dev script to
  the lifecycle-owning dev-server command, `vite` refuses non-vite templates
  with a hint; spawn env gains Node-idiomatic `PORT`.
- **sql.js pre-bundled** (`optimizeDeps.include`) — lazy CJS discovery from
  the worker chunk made dev Vite re-optimize and full-reload the page
  mid-session, dropping the selected preset and running dev server.
- **Project presets now open starter editor tabs.** File-oriented presets open
  two seeded files beside `src/main.js` as inactive tabs, so users see the tab
  strip immediately while the entry file remains active.
- **Terminal tabs now keep the add button attached to the tab strip.** The
  bottom-console tab list no longer stretches across the whole toolbar before
  the `+` action, so the new-terminal control stays visually glued to the
  terminal tabs while remaining visible when the tab list overflows.
- **Terminal tab switching is regression-covered end-to-end.** Playwright now
  switches Terminal 2 → Terminal 1 → Terminal 2 and asserts the active buffer
  changes with the selected tab.
- **Idle terminal tabs close cleanly.** Closing a newly created terminal no
  longer lets an xterm WebGL teardown exception interrupt Solid's DOM update;
  the console returns to the running terminal with a single active panel.
- **`npm run vite` works in the playground shell.** The seeded Vite project now
  exposes both `dev` and `vite` scripts, and the playground `npm run <script>`
  path routes `vite` scripts through the same visible terminal command that owns
  the real Vite worker lifecycle.
- **Ctrl+C now reaches the shell through the bottom console.** `BottomPanel`
  declared `onSignal` but dropped it before `TerminalPanel`, so the terminal
  echoed `^C` while the playground shell never received `interrupt()`. The
  prop is now forwarded to the mounted xterm wrapper.
- **Terminal command status now reaches xterm markers.** Shell-mode `runLine()`
  returns its exit code through `BottomPanel`/`TerminalPanel` into
  `RiftyTerminal`, so command blocks can show success/failure decorations.
- **Terminal tab completion is wired in shell modes.** The playground now feeds
  `RiftyTerminal` completions from `Shell.commandNames()` at argv-0 and from the
  main-thread VFS for path arguments.
- **Terminal follows OS light/dark preference.** The xterm wrapper now starts
  with a terminal theme derived from `prefers-color-scheme` and updates it via
  `setTheme()` on OS theme changes. The broader playground CSS light theme
  remains its parked backlog item.
- **Terminal find overlay.** Ctrl/Cmd+F inside the console opens a compact find
  box backed by `RiftyTerminal.findNext()` / `findPrevious()`; Enter and
  Shift+Enter walk matches, Esc closes and clears decorations.
- **Terminal command palette.** Ctrl/Cmd+Shift+P inside the console opens a
  command picker seeded from `Shell.commandNames()`; selecting a command
  pre-fills the terminal through `RiftyTerminal.replaceLine()`.
- **Terminal quick fix for command typos.** Shell stderr `Did you mean 'cmd'?`
  diagnostics now surface a console action that runs the suggested command via
  `RiftyTerminal.submitLine()`.
- **Terminal quick fixes are provider-based.** The quick-fix glue now supports
  multiple output providers; `EADDRINUSE` / address-in-use diagnostics offer a
  stop-and-rerun action for the last submitted command.
- **Terminal sticky command header.** The console now pins the command block at
  the top of the xterm viewport and lets you click it to jump back to that
  command.
- **Terminal command-block rail.** Recent command blocks now show as a compact
  status rail in the console; clicking a mark jumps to that block, and the
  sticky command header has an icon action to copy the current block output.
- **Terminal rich history overlay.** Ctrl/Cmd+R inside the console opens a DOM
  history picker backed by rich records (command, cwd, mode, duration, exit
  code, session id) saved through the terminal persistence store; selecting a
  row restores the command line.
- **Terminal state persistence.** The playground now restores shell `cwd` and
  env from `/workspace/.rifty/terminal-state.json` before constructing the shell
  session, then saves updated state after each submitted terminal line. Async
  OPFS is used when available; memory fallback remains session-only.
- **Shell abbreviations/snippets.** Shell-mode terminal input now seeds
  fish-style rewrite rules for `ll -> ls -la`, `la -> ls -a`, and
  `mk -> mkdir -p`.
- **AI command suggestions.** When `VITE_RIFTY_AI_COMMAND_SUGGEST_URL` is set,
  shell-mode `# prompt` lines request a command suggestion, render it as ghost
  text, and accept it by replacement only. Suggestions are filtered to rifty
  coreutils, reject compound shell syntax, and never auto-run; raw `# prompt`
  Enter is a no-op.
- **Background jobs.** Shell-mode `cmd &` now returns the prompt immediately,
  streams background output into the terminal without corrupting the editable
  line, and exposes status through the `jobs` builtin.
- **Terminal raw stdin.** Shell-mode foreground commands now receive terminal
  raw input while running, enabling `mouse-demo` to verify xterm mouse reports
  through the browser.
- **Terminal e2e renderer.** Automated browsers disable the WebGL addon via
  `navigator.webdriver`, keeping xterm's DOM rows available for Playwright
  assertions while normal sessions keep best-effort WebGL.
- **Terminal output export.** The terminal command palette now includes actions
  to copy text output, copy HTML output, and download the serialized scrollback
  as a standalone HTML document.
- **Terminal OSC 8 file links.** Ctrl/Cmd-clicking a `grep` file hyperlink opens
  safe `file:///workspace/...` targets in the editor; non-file, outside-workspace,
  and traversal links are ignored.
- **Shell command-line syntax highlighting.** Shell-mode terminal input now
  colors command words, quoted strings, and shell operators through the
  `@riftydev/terminal` highlighter seam.
- **Shell multiline input.** Shell-mode Enter now keeps editing when quotes,
  bracket groups, or trailing continuations are incomplete; the completed raw
  multiline buffer is submitted as one command.
- **Terminal autocomplete dropdown.** Tab or Ctrl/Cmd+Space inside the console now
  opens a keyboardable DOM completion list backed by the existing shell
  command/path completer; ArrowUp/Down selects, Enter/Tab applies, Esc closes.
- **Real Vite browser e2e covers the full opt-in path.** The `RIFTY_E2E_HMR=1`
  Playwright flow now drives the cross-origin-isolated path: boot Vite in the
  worker realm, render the iframe through SW preview routing, edit `src/main.js`
  through Monaco, write it into the worker VFS, invalidate Vite's module graph,
  and reload the iframe through the cross-realm HMR bridge. The backlog stays
  open until this path has a default or CI verification lane.
- **Terminal no longer overlaps the status bar.** xterm's `FitAddon` computes
  rows from the mount element's height minus *that element's own* padding (the
  `.xterm` div it creates, padding 0) — so the `6px` vertical padding on the
  `.rf-terminal` mount container was never subtracted and the bottom row
  overflowed ~6px past the console body into the status bar. Moved the gap from
  `padding` to `inset` on `.rf-terminal` (+ `--rf-bg-1` on `.rf-console__body`
  so the inset gap stays the xterm surface colour); FitAddon now fits the
  trimmed box. Verified live: 9px clearance above the status bar.
- **Dev-mode preview is now live (HMR auto-reload).** Editing a file in dev
  mode left the preview frozen until a manual page reload: the mini dev server
  (`examples/vite-like-dev`) broadcast HMR over an in-process `WebSocketServer`
  that the preview iframe — a separate realm reached via the SW — can never
  reach. Dev mode now routes HMR through the same cross-realm `BroadcastChannel`
  bridge real-Vite uses: the example dev server gained a pluggable `hmr`
  transport, and `startDevMode` wires `setupHmrBridge` + injects
  `hmrClientScript` into served HTML. Closes the dev-vs-real-Vite HMR asymmetry.
  Verified live: editor edit → watcher → bridge → iframe auto-reloads with the
  new content.
- **Rich-terminal capabilities were dead in the real app — now wired.** The shell
  adapter forwarded none of `isTTY`/`cols`/`rows`/`signal`, so `ls` column layout +
  `--color` never engaged and Ctrl+C never reached the shell. `useShellSession.runLine`
  now passes `isTTY:true` + live `cols`/`rows` (from xterm via `RiftyTerminal`) + a
  per-run `AbortController`; new `interrupt()` is wired to the terminal's `onSignal`
  (Ctrl+C → SIGINT → a running `sleep`/dev-server winds down, exit 130). Threaded
  `onSignal` + dimensions through `BottomPanel`/`TerminalPanel`/`App`. Review pass 2026-06-07.

- **Real Vite preview now renders (and shows progress) instead of looking
  frozen (ADR-0077).** Three stacked breaks fixed: (1) `installProcessGlobals()`
  in the real-vite worker clobbered the kernel-wired `process.stdout`/`stderr`
  with `console.*`, so all install/boot logs — and error stacks — vanished
  (preserve the kernel stdio + env across the swap); (2) the kernel tore the
  worker realm down the instant `bootstrap()` resolved (`self.close()` on entry
  return), killing the Vite dev server right after it started listening → every
  preview request hit a dead worker (`502 bridge-timeout`) — the bootstrap now
  stays alive until `.kill()`; (3) the SW routed the iframe navigation to the
  wrong client (ported ADR-0074). Plus `PreviewPanel` warm-up now uses a
  per-probe `AbortController` + a 90 s budget so it spans an npm install and
  auto-loads to `live` (~22 s) without a manual Reload. Verified live:
  `/preview/<port>/` 200s, the iframe commits and renders the Vite app.
- **Real Vite preview now owns its Service Worker route directly (ADR-0123).**
  The Real Vite page and Worker share a preview `ownerToken`; the Worker mounts
  `setupPreviewBridge(..., { ownerToken, ports: [port] })`, so the SW can route
  `/preview/<port>/...` straight to the matching Worker-owned Vite server. The
  page-side cross-realm preview proxy remains as a compatibility fallback for
  legacy window-owned paths and old-SW/new-page skew.
- **Dev-server console noise removed.** A custom Vite logger filters the
  harmless `Failed to load source map … marked.umd.js.map` warning (monaco 0.52
  ships `marked.umd.js` with a dangling sourcemap ref); dev-only, no runtime
  effect.
- **Console now scrolls.** `xterm.css` was linked from `index.html` as
  `/@xterm/xterm/css/xterm.css`, a path Vite never serves (it resolved to the
  SPA-fallback HTML in dev *and* prod), so xterm rendered without its
  stylesheet — `.xterm-viewport` had `overflow-y: visible` and zero height and
  the terminal could not scroll. Now imported from `main.tsx` (`@xterm/xterm`
  added as a direct dep) so Vite bundles it in dev and prod.

### Changed

- **Generic ProjectSpec/Template runtime — Vite is now just the default template
  (ADR-0078).** The "Real Vite" mode no longer hardcodes Vite across five files;
  a new playground-internal `ProjectSpec` value object (install deps, import
  specifier, createServer knobs, entry, seed files) drives the worker bootstrap,
  the orchestrator, and the mode machine via a new `RIFTY_RFV_TEMPLATE` env var.
  Adding a second runnable template is now a data change (a `ProjectSpec` + a
  preset row with a `templateId`) rather than a worker fork. The pure
  `resolveBootstrapConfig` mapping (incl. index.html-script-src derived from the
  entry) is unit-tested; user-facing "Real Vite" copy is generalised to "Real npm
  project" / "Dev server". Core packages were already Vite-free; no core change.
- **Single generic Templates switcher; header mode toggles retired (ADR-0079).**
  The duplicate header `Real Vite` / `Dev Mode` segment is removed — the
  Templates gallery is the one switcher (entering `dev`/`real-vite` is selecting a
  tile). The ActivityBar Templates button gains a stable `data-action`; the m7/m10
  e2e specs are updated as a **deliberate contract change** (new view-templates +
  `[data-preset]` flow; m10's stale `[real-vite] …` log markers corrected to the
  `[real-vite/worker] …` the worker actually emits). Resolves Q-2026-06-04-316.
- **Templates switcher polish.** The preset gallery is retitled **Templates**
  and its tiles now use vendored monochrome inline-SVG icons (new `icons.tsx`,
  Lucide/ISC paths, zero new dep) instead of full-colour emoji that clashed with
  the monochrome theme; presets declare a semantic `icon` key so the switcher
  scales cleanly to more templates. (Activity-bar tooltip follows: "Templates".)

### Added

- **e2e-gated execSync-over-SAB harness (`#test=execsync`).** A page-realm harness (`src/execsync-harness.ts`) + guest worker entry (`src/workers/execsync-harness-guest.ts`) that proves rifty's real `execSync` path end-to-end in a cross-origin-isolated chromium Worker — the path Node tests cannot exercise (real SharedArrayBuffer + `Atomics.waitAsync` dispatcher wake + ADR-0084 v2 binary frame; the conformance SAB-blocking cases `skipIf(!sabReady)` in Node). `main.tsx` runs it ONLY when `location.hash` includes `test=execsync` (lazy-imported chunk); normal boot is byte-unchanged. The page realm (which owns the kernel dispatcher) seeds the child scripts into its sync mirror, registers the runtime-js `'execSync'` handler on `getKernelDispatcher()` (via the new `@riftydev/runtime-js/ipc/exec-sync-handler` seam), and `spawnWorker`s a guest that runs `execSync('node /child.js')` where the child writes raw non-UTF-8 bytes `[0xff,0xfe,0x00]`; the guest emits the result hex into the DOM. Asserted by `tests/e2e/execsync-sab.spec.ts`: `hex === 'fffe00'` (a broken v2 frame mangles to U+FFFD → `efbfbd...`; a broken dispatcher hangs → timeout — only the real byte-exact round-trip passes) plus a `blocked-result` blocking round-trip. This harness surfaced the kernel SAB JSON-frame `TextDecoder`-on-shared-view bug (fixed in `@riftydev/kernel`).

- **Lazy `node_modules` browsing in the explorer (ADR-0080).** The reverse
  snapshot (ADR-0076) excludes `node_modules`; a new two-way request/response
  read bridge (`node-modules-port.ts`, the symmetric complement of the one-way
  write/snapshot ports) now lets the real-vite explorer browse it lazily — one
  directory level per expand, fetched from the worker and cached
  (`NodeModulesCache`), with loading/error rows and `node_modules` files opening
  read-only in the editor (≤128 KiB inline, larger shown size-only). A
  normalised-segment scope guard keeps it a package browser, not a general remote
  FS; over-cap files reply `content:null` (no silent empty read). The sync
  `FsOpsTarget` path is untouched — the async branch is keyed only on the
  `node_modules` subtree. Pure logic (the port round-trip, the cache, the
  `composeNodeModulesRows` interleave) is unit-tested.
- **File explorer reflects the Real Vite worker project (ADR-0076).** Switching
  to Real Vite now switches the explorer **into the Vite filesystem**: a new
  one-way worker→page VFS snapshot bridge (`vfs-snapshot-port.ts`, the mirror of
  the page→worker write port) publishes the worker realm's project tree — sans
  `node_modules` — which the page renders through a **read-only** `SnapshotFs`.
  The view is live (updates on install + every Vite watch), honestly read-only
  (mutation controls hidden, a `read-only` badge, worker files open view-only —
  no fake writes), and clears on leaving the mode. Closes the split-VFS gap
  ADR-0075 flagged for real-vite. Pure logic (`collectSnapshot`, `SnapshotFs`)
  is unit-tested.
- **VSCode-style shell (ADR-0075).** Recomposed the playground into a real
  workbench: a lime "alive-spine" **activity bar** toggling the sidebar between
  a **file Explorer** and the Presets gallery, an **editor tab bar** over a
  multi-model Monaco, the **console relocated to a bottom panel** (spanning the
  editor area; collapsible to a header strip without unmounting xterm), preview
  as a right "Simple Browser" pane in dev/real-vite, and a **status bar** (mode,
  active file, language, COI, relocated storage badge). All panels are
  **resizable + collapsible** via a hand-rolled zero-dep `<Splitter>` (pointer
  drag, double-click reset, `role="separator"` + arrow-key resize, persisted to
  `localStorage`, iframe-pointer guard during drag).
- **VFS file explorer (ADR-0075).** Lazy-expand tree of `/workspace` over the
  main-thread `syncMirror()` (reflects shell `npm install` + user edits): open,
  new file, new folder, rename (files and dirs via a real recursive copy), and
  delete-with-confirm; signature-gated 1.5 s poll (the VFS exposes no change
  events). New pure modules under `src/glue` (`file-tree`, `fs-ops`,
  `editor-tabs`, `layout-store`, `splitter-size`) with unit tests.
- **Multi-model editor tabs (ADR-0075).** One Monaco model per tab (`setModel`
  on switch — no spurious writes); a permanent **program tab** stays bound to
  `machine.source`/`setSource` (initial JS runner + dev/real-vite HMR unchanged)
  under a single `suppressProgramEcho` guard; files opened from the explorer get
  their own model with debounced VFS write-back. `monaco-env` gains the json /
  css / html language workers.
- **Preset gallery — click-to-run examples (ADR-0073).** New `src/presets.ts`
  + `src/components/PresetGallery.tsx`: a category-grouped left rail of
  example programs (Welcome, Event-loop order, Node core modules, Virtual
  filesystem, Dev server + HMR, Real Vite + npm). Selecting a preset loads
  its source and switches mode; JS-runner presets auto-run. Every preset is
  grounded in a capability traced through the source and covered by the
  e2e/conformance suites — no stubs. The boot preset still prints
  `worker alive` (M1 e2e contract).
- **Design system "terminal-luxe" (ADR-0073).** New `src/styles/theme.css`
  with CSS-variable tokens (cool-ink palette, acid-lime accent, hairlines,
  film grain, staggered load), class-based components replacing inline
  styles, a custom Monaco `rifty-dark` theme, and self-hosted OFL fonts
  under `public/fonts` (IBM Plex Mono + Bricolage Grotesque, bundled
  `.woff2` assets — no CDN, no npm dep). New `public/favicon.svg`.
- **Honest preview status.** `PreviewPanel` warms up the route, navigates the
  iframe, and reports `live` only on a real navigation commit (else
  `unavailable` with a hint) — see ADR-0073's known-limitation note and
  OPEN_QUESTIONS Q-2026-06-03-308.
- **Netlify hosting (`netlify.toml`).** pnpm monorepo build, COOP/COEP
  headers (mirrored from `public/_headers`), SPA fallback, prod publish of
  `apps/playground/dist`.
- **`useMode.loadPreset()` + `useRuntime.whenReady()/isRunning()`.** Preset
  loading transitions modes; JS-runner eval gates on worker readiness.

### Fixed

- **Production runtime worker never loaded (ADR-0073).** `useRuntime.ts` and
  `main.tsx` now import the worker entries via `?worker&url` instead of
  `new URL(..., import.meta.url)`, so `vite build` actually emits + bundles
  the `worker-entry` / `kernel-worker-entry` chunks. Previously the prod
  build shipped no worker chunk and the runtime worker crashed on boot
  (`[worker error] undefined`) in any hosted build — invisible to CI, which
  only runs against `pnpm dev`.
- **Monaco language-service console spam.** New `src/glue/monaco-env.ts`
  wires `MonacoEnvironment.getWorker` (Vite `?worker` imports), removing the
  per-keystroke `toUrl` `TypeError` from the TS diagnostics adapter.
- **Editor ignored external source changes.** `EditorPanel` now reacts to
  `value` updates, so selecting a preset actually replaces the editor
  content.
- **Auto-run / Run could throw "Runtime is not running"** when fired before
  the worker booted — both now gate on `useRuntime.whenReady()`.

- **`npm install …` at the shell prompt (follow-ups item #15, 2026-05-27).**
  New glue file `apps/playground/src/glue/npm-shell-command.ts` registers
  an `npm` builtin on the long-lived `ShellSession` so typing
  `npm install express` in the terminal actually runs the installer
  instead of returning exit 127 ("command not found"). Supports
  `install` / `i` / `add` subcommands, plain `name`, `name@range`,
  scoped `@scope/name[@range]`, auto-creates a minimal `package.json`
  when the project has none, and merges new deps into existing ones.
  Bare `npm install` reads existing deps but does **not** rewrite
  `package.json`, so re-runs do not churn mtimes. Error mapping for
  `EVERSIONCONFLICT` / `EINTEGRITY` / `EBROKENLOCK` produces single
  operator-friendly stderr lines instead of stack traces. Flags
  (`--save-dev` etc.) are explicitly rejected as M9-scope. The
  `install` function is injected via a DI seam so the unit tests run
  without reaching across into another package's `_test-fixtures/`.
- **`ShellSession.registerCommand(name, cmd)` accessor.** Exposes the
  underlying `Shell.registerCommand` so composition-root glue can wire
  builtins (`npm`, future `node`) without `useShellSession` needing to
  know about them.

### Changed

- `adapters/useMode.ts` — extracted the `repl | dev | real-vite` mode state
  machine out of `App.tsx`. The new adapter owns the `mode` signal, the
  dev/real-vite handles, the real-vite port, and the editor source, and
  exposes `toggleDev` / `toggleRealVite` / `setSource` transitions that
  preserve the original branch-on-`mode()` semantics byte-for-byte. App.tsx
  shrinks to JSX + wiring (315 → 259 LOC; four signals + two transition
  branches moved into the adapter). Closes the P0 finding in the 2026-05-26
  playground audit ("App.tsx is a god-component juggling lifecycles the
  adapters should own").
- **ADR-0040:** the preview-bridge handshake stamped by
  `mountPlaygroundPreviewBridge()` now sends two version fields
  (`frameVersion`, `routingVersion`) instead of a single `version` field.
  The change is transitive — `setupPreviewBridge` from
  `@riftydev/service-worker` does the actual stamping; the playground
  wiring is untouched at the call site. A version mismatch on either
  contract surfaces as HTTP 503 from the SW the same way as before,
  with the warning now naming the drifted contract (`frame` or
  `routing`).

### Added

- Initial Solid UI scaffold: header + Monaco editor + xterm.js terminal in a 1:1 split, plus Run / Reset buttons.
- COOP/COEP headers in `vite.config.ts` (D-001) for cross-origin isolation, both in `server` and `preview` modes.
- Capabilities-detection fallback panel that explains which feature is missing if the browser isn't cross-origin-isolated.
- Service Worker registration on mount; failures surface in the terminal (red).
- `useRuntime` adapter as the single bridge between Solid signals and the framework-agnostic runtime controller (D-002).
- Dev proxy `/npm-registry → registry.npmjs.org` to make M9 wiring testable from day 1 (D-004).
- Runtime cross-origin-isolation guard (`assertCrossOriginIsolated` in `src/boot.ts`): if the page boots without `crossOriginIsolated === true`, paint an inline fatal banner and throw before any SAB-consuming code runs. Defence-in-depth for ADR-0002 in case COOP/COEP headers regress at the host.
- `bootstrapPlayground()` — single awaited pipeline in `src/boot.ts` that runs the COI guard, `initBackend()` (VFS), and `registerServiceWorker('/sw.js')` in order. `main.tsx` awaits it before `render(...)`, so the App always sees a fully-resolved boot bundle. Closes A-004 (REVIEW_ACTIONS): persistence wiring is in place, plus an e2e reload assertion in `tests/e2e/m0-boot.spec.ts`.

### Added

- `adapters/shell-adapter.ts` — `useShellSession()` hook that owns a
  long-lived `@riftydev/shell` `Shell` and forwards stdout/stderr to the
  terminal writer via the new `onChunk` callback. App.tsx consumes it in
  `dev` / `real-vite` modes so users can drive `npm install`, `vite dev`,
  file ops, and `&&`-chained commands from the terminal in real time.
  Closes Tier 0 finding 1 in the 2026-05-26 review (`@riftydev/shell` was
  declared as a dep but had zero consumers).
- `adapters/hmr-bridge.ts` — cross-realm HMR bridge (ADR-0017 phase 1
  acceptance). `setupHmrBridge({port})` hosts a `BridgedWebSocketServer`
  on `ws://preview.local:<port>/__hmr`; `createHmrBridgeVitePlugin({port})`
  injects a vanilla-JS `BroadcastChannel` client into the served
  `index.html` via `transformIndexHtml`; `realVite.ts` wires
  `server.watcher.on('change', ...)` to broadcast through the bridge.
  The iframe HMR client and Vite-side server now share the bridge's
  wire protocol — no native `WebSocket` involved, so HMR survives the
  page ↔ iframe realm boundary. Precursor to M11 A-026 (Vite-in-Worker):
  the migration becomes a realm swap, not a routing rewrite. Closes
  Tier 2 finding 9 in the 2026-05-26 review (`BridgedWebSocket` was
  built but had no callsites).
- `adapters/preview-bridge-wiring.ts` — `mountPlaygroundPreviewBridge()`
  extracts the byte-identical `setupPreviewBridge` handler that
  `devMode.ts` and `realVite.ts` each carried in-place. Closes the
  "Duplicated preview-bridge wiring" finding in the 2026-05-26
  architecture review (Appendix → playground).

### Changed

- `App` no longer races a `registerServiceWorker()` call in `onMount`. The SW is registered by `bootstrapPlayground()` before render; failures flow through `BootResult.swError` to the existing dismissible banner. Removes the small window where the JS runner was interactive but the preview iframe was not yet routable.

### Fixed

- `SyncMirrorVfs.openReadable` now throws `NotImplementedError('SyncMirrorVfs.openReadable')` instead of a bare `Error` — surfaces the gap as a structured, catchable error per the CLAUDE.md "no silent stubs" hard rule. The path is preserved in the hint for diagnostics.
