# Map — no-coi-sandbox-tier

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

## Items

1. `runtime-js/worker-realm-compat-bare-sab-referenceerror` — **bare-sab-guard** —
   realm-safe unconditional TextDecoder patch, RED-first on the first no-COI
   substrate (`playwright.no-coi.config.ts` + `tests/no-coi/`); unblocks the
   sibling slices' no-COI lane. I2 reachability = Open question
   "installNodeRuntime seam" below.
2. `runtime-js/same-realm-spawn-stdio-pipe-drop` — **console-swap** — per-child
   console over childProcess.stdout/stderr (I7 pipe half); declared microtask
   residual stays.
3. `vfs/no-coi-opfs-policy-flip` — **opfs-no-coi** — drop the COI condition in
   detectVfsBackend + no-COI reload-durability proof (I5).

Unseeded (FIT §5: a child whose contract depends on an open question stays
unseeded; both were pre-sliced at fit — corrected checkpoint 3, drafts deleted):

- **build-loop** — sandbox composition for real Vite 7 outside workbench gates +
  loud capability gate/report (incl. naming the raw `createSabRing`/
  `spawnKernelWorker` no-COI ReferenceError — probes §2026-08-29 row 12) + spawn
  warn-once + cpus→1 + Vite-8 loud named error + the no-COI CI lane (I1, I2,
  I3, I7 rest, I8). Seeds after the shim-probe and installNodeRuntime-seam
  questions settle. Inputs: ADR-0316,
  `runtime-js/reference/no-coi-degradation-probes.md`.
- **dev-hmr** — resident vite dev + HMR through SW preview + worker-died event
  + restart primitive (I4, I6). Seeds after build-loop lands and the
  dirty-marker question settles. Input:
  `distribution/reference/no-coi-hmr-spike-record.md`.

## Open questions

- Does a coi-serviceworker-style header-faking shim deliver full COI (SAB
  usable) on GH-Pages-class hosting, collapsing part of this tier's hosting
  value? Settle: minimal static page + shim + SAB/crossOriginIsolated probe
  (mentioned once at docs/public/hosting-netlify.md:82, never built). MUST be
  settled before build-loop seeds — it sizes the epic's largest spend; a
  collapsing answer is a re-fit trigger, not a silent narrowing.
- Does the works contract need a boot-time detectability marker for
  "unflushed writes were pending at last termination" (dirty flag, NOT a
  journal)? Kill-before-flush leaves silently mixed-generation trees (spike
  record); user decision before dev-hmr seeds.
- installNodeRuntime seam: can the tier's single-worker composition install
  `installNodeRuntime` (and thus the realm-compat shims) in its realm, making
  bare-sab-guard I2-load-bearing organically? Today the public
  `@riftydev/runtime-js/worker` entry installs NEITHER `installNodeRuntime` NOR
  `installWorkerRealmCompat` (kernel pre-entry hook only —
  install-process.ts:125; bare-sab-guard checkpoint-2 G1); the build spike
  reached the shim only via manual-install harness hacks. Settle: build-loop
  Contract+RED certifies the organic `createSandbox`→npm-install path
  exercises the fixed shim; a NO re-fits the I2 mapping (bare-sab-guard stays
  helper-level).

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
