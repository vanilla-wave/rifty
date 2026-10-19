---
kind: epic
status: ready
title: esbuild runs as unmodified upstream esbuild-wasm on its Node entry — any requested version (COI)
created: 2026-10-16
value: A developer whose project asks for any esbuild version gets the upstream esbuild-wasm bytes of that version running through its own Node entry (proven equal to Node 24 on a declared verified set, others marked not verified), while rifty drops its generated, 0.28.0-patched esbuild client in COI and closes the Node gaps that forced it (stdio write callbacks, child ref/unref, fs on stdio fds, Stats fields) for every CLI.
user_story: As a developer with `"esbuild": "^0.25.0"` and a `build.mjs` calling `esbuild.build(...)`, I want `npm install && node build.mjs` to write the same bundle as Node 24 with esbuild-wasm, but today install fails with `Not implemented: esbuild.version (shadow recipe does not admit ^0.25.0)`
tier: works
---

## Outcome

`esbuild` stops being a rifty-built client and becomes an honest twin like
Rollup/LightningCSS/Sass: a request for `esbuild@<range>` installs upstream
`esbuild-wasm` at the version npm resolves from that range, and in the COI
tier its own Node entry runs unmodified (`lib/main.js` → `spawn('node',
bin/esbuild)` → `wasm_exec_node.js`). Behavior equals esbuild-wasm of the same
version on Node 24 — the user's chosen oracle — proven by one version-agnostic
differential suite over a declared verified set; other admitted versions are
labelled "not verified", never refused. Adding a verified version is a list
entry plus a suite run. The platform gains the Node behavior the stock entry
needs (stdio write callbacks, `ChildProcess#ref/unref`, fs on fds 0-2, full
`fs.Stats`), which every Node CLI uses. Without COI the stock entry hits a
platform wall (same-realm children cannot load `node_modules`); there today's
generated 0.28.0 client stays as declared `platform-gap` debt until no-COI
child processes land. Faithful-runtime payoff: the 13 patches and their
per-version anchors leave the COI path; upstream bytes run where rifty used to
rewrite them. With the client gone, the COI Vite version gate that existed only
to start it goes too: any installed Vite runs, Vite 7.3.6 and 8.0.16
verified, others "⚠️ not verified".

## User scenario

COI playground unless stated.

1. Project with `"esbuild": "^0.25.0"`, `src/index.ts` importing `./m.ts`, and
   `build.mjs` running `esbuild.build({entryPoints:['src/index.ts'],bundle:true,outfile:'dist/out.js'})`:
   `npm install && node build.mjs` exits 0 and `dist/out.js` equals the bytes
   Node 24 + esbuild-wasm of the same resolved version writes; installed
   `node_modules/esbuild-wasm` equals its upstream tarball.
2. Same project with `"esbuild": "~0.21.5"` and with `"^0.28.0"`; `npx esbuild
   src/index.ts --bundle` prints the same text and exit as Node with a TTY and
   a pipe stdout; `npx esbuild src/index.ts --bundle > out.js` leaves the same
   file as Node (empty on Node 24.16.0 — upstream quirk, evidence §Stock entry).
3. `node -e "require('esbuild').transformSync('let x=1')"` prints a named
   `NotImplementedError` and exits — no hang.
4. The Vite 7.3.6 starter: `npm run build`, `vite dev` (HMR), `vite optimize`
   work as today, now through the stock entry.
5. No-COI SDK host (ADR-0375): installs and builds exactly as on main — the
   Vite 7.3.6 build resolves `esbuild@0.28.0` and emits today's bytes; a
   project requesting `esbuild@^0.25.0`, or a lockfile pinning `0.28.2`, fails
   with a named `NotImplementedError` naming the no-COI tier.
6. The maintainer adds esbuild `0.27.x` to the verified set: one version entry
   + the suite run (oracle produced by running the same suite on Node); the
   compat page lists it as verified.
7. A Vite 6.4.x project (`esbuild ^0.25.0`): `npm install && npx vite build`
   reaches Vite's own CLI — no `vite esbuild runtime supports exact Vite
   7.3.6` refusal; the compat page lists Vite 6 as "⚠️ not verified".

## Invariants

<!-- Each checked false on main `9645c62bf` (2026-10-16); command + output in
     `docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md`:
     I1 — `esbuild@^0.25.0` → `Not implemented: esbuild.version` (admission.ts:85-101);
          COI loads the 135 KB generated client (runtime-adapters.ts:5,12-15,98-127).
     I2 — `esbuild.cli` throws (catalog-source.ts:4-48, ADR-0316); `gate-analyze-metafile`,
          `gate-one-shot-build-write`, `gate-direct-lifecycle`, `gate-context-watch-serve`
          throw before Node behavior; stock entry dies at `child.unref` (evidence step c).
     I3 — evidence §Node-surface gaps: no write cb, EBADF on fd 0/1, no ref/unref,
          Stats keys `dev,ino,mode,nlink,uid,gid,rdev,blksize,blocks,atimeMs,ctimeMs` non-number.
     I4 — the inventory has no class column; the 13 patch ids apply in no-COI and COI alike;
          no no-COI child-process item exists; a no-COI refusal names no tier.
     I5 — a version = policy hashes + 23-24 anchors + native oracle fixtures + 66 non-doc files
          naming 0.28.0 (evidence §Today's cost); compat says "other esbuild versions stay loud gaps"
          (`docs/public/compat/esbuild-js-api.md:49`).
     I6 — `vite-esbuild-runtime.ts:31-35` throws a plain `Error` for any Vite but 7.3.6/8.x
          (6.4.4, 5.4.21, 7.3.7); evidence §Vite. -->

1. I1. In COI, a request for `esbuild@<range>` installs upstream `esbuild-wasm`
   at the version npm resolves from that range, its files byte-identical to
   the upstream tarball; no rifty-generated esbuild client or esbuild patch
   is loaded in the realm.
2. I2. In COI, the esbuild async JS API, its lifecycle (`initialize`/`stop`)
   and the `esbuild` CLI run through esbuild-wasm's own Node entry and give the
   same output, errors and exit as esbuild-wasm of that version on Node 24
   (CLI with pipe, TTY and file stdout), on every version of the declared
   verified set (the latest 0.21.x, 0.25.x and 0.28.x at cutover pickup); a
   surface Node supports that rifty cannot match is a named
   `NotImplementedError` + compat ❌; every `*Sync` call, on both upstream
   routes (worker_threads; `ESBUILD_WORKER_THREADS=0` → `execFileSync`),
   throws a named `NotImplementedError` instead of hanging or a `TypeError`;
   the Vite 7.3.6 build/dev/optimize lanes pass on this path.
3. I3. For any program, `process.stdout|stderr.write(chunk[, enc], cb)` calls
   `cb`; `ChildProcess#ref/unref` and child stdio `unref` exist with Node's
   loop semantics (an unref'd child does not hold its parent); `fs`
   read/fstat on fd 0 and write on fds 1/2 behave as Node (incl.
   `fs.readFileSync(0)`); `stat`/`lstat`/`fstat` return every numeric
   `fs.Stats` field Node returns.
4. I4. In no-COI, esbuild requests resolve and behave as on main — a range
   admitting 0.28.0 gets 0.28.0 and the generated client (ADR-0375 Vite 7.3.6
   build bytes); any other request or locked version fails with a named
   `NotImplementedError` naming the no-COI tier; the retained generated client
   is a declared `platform-gap` adaptation whose kill condition is
   `epics/no-coi-child-processes`.
5. I5. A verified version's only per-version inputs are its version string and
   upstream tarballs — the oracle is produced by running the same suite on
   Node; no hand-entered hash, patch anchor, catalog recipe or per-version
   test edit; the verified-set differential runs in CI. The compat page lists
   the verified versions and marks every other admitted version "⚠️ not
   verified".
6. I6. In COI, no rifty gate refuses a Vite version: any installed Vite runs
   its own CLI; the compat page lists Vite 7.3.6 and 8.0.16 as verified and
   every other Vite version as "⚠️ not verified". No-COI Vite runs as on main
   (no version gate there, ADR-0375 D3; its esbuild admission is I4).

## Challenge

challenge: 2026-10-16 — 7 problems (+5 advisory)

Fresh read-only critic (general-purpose subagent) over the user's verbatim
request and answers, goal/map/children, evidence, PR #373 drafts and ADRs:
- 1 live registry: `esbuild-wasm` latest 0.28.2, Vite 7.3.6 asks
  `^0.27.0 || ^0.28.0` → fresh COI installs leave 0.28.0 → verified set =
  latest per line at pickup; no-COI resolution stays main's (Decisions,
  I4, scenario 5).
- 2 verified set "0.28.0" was an agent narrowing → «последние 0.21/0.25/0.28».
- 3 the deleted second-version item held an unasked user question (Vite
  majors); my option text had implied "0.21/0.25 = Vite 5/6" → asked the
  user; answer recorded (I6).
- 4 no-COI child item pre-decided a "permanent limit" branch → that branch
  returns to the user.
- 5 lockfile break covers sass/lightningcss locks too → the asked question
  already named them; Decision line says so.
- 6 DEC-2 list lacked ADR-0361 and ADR-0375 D6 → added.
- 7 evidence said pipe stdout prints nothing → only FILE stdout does
  (re-run: `| wc -c` → 7, `> f` → 0); CLI rows cover pipe, TTY, file.
Advisory taken: 0.21.x/0.25.x Node entries differ (crypto `defineProperty`,
`process.hrtime`, `randomFillSync`) → map fog; `ESBUILD_WORKER_THREADS=0` →
`execFileSync` TypeError → I2 + sync item; PR #373 table → Decisions line;
stdio end surface split off (cutover needs only the write callback); install
identity oracle (Node npm-alias: `name` = `esbuild-wasm`; rifty refuses
`npm:` aliases, `installer-request.ts:211`) → cutover question.
Value verdict: follows from the request; no cheaper route fits the chosen
direction (f1-f5 show the four gaps are the minimal set).

## Decisions

- tier: works — replaces a refused install and a rewritten client with Node
  behavior; no crash/fault-injection promise (2026-10-16).
- 2026-10-16 — user: «Штатный esbuild-wasm (Recommended)» — `esbuild@R` →
  upstream `esbuild-wasm@R` unmodified; rifty fixes the Node gaps.
- 2026-10-16 — user: «Как esbuild-wasm на Node (Recommended)» — oracle is
  esbuild-wasm on Node 24, not native esbuild; wasm-vs-native differences
  (e.g. errno text, today patched by `native-target-errno`) surface as on Node.
- 2026-10-16 — user: «Любая + объявленный проверенный набор (Recommended)»
  (option: «Ставится любая версия из запрошенного диапазона. CI-матрица
  (последние 0.21/0.25/0.28 = Vite 5/6/7) с автодиффом против Node; прочие в
  compat — ⚠️ «не проверено»») — any resolved version installs; the verified
  set's differential runs in CI (I5); others "⚠️ not verified" (precedent
  `docs/public/compat/vitest.md:36`). The «= Vite 5/6/7» gloss was the
  agent's and wrong — see the Vite line below. Agent: «последние» is pinned
  at cutover pickup (0.28.x latest is 0.28.2 today, evidence §Registry).
- 2026-10-16 — user, after the cost explanation: «Только «громко, не hang»
  (Recommended)» — `*Sync` stays a named loud gap; real sync is
  `runtime-js/worker-threads-prompt-start-atomics-wait` +
  `runtime-js/worker-threads-kernel-workerdata-structured-clone` +
  `runtime-js/worker-threads-receive-message-on-port`, outside this goal.
- 2026-10-16 — user: «Временно старый рантайм (Recommended)» (option: «В
  no-COI остаётся нынешний esbuild 0.28.0 с патчами как объявленный долг;
  kill = child-процессы в no-COI (отдельная цель). Мульти-версии сразу —
  только в COI. Патчи умирают позже.») — no-COI keeps the generated 0.28.0
  client as declared debt until the separate goal `epics/no-coi-child-processes`
  (seeded draft; FIT decides feasibility, infeasible → back to the user). Agent reading of
  «остаётся нынешний»: no-COI resolution stays main's (0.28.0 for admitting
  ranges), so one manifest may resolve 0.28.2 in COI and 0.28.0 in no-COI, and
  a COI-made lock pinning another version is refused by name in no-COI.
- 2026-10-16 — user: «ничего специально не делаем. 0 мажор не обещает
  обратной совместимости, пусть проекты сами решают» — to a question naming
  saved projects with esbuild/sass/lightningcss locks: the catalog digest
  covers all recipes (`codec.ts:561-568`, `planner.ts:250-256`), so every
  existing lock with any substitution trace (incl. Vite 8 / vitest
  lightningcss, sass-embedded) hits today's loud `EBROKENLOCK` once; no
  migration, no separate item.
- 2026-10-16 — user, asked «не понял почему они не заработают? В платформе
  чего-то не хватает или вопрос в "доказательстве"?», told: proof, not
  platform — the exact-7.3.6 gate exists only to start the generated client,
  and the three Vite install patch anchors exist in 6.4.4 and 5.4.21
  (evidence §Vite); options remove / remove + Vite 6 verified lane / keep
  with named error. User: «ок» on «Снять (рекомендую)» — COI gate removed,
  Vite other than 7.3.6/8.x "⚠️ not verified"; no-COI gate stays. Agent
  corrections after the final checks: the gate does not exist in no-COI on
  main (`no-coi-toolchain-install.ts:43-49` prepares `kind:'eval'`, which
  skips the Vite edge, `entry-preparation.ts:36-42`; ADR-0375 D3), so no-COI
  Vite stays as on main, ungated — the option's «Без COI гейт остаётся» was
  the agent's misstatement, no user scope changes; compat verifies Vite 8 at exactly 8.0.16
  (`docs/public/compat/vite-command.md`; 8.2.0-8.3.1 fail install on
  `lightningcss ^1.33.0`, `vitest.md:36`), so "8.x" reads 8.0.16 — no new
  verified lane, the user's choice unchanged.
- 2026-10-16 — agent: DEC-2 at the cutover pickup — superseding ADR for
  ADR-0226 (COI client), corrections to ADR-0371 (runtime binding), ADR-0361
  ("Registry acquisition is exact", replay of the attested product version,
  acquired twin bins removed from linking — `npx esbuild` needs the bin),
  ADR-0316 (CLI gate in COI), ADR-0375 D6 (exact COI/no-COI Vite 7 bytes:
  kept by fixture pins; a correction dropping them loosens a proof tied to
  the user's 2026-09-01 oracle decision and goes back to the user), ADR-0384 §Alternatives ("Fix general Node
  capabilities": the general capability is now shown, evidence
  §Discriminating layers). The ADR-0226 supersession names its D4
  "validation-before-gap" loss for COI `*Sync`: stock esbuild-wasm builds
  the Worker before validating (`lib/main.js:1995-1998, 2194-2253`), so an
  invalid-option `transformSync` gets the named gap, not Node's validation
  error; the compat `*Sync` row reads partial.
- 2026-10-16 — agent: the ADR-0384 inventory
  (`docs/backlog/npm-client/reference/registry-package-adaptations-evidence.md`
  §Finite inventory, classified 2026-10-16 by the closed
  `honest-guest-package-adaptations` I3) lists the esbuild patch ids as
  `substitution-environment`/`handle-mapping`, kill none; this evidence makes
  the 7 Node-entry stand-in ids `platform-gap` under `fault-classes.md`
  §Guest-package adaptations (COI: kill = this goal's cutover; no-COI client:
  kill = `epics/no-coi-child-processes`); the 5 `gate-*` ids and
  `native-target-errno` stay `substitution-environment` with kill = the
  cutover in COI; the Vite version-gate row's COI kill = I6 — rows corrected
  in this PR.
- amend (other goal): 2026-10-16 — `honest-substitution-signals` scenario 4
  (`esbuild@^0.21.0` refused) holds in no-COI only after this goal's cutover;
  recorded there as `amend:` citing the user's «Любая…»; its I2 (types
  facade) must survive the cutover (map §Open questions).
- 2026-10-16 — `npm-client/shadow-catalog-second-version-per-name` answered
  by the user's version and Vite-gate decisions above and deleted — versions
  come from the twin's range, not a second recipe per name;
  `npm-client/shadow-catalog-trigger-name-uniqueness` stands unless the
  install-shape ADR (map §Open questions, per-tier install) needs a
  tier-keyed recipe.
- rejected route: keep the generated client and make a version cheaper
  (all-candidates admission, scripted hashes) — violates I1 and I5.
- rejected route: native-esbuild oracle (keep emulation patches) — violates
  I2 (user oracle decision).
- rejected route: real `*Sync` via worker_threads in this goal — violates
  the `*Sync` clause of I2 (user decision: loud).
- rejected route: refuse esbuild in no-COI — violates I4.
- rejected route: keep the Vite gate with a named `vite.version` error, or
  add a Vite 6 verified lane here — violates I6 (user decision).
- rejected route: run the stock entry in-realm without `child_process`
  (re-host `bin/esbuild` in the caller's realm) — violates I1 (a rifty
  startup rewrite stays loaded) and I2 ("through esbuild-wasm's own Node
  entry").
