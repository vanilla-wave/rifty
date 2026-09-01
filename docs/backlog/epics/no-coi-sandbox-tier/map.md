# Map — no-coi-sandbox-tier

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

## Items

1. `runtime-js/worker-realm-compat-bare-sab-referenceerror` — **bare-sab-guard** —
   RED-first in a real no-COI browser context (first no-COI test substrate);
   unblocks every other slice (I2 prerequisite).
2. `runtime-js/same-realm-spawn-stdio-pipe-drop` — **console-swap** — per-child
   console over childProcess.stdout/stderr (I7 pipe half); declared microtask
   residual stays.
3. `vfs/no-coi-opfs-policy-flip` — **opfs-no-coi** — drop the COI condition in
   detectVfsBackend + no-COI reload-durability proof (I5).
4. `distribution/no-coi-sandbox-build-loop` — **build-loop** — sandbox
   composition for real Vite 7 build outside workbench gates + loud capability
   gate/report + spawn warn-once + cpus→1 + Vite-8 loud named error + the
   no-COI CI lane, which also pins the host document non-COI across the loop
   (I1, I2, I3, I7 rest, I8, I9).
5. `distribution/no-coi-dev-hmr-restore` — **dev-hmr** — resident vite dev +
   HMR through SW preview + worker-died event + restore primitive + boot marker
   for unflushed writes (I4, I6, I10). Blocked by build-loop.

## Open questions

<!-- Empty by construction after the 2026-08-31 re-fit: all three lines were
     closed, none graduated into the run. Owner-typed form for any new line:
     `<question> — owner: user|agent — <what settles it; for owner: user, why
     not answerable now>` (rifty-goal FIT 3). -->

- (none)

## Out of scope

- execSync/spawnSync no-COI (loud NotImplementedError stays — correct as-is).
- Vite 8 / Rolldown and any threaded-wasm guest (platform: pthread shared
  memory needs COI) — loud named error only. Not a gap: these sit outside the
  shared-memory-free class this goal delivers, by their own requirement
  (user, 2026-08-31).
- A site built from scratch (docs site, course platform): no existing posture to
  preserve, so it should take real isolation instead — a header-faking SW gets
  it (`distribution/reference/sw-coi-shim-probe.md`). Removed from the audience
  at the 2026-08-31 re-fit (user).
- Kernel no-COI protocol redesign (ring-less spawn, async remote-fs, snapshot
  children) and cross-worker sync without SAB (sync-XHR-to-SW: zero code, no
  spike).
- Third-party iframe embeds without own origin (no SW → no preview).
- Workspace transaction/journal + auto WS reconnect (epoch/heartbeat) — robust-
  class machinery, declined at works.
- Playground app no-COI mode (ADR-0165 pins its COI hard-assert).
- SW-delivered COI (header-faking Service Worker): rejected route, not fog —
  it works (probe: `distribution/reference/sw-coi-shim-probe.md`) but isolates
  the whole host document, violating I9. Never graduates; a future goal wanting
  an isolated rifty-owned page may reuse the probe.
