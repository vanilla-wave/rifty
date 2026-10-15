# Evidence — guest-package patches refine (2026-10-15)

Method: scratch Playwright specs (not committed; minimal repro lines inline
below) over `tests/e2e/helpers/playground.ts` (`bootProjectFiles`,
`openShellTerminal`, `runTerminalLineSettled`, `terminalBuffer`), Chromium via
Playwright 1.60.0 (chromium 1223 = Chromium 148.0.7778.96), `pnpm dev` webServer, worktree HEAD `9645c62bf`, clean
tree before and after. Guest identity `node v24.0.0` (rifty). Oracle: real
Node v24.16.0 on macOS (Darwin 25.6.0), `node -e <same line>` in `/tmp`.
Logs lived in `/tmp/probe-*.log` (not committed); excerpts verbatim.

## Probe 1 — Vite CAC keepalive hook (patch №1) is not load-bearing for `vite build`

Two arms, one run each, vite starter (`project-files`), terminal `vite build`
then `ls dist/assets`:

- baseline: committed `vite-cli-prep.ts:181`
  `globalThis.__riftyTrackCliPromise = options.trackKeepalivePromise`;
- inert: same line replaced by `(p) => { void p; }` (patched `cli.js` bytes
  untouched — the snapshot already carries them; only the host hook is a no-op).

Both arms, identical terminal output:

```
> vite build
vite v7.3.6 building client environment for production...
✓ 7 modules transformed.
dist/index.html                 0.36 kB │ gzip: 0.27 kB
dist/assets/index-6SyGhL33.css  0.96 kB │ gzip: 0.43 kB
dist/assets/index-CS3YMO0G.js   1.70 kB │ gzip: 0.90 kB
✓ built in 122ms            (inert arm: 135ms)
> ls dist/assets; echo PROBE_EXIT_DONE
index-6SyGhL33.css  index-CS3YMO0G.js
PROBE_EXIT_DONE
```

No page errors either arm. Reading: on this path the action promise is
already covered by counted handles — esbuild's own `refs` (generated patch
`runtime-service-refs`: `refs ??= runtimeRefs`, the exact analogue of
upstream Node `child.ref()/unref()` at `esbuild/lib/main.js:2308-2311`),
counted timers, counted `import()`; `fs.promises` is microtask-settled sync
RPC (`fs.ts` `promises` :1146 and callback twins :1239-1545 settle via
`Promise.resolve().then(sync)` / `.then` over sync reads), so it needs no handle.
One run per arm: this shows the hook is not required on the happy path, not
that no window exists on larger inputs.

Origin of the hook: `fdeefa15a` (2026-06-26, ADR-0174 "honest Vite CLI
dispatch"), before ADR-0226's generated esbuild client (2026-07) and before
`runtime-service-refs` (first commit `99caa40f3`, 2026-09-11). No ADR names
the hook; ADR-0384's inventory (`registry-package-adaptations-evidence.md:15`)
lists it as "Vite CLI promise/watch patches".

## Probe 2/3 — host-task-async Node APIs are uncounted by the drain (ADR-0152 §1 gap)

Terminal `node -e "<line>"` on the vite starter; each line prints `TOP` at
top-level, then has exactly one pending host-async carrier. Node v24.16.0
prints the DONE line and exits 0 in every case.

| # | pending carrier | line (abridged) | Node 24.16.0 | rifty (Chromium) |
|---|---|---|---|---|
| Z | `zlib.gzip` 64 MiB (CompressionStream) | `z.gzip(Buffer.alloc(64<<20,65),(e,r)=>log('ZDONE',r.length))` | `ZDONE 65251` | `ZDONE 65251` |
| C | `crypto.subtle.digest` SHA-256 128 MiB | `crypto.subtle.digest('SHA-256',buf).then(d=>log('CDONE',d.byteLength))` | `CDONE 32` | `CDONE 32` |
| B | `buffer.Blob#arrayBuffer` 64 MiB | `new Blob([buf]).arrayBuffer().then(b=>log('BDONE',b.byteLength),e=>log('BERR',e))` | `BDONE 67108864` | **silent exit, no BDONE/BERR** |
| F | `fs.promises.readFile` 32 MiB | `fs.promises.readFile('big.bin').then(b=>log('FDONE',b.length))` | (sync RPC in rifty) | `FDONE 33554432` |
| B' | B + `setTimeout(()=>{},8000)` hold (control) | | | `BDONE_HELD 67108864` |
| W | `WebAssembly.compile` 6 M-nop module | `WebAssembly.compile(bytes).then(m=>log('WDONE',…),e=>log('WERR',e))` | `WDONE 0` | **silent exit** |
| O | `fs.openAsBlob().arrayBuffer()` 32 MiB | `fs.openAsBlob('big.bin').then(b=>b.arrayBuffer()).then(b=>log('ODONE',…))` | `ODONE 33554432` | **silent exit** |
| P | `crypto.subtle.deriveBits` PBKDF2 3 M iterations | `importKey(...).then(k=>deriveBits({…iterations:3000000},k,256)).then(b=>log('PDONE',…),e=>log('PERR',e))` | `PDONE 32` | **silent exit** |

Full W line (module bytes synthesized in-guest):

```
node -e "const n=6000000;const leb=(v)=>{const o=[];do{let b=v&0x7f;v>>>=7;if(v)b|=0x80;o.push(b)}while(v);return o};const bodyLen=n+2;const codeLen=1+leb(bodyLen).length+bodyLen;const head=[0,0x61,0x73,0x6d,1,0,0,0,1,4,1,0x60,0,0,3,2,1,0,10,...leb(codeLen),1,...leb(bodyLen),0];const bytes=new Uint8Array(head.length+n+1);bytes.set(head);bytes.fill(1,head.length,head.length+n);bytes[bytes.length-1]=0x0b;WebAssembly.compile(bytes).then(m=>console.log('WDONE',WebAssembly.Module.exports(m).length),e=>console.log('WERR',String(e)));console.log('TOP')"
```

Reading: B′ (control) proves the Blob promise settles when a counted handle
holds the loop, so B/W/O/P are drain reaps at `refCount 0` (ADR-0152 §1 +
ADR-0445 two-sample idle confirm), not rejections — no stderr, no exit
diagnostic: a silent drop. Z and C passed on timing (CompressionStream and a
single digest settle inside the two host-task idle window); neither `zlib.ts`
nor `crypto` references `event-loop-keepalive` (consumer grep
`keepaliveRef|event-loop-keepalive` over `packages/runtime-js/src`: timers,
loader, fetch-keepalive, fs-streams (timer-backed), child_process,
message-port-ref, worker-reference, process — no zlib/crypto/buffer/wasm).
`keepalive-residual-gaps.md` states "No behavioral gap remains" — false on
`9645c62bf` for every row in bold. In libuv terms these are threadpool /
platform requests Node counts as active; ADR-0152 §1 names them "other libuv
handle classes NOT counted" and requires a superseding/extending ADR
(precedents ADR-0158 fetch, ADR-0446 Worker, ADR-0447 MessagePort).

## Root `/` class (patches №2, №3) — facts, no probe

- ADR-0280: public `/` = the active project's exact tree; reserved `/.rifty`
  only. ADR-0433 §Alternatives rejected changing the root "for one
  string-slice edge case"; it proved real Node+Vite 7.3.6 reproduce the slice
  defect at root `/`.
- Instances in the installed Vite bundle (7 and 8): chokidar `DirEntry.add`
  empty-name at `/` (policy `viteRootWatchPatchPolicy`, origin `da485021f`
  #314 consolidation; earlier Workbench-owned) and `normalizeResolvedIdToUrl`
  `root.length` slice (ADR-0433).
- Same axis, unpatched: `os.tmpdir()` → `/tmp`, `os.homedir()` → `/home/rifty`
  (`os.ts:13-18`) resolve inside the project tree under ADR-0280; no code
  seeds or reserves `/tmp` (`grep '/tmp'` over runtime-js/workbench/vfs/shell:
  only `os.ts`). `fs.mkdtemp(path.join(os.tmpdir(),'x-'))` → ENOENT, probed:
  §Location probe.
- Literal `=== '/'` sites in prod source: ~120 (grep over packages/apps/tools
  excluding tests/dist; not all root-as-project);
  public cwd `'/'` literals: `pty-client.ts:182,800,919`,
  `workbench-browser-owner-spawn.ts:62,76`, `playground-terminal-state.ts:69`,
  `project-runtime-acquisition.ts:12`. Projection seam exists:
  `project-file-boundary.ts` `toOwnerProjectPath/toProjectPath` +
  `remoteFsRoot` (ADR-0280). ADR-0278: outward archives use public root `/`.
  Handoff claim (unverified here): WebContainers mount `/home/projects/<id>`.

## Root — real Node + Vite at project root `/` (container, 2026-10-15)

Linux container `docker.io/library/node:24` (Node v24.22.0) under colima on
the macOS host; project files copied to `/` (`package.json`, `index.html`,
`vite.config.js` with `plugins:[react()]`, `src/main.jsx`, `src/App.jsx`);
`npm install` at `/`: vite 7.3.6, @vitejs/plugin-react 5.2.0, react 19.2.8.
Script `/tmp/viteroot-probe-docker.sh` (not committed; steps inline).

- Run 1, stock config, `vite build` at `/`: `✓ 28 modules transformed … ✓ built
  in 548ms`, `dist/index.html`, `dist/assets/index-MpffJ1vb.js`. Build works.
- Run 1, `vite --host 0.0.0.0 --port 10534 --strictPort` at `/`
  (`DEBUG=vite:hmr`): chokidar walks the whole filesystem — `[file change]`
  lines for `etc/gai.conf`, `etc/group`, `etc/hosts`, … then
  `Error: EINVAL: invalid argument, scandir '/proc/83/net'` emitted on the
  FSWatcher → unhandled `'error'` → process exits. Dev at `/` does not survive
  startup without ignoring pseudo-filesystems.
- Run 2/3, `server.watch.ignored: ['/proc/**','/sys/**','/dev/**','/run/**',
  '/var/**','/etc/**','/usr/**']`: `VITE v7.3.6 ready`; ~1 s later
  `[vite] vite.config.js changed, restarting server...` with no edit, together
  with phantom `[file change]` for untouched `.dockerenv`, `index.html`,
  `package.json`, `package-lock.json`, `home/node/.bashrc`, `root/.profile`;
  the same burst again at +34 s (second restart), then
  `node::OOMErrorHandler` — the server dies. The HTML preamble served
  `import { injectIntoGlobalHook } from "/@react-refresh"`; `/src/App.jsx`
  returned 0 bytes during the restarts and the Playwright page never rendered
  (`h1 PROBE_V1` timeout), so the HMR identity oracle could not run.
  Reading: the rifty symptom behind `viteRootWatchPatchPolicy` ("mistake `/`
  for an empty child entry and repeatedly restart after loading
  `vite.config.js`", `de26804b1` CHANGELOG) reproduces on real Node at `/`:
  chokidar's `DirEntry` catalog at root `/` registers the root as its own
  empty-named child and re-emits changes for everything under it. Class
  `upstream-edge`, artifact above.
- Run 4 (`server.watch: null`): preamble served, then `/src/main.jsx` and
  `/src/App.jsx` returned 0 bytes and Node aborted (`Aborted (core dumped)`,
  native stack) — the default `optimizeDeps` entry crawl (`**/*.html` from
  root `/`) walks the whole filesystem.
- Run 5 (`server.watch: null` + `optimizeDeps.entries: ['index.html']`, the
  minimum that serves modules at `/`; same config in an ordinary-root control
  `/home/node/app` sharing the same `node_modules`):

  | | project root `/` | control `/home/node/app` |
  |---|---|---|
  | HTML preamble | `import { injectIntoGlobalHook } from "/@react-refresh"` | same |
  | `/src/App.jsx` refresh import | `import * as RefreshRuntime from "/@id//@react-refresh"` | `import * as RefreshRuntime from "/@react-refresh"` |
  | `/src/App.jsx` dep import | `"/@id//node_modules/.vite/deps/react.js?v=b4b94210"` | `"/node_modules/.vite/deps/react.js?v=6fe533cb"` |
  | `/src/main.jsx` component import | `import App from "/@id//src/App.jsx"` | (ordinary `/src/App.jsx`) |

  Reading: at root `/` real Vite's `normalizeResolvedIdToUrl` slices
  `root.length` and wraps every id as `/@id//…`; the preamble's Refresh module
  (`/@react-refresh`) and the component's (`/@id//@react-refresh`) are two
  URLs → two module instances, the exact identity split ADR-0433 observed in
  rifty. Class `upstream-edge` for `viteRootUrlPatchPolicy`, live-server
  artifact above (ADR-0433 had only the isolated function).

Summary of "Vite works at `/` on a real system": `vite build` yes; `vite dev`
no — stock config dies on `/proc` (run 1); pseudo-fs ignored → phantom
`vite.config.js` restarts, spurious change events, OOM (runs 2-3); watcher off
→ optimizer crawl abort (run 4); watcher off + explicit entries → served, but
with the split Refresh identity (run 5). Both rifty root patches therefore
compensate upstream behavior at `/`, not a rifty divergence; rifty's `/` is
survivable only because it holds one project.

## Location probe — what a program sees today (Chromium, 2026-10-15)

Scratch Playwright spec over the vite starter terminal, HEAD `9645c62bf`:

```
> pwd; ls -a /
/
.  ..  .git  .gitignore  README.md  index.html  node_modules  package-lock.json  package.json  src  vite.config.js
> node -e "…console.log('OS',os.tmpdir(),os.homedir(),process.cwd(),process.env.HOME);try{console.log('MK',fs.mkdtempSync(p.join(os.tmpdir(),'x-')))}catch(e){console.log('MKERR',e.code)};try{console.log('HOME',fs.statSync(os.homedir()).isDirectory())}catch(e){console.log('HOMEERR',e.code)}"
OS /tmp /home/rifty / undefined
MKERR ENOENT
HOMEERR ENOENT
```

Reading: the project is the filesystem root; `os.tmpdir()`/`os.homedir()`
resolve into it and do not exist; `process.env.HOME` is unset.

## Dedup

- `runtime-js/keepalive-residual-gaps.md` — same mechanism (ADR-0152 §1 set);
  its "no behavioral gap" claim is superseded by Probe 2/3.
- `npm-client/reference/registry-package-adaptations-evidence.md` — the
  adaptation inventory (ADR-0384); no per-adaptation class/authority column.
- `distribution/README.md` listed `workbench-guest-vfs-namespace.md`, deleted
  in `de26804b1` (resolved by ADR-0280) — stale row, removed in this refine.
- `docs/adr/README.md` §Declined: "Realm-wide async-source census for resident
  readiness" (ADR-0378) — declines counting *all* async sources for readiness;
  does not cover per-handle-class keepalive extension (ADR-0158/0446/0447 pattern).
- Vite 7.3.7 / proven-version policy — separate refine (handoff §Фон), not here.

## Review record

- 2026-10-15 — premise critic (fresh read-only general-purpose subagent, run
  during FIT with the real-Node-at-`/` probe still open): `challenge:
  2026-10-15 — 4 problems` — E1/C2 root goal downgraded to a question; F
  principle "inadmissible" vs "debt → item" and ADR-0384/0433; C1 catalog
  substitutions omitted from item 3; B item-2 `blocked_by` by ordering fiat.
  Advisory: I1 refuse-by-name clause is an agent policy; `fs.ts:256-284` cite
  is `Dir.read/close`; hook removal changes the rejection path (trap instead
  of hook) — needs a failing-config exit row; machine-gate attribution; the
  location item misclassified DEC-1 p5 (ADR-0280 Decision literally decides
  `/`). All four resolved in the drafts (goal §Challenge); advisories applied.
- 2026-10-15 — `RDY-6` §Final check (fresh read-only general-purpose
  subagent; reviewed `9645c62bf` + the uncommitted draft set): `final-check:
  2026-10-15 — PASS`, 13 advisories. Applied after the pass (no scope change):
  Outcome (3) no longer says "zero platform-gap rows"; ADR-0384 §3 cite →
  inventory doc :15; location scenario ENOENT marked unprobed; temp/home
  clause marked agent-proposed FIT input; location fog split user/agent; item
  1 refuse-vs-hold deferred to the pickup ADR; scenario row B = executed line;
  CHANGELOG/AGENTS/fault-classes wording aligned; title shortened. Noted for
  pickup: I1 clauses beyond B/W/O/P rest on the consumer grep (item 1 sweep);
  root-watch authority is symptom-level (item 3).
- 2026-10-15 — second user round after the report («мы точно обсудили всё?»):
  default location → «Дефолт — home-like путь (/home/project)»; root patches →
  «Снять патчи — быть Node-точным в `/` (сломанным)»; principle → «Как
  записано: platform-gap только как объявленный долг (Recommended)»; keepalive
  boundary → explained (HTML explainer `~/ai/rifty-guest-package-patches-problem.html`),
  then «окей, давай как рекомендовал Node-поверхность».
- 2026-10-15 — third user round (plain text): «А если так: физически мы
  ничего не трогаем, но то, что видит программа стартовой директории
  становится какой-нибудь slash Home. Тогда и TMP фактически принадлежит
  проекту, и хоум фактически принадлежит проекту. Всё остаётся работать как
  есть. Кроме того, что мы не спавним проект в корне файловой системы и
  избегаем приколов с vite.» and, on the fixed `/home/project` path: «Давай так
  и оставим.» → `project-location-independence` FIT (goal §Decisions).
- 2026-10-15 — premise critic for `project-location-independence` (fresh
  read-only general-purpose subagent): `challenge: 2026-10-15 — 5 problems`
  — I4 parity-runner clause (`tools/node-parity-runner/src/types.ts:9-26` is
  a harness knob); DEC-2 understated (ADR-0280 Decision, all of ADR-0433,
  ADR-0278 `:613-615`/`:196-203`); I2 persistence/exclusion credited to the
  user; root-setter persona hidden; child-3 fog (`/tmp`/`$HOME` at root `/`,
  no Vite 8 artifact). All resolved in goal/map/children (goal §Challenge).
- 2026-10-15 — `RDY-6` §Final check of the `project-location-independence`
  FIT + ready-epic amendments (fresh read-only general-purpose subagent):
  `final-check: 2026-10-15 — FAIL (1 blocking)` — `EventSource` claimed as a
  Node ≥22 global. Probe: `node -v` → v24.16.0; `node -e "console.log(typeof
  WebSocket, typeof EventSource)"` → `function undefined`;
  `node --experimental-eventsource -e …` → `function`. Correction: `WebSocket`
  stays in the Node-surface boundary, `EventSource` is excluded (not a default
  global) in item 1, goal I1/amend line, map fog. Advisories applied: value/
  why wording ("takes upstream's code paths", oracle = configured runs);
  letter references → quoted words; Outcome (1) carrier list; child 2 DEC-2
  vehicle (superseding ADR + §Corrections); ADR-0278 cite `:196-204`;
  `os.ts` baseline authority line; I1 amended-clause note; item 3 compile
  condition; `~120` sites + SW preview routing fog; stale "Unprobed" sentence;
  dedup row note. Noted for pickup: child 1's ADR re-decides add-on-seam vs
  overturn-some for ADR-0280 at non-default values; "no playground UI" is
  user-observable (reported).
