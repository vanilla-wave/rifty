---
kind: epic
status: ready
title: Frictionless first poke — the curious newcomer's first 15 minutes
created: 2026-06-30
value: A developer who opens the playground out of curiosity pokes the terminal + editor for 15 minutes and hits no easily-fixable wall — basic node/npm sanity checks work, every ceiling fails loud+directed, and a reflexive reload/close never silently destroys their work.
user_story: As a developer who just arrived from the announcement and wants to poke around, I want my reflexive first moves (`node -v`, `node -e`, `cat x | grep y`, `npm test`, edit+Cmd+S) to work or fail with a friendly directed error, but today `node --version` throws `Cannot find module '/workspace/--version'`, the terminal is a bare grey prompt, pipes/`npm -D`/`npm test` hard-fail, and a reflexive Cmd+W/Cmd+R silently nukes an in-memory session.
items: [playground/node-cli-flag-handling, shell/help-builtin, playground/terminal-welcome-banner, playground/npm-shell-flag-and-script-tolerance, shell/command-suggestion-denylist, playground/casual-session-data-loss-guards, playground/dead-ui-affordance-honesty, playground/cold-boot-loading-skeleton, shell/pipes, shell/input-redirect, shell/command-substitution]
---

## Outcome

rifty's first-impression risk is the UNGUIDED poke. The launch epics get a curious dev INTO the tab (`open-auditable-launch` deep-link), give them somewhere to read (`webcontainers-alternative-search-slot`, `wasi-in-browser-showcase`), and a writable file/git surface (`scm-file-manager`). None covers the 15 minutes AFTER they land and start typing on their own. Today that poke hits a row of EASILY-fixable walls that read as "fundamentally broken": `node --version` throws `MODULE_NOT_FOUND`, the terminal is a bare grey prompt with no `help`, `cat x | grep y` / `npm test` / `npm i -D` hard-fail, and a reflexive Cmd+W/Cmd+R silently destroys an in-memory session — while the runtime UNDER all of it already works. This epic clears those walls so a developer's own first moves either work or fail loud+directed, and the faithful runtime earns the trust the launch is spending to win. Mission anchor: more developers running real Node software in the browser — and believing it after they poke it themselves. Honest ceilings stay loud (bare-`node` REPL, `https.get`, `gzipSync`, native modules) — the win is never faking them, only making the casual gaps next to them work and the ceilings point at the working path.

## User scenario

A developer arrives from the announcement and starts poking, unguided:

- terminal greets with a version line + `try: node -v · npm install chalk · help`;
- `node -v` prints `v24.0.0`; `node -e "console.log(1+1)"` prints `2`; `help` lists the commands;
- `cat package.json | grep name` and `ls | wc -l` pipe; `echo $(date)` fails LOUD (not silent-wrong);
- `npm install chalk` works, then `npm test` and `npm i -D vitest` don't choke; a fat-fingered `npx`/`pnpm` gets a useful nudge, not a wrong one-click `Run npm`;
- they edit the open file: Cmd+S doesn't pop the browser "Save page" dialog, Cmd+W closes the editor tab (not the browser tab), and a reflexive Cmd+R doesn't silently nuke their work;
- every genuine ceiling they brush (bare `node` REPL, `https.get`, `zlib.gzipSync`) fails with a directed message naming the working alternative.

Done when a scripted "curious first 15 minutes" e2e walks this path with zero errors that look unfixable, and each owned item below is `ready`+landed. Acceptance is binary: the e2e is green and no step surfaces a bare `MODULE_NOT_FOUND` / `command not found` / `unknown subcommand` on a reflexive casual move.

## Items

Tier 1 — net-new quick wins (S/M, pre-announce):

- `playground/node-cli-flag-handling` — `node -v/--version` prints the version; `-e/-p` run via the real loader; an unknown `-flag` → `bad option`, not MODULE_NOT_FOUND. Load-bearing (unblocks the whole `node -e` exploration path).
- `shell/help-builtin` — `help` lists builtins + notes node/npm/vite run programs.
- `playground/terminal-welcome-banner` — version + `try:` hints before the first prompt.
- `playground/npm-shell-flag-and-script-tolerance` — accept `-D/--save/-S`; alias `test/start/stop/restart` → `run`.
- `shell/command-suggestion-denylist` — suppress the wrong one-click `Run <builtin>` for npx/yarn/pnpm/sed/tree/code…; nudge package managers to npm.
- `playground/casual-session-data-loss-guards` — beforeunload (memory+dirty) + Cmd+W (close tab) + Cmd+S (no save-page dialog, flush+ack).
- `playground/dead-ui-affordance-honesty` — wire the dead "Export soon" chip to the working archive download; stop the Share toast implying it shares edits.
- `playground/cold-boot-loading-skeleton` — a static skeleton so a slow first load isn't a blank dark screen.

Tier 2 — reflexive terminal walls (adopted from the shell backlog; the `cat x | grep y` muscle memory):

- `shell/pipes` (draft — clear path) — `a | b` stdout→stdin; THE most reflexive terminal action. Not a ceiling — in-process plumbing (the dispatcher + several builtins' stdin). Launch-blocking slice = a working `cat|grep|wc|head|tail` chain.
- `shell/input-redirect` (draft — clear path) — `cmd < file`; symmetric to the working `>`, shares the pipe stdin contract.
- `shell/command-substitution` (draft — clear path) — `$(…)`/backticks. Launch-blocking slice = make it LOUD (today it silently passes the literal — a Fidelity violation); full splice rides the pipe infra.

## Related (serve first-impression, owned elsewhere — do NOT duplicate)

- Casual node-API slices: `crypto.createHash('sha512')` → `runtime-js/crypto-sync-subset-expansion`; bare `TypeError` on `process.memoryUsage`/`crypto.pbkdf2Sync` → name them via `runtime-js/node-builtins-loud-stub-capability-gaps`; the `require()`-of-ESM shape → `runtime-js/esm-import-miss-err-module-not-found`. Broader than first-poke; the casual slices are sub-cases tracked there.
- File affordances a newcomer reaches for (UI New file / single-file download / drag-drop upload) → owned by `scm-file-manager` (`owner-routed-explorer-crud`, `explorer-file-download`, `explorer-dnd-upload-compare`); infra-coupled (owner-RPC writable FS), so left there. `touch <file>` covers the casual create today.
- Real share-by-link / `?preset=` deep-link → `playground/launch-deeplink-real-npm` (open-auditable-launch) + the M13 share item.
- Coreutils (`date/sort/uniq/cut/tee`), `grep -A/-B/-C`, `.env` auto-load, image/binary preview, mobile layout — real but lower casual-priority and most useful AFTER pipes; promote to owned items on demand, not launch-blockers.

## Ceilings a curious user WILL brush (keep loud — only sharpen the message)

- bare `node` (expects a REPL) — interactive stdin into a persistent child is a documented ceiling (ADR-0155); message → point at `node <file>` / `node -e`.
- `https.get` → point at the working global `fetch()`; `zlib.gzipSync` → point at async `zlib.gzip` (CompressionStream is async-only); native/postinstall packages → name the package+hook. None faked.

## Out of scope (this epic)

- Running big projects, production builds, deliberate-break attempts — not the casual first poke.
- New file-manager/git UI (`scm-file-manager`), marketing/README/benchmark (`open-auditable-launch`), the compare page/blog (sibling epics).
- Full bash syntax (job control, `${VAR:-x}` param-expansion, heredocs), full coreutils — only the reflexive subset above.

## Reversibility

Every owned item is REVERSIBLE (playground/shell UX, no public API, no ADR) → CHANGELOG lines in the affected package. No new dependency. The epic is a prioritization umbrella; pulling an item back to its area backlog is a frontmatter edit.
