# Map — no-coi-sandbox-tier

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

## Items

1. `runtime-js/worker-realm-compat-bare-sab-referenceerror` — **bare-sab-guard** —
   RED-first in a real no-COI browser context (first no-COI test substrate,
   committed: `playwright.no-coi.config.ts` + `tests/no-coi/`); unblocks the
   sibling slices' no-COI lane. I2 mapping corrected (checkpoint-2 G1): the
   shim installs only via the kernel pre-entry hook — the public
   `@riftydev/runtime-js/worker` entry `createSandbox` boots installs neither
   `installNodeRuntime` nor `installWorkerRealmCompat`, so today's SDK no-COI
   path never reaches the defect organically; it becomes I2-load-bearing when
   build-loop's composition installs the Node runtime in the tier's realm —
   organic-reachability certification rides build-loop Contract+RED (recorded
   there).
2. `runtime-js/same-realm-spawn-stdio-pipe-drop` — **console-swap** — per-child
   console over childProcess.stdout/stderr (I7 pipe half); declared microtask
   residual stays.
3. `vfs/no-coi-opfs-policy-flip` — **opfs-no-coi** — drop the COI condition in
   detectVfsBackend + no-COI reload-durability proof (I5).
4. `distribution/no-coi-sandbox-build-loop` — **build-loop** — PICKUP
   prerequisite: settle Open question 1 (shim probe) first — sandbox
   composition for real Vite 7 build outside workbench gates + loud capability
   gate/report + spawn warn-once + cpus→1 + Vite-8 loud named error + the
   no-COI CI lane (I1, I2, I3, I7 rest, I8).
5. `distribution/no-coi-dev-hmr-restore` — **dev-hmr** — resident vite dev +
   HMR through SW preview + worker-died event + restore primitive (I4, I6).
   Blocked by build-loop.

## Open questions

- Does a coi-serviceworker-style header-faking shim deliver full COI (SAB
  usable) on GH-Pages-class hosting, collapsing part of this tier's hosting
  value? Settle: minimal static page + shim + SAB/crossOriginIsolated probe
  (mentioned once at docs/public/hosting-netlify.md:82, never built). MUST be
  settled before build-loop (slice 4) Contract+RED — it sizes the epic's
  largest spend; a collapsing answer is a re-fit trigger, not a silent narrowing.
- Does the works contract need a boot-time detectability marker for
  "unflushed writes were pending at last termination" (dirty flag, NOT a
  journal)? Kill-before-flush leaves silently mixed-generation trees (spike
  record); user decision at dev-hmr pickup.

Settled: util-types.ts:27,31 bare-SAB sibling — brand-based, zero runtime SAB
refs, Node-identical in real no-COI Chromium 148 incl. shared-wasm buffers
(bare-sab-guard sweep 2026-08-29; evidence:
`runtime-js/reference/no-coi-degradation-probes.md` §2026-08-29 rows 10–11).

## Out of scope

- execSync no-COI (loud NotImplementedError naming SAB/COI stays — correct
  as-is). spawnSync/execFileSync are ABSENT exports (raw call-site TypeError,
  verified 2026-08-29) — tracked in
  `runtime-js/node-builtins-loud-stub-capability-gaps`, not this goal.
- Vite 8 / Rolldown and any threaded-wasm guest (platform: pthread shared
  memory needs COI) — loud named error only.
- Kernel no-COI protocol redesign (ring-less spawn, async remote-fs, snapshot
  children) and cross-worker sync without SAB (sync-XHR-to-SW: zero code, no
  spike).
- Third-party iframe embeds without own origin (no SW → no preview).
- Workspace transaction/journal + auto WS reconnect (epoch/heartbeat) — robust-
  class machinery, declined at works.
- Playground app no-COI mode (ADR-0165 pins its COI hard-assert).
