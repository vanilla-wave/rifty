# Map — no-coi-sandbox-tier

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

## Items

1. `distribution/no-coi-toolchain-operation-lifecycle` — **shared I2/I3** —
   one Worker-owned install/run slot, immutable input and terminal settlement.
2. `distribution/no-coi-sandbox-package-install` — **I2** — real exact-manifest
   install plus inherited npm bounds/fault evidence; blocked by all prior.
3. `distribution/no-coi-sandbox-build-loop` — **I3** — generic installed-bin
   build bytes, exact output and identity-decoy proofs; blocked by all prior.
4. `distribution/no-coi-host-posture-preservation` — **I9** — exact host,
   opener and no-CORS/no-CORP subresource posture across the loop; blocked by
   all prior.
5. `distribution/no-coi-dev-hmr-restore` — **I4/I6/I10 + final I8** — generic
   resident dev/HMR proof, worker-death/restart and unflushed marker; explicitly
   blocked by all four open prerequisites.

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
- Heartbeat, journal, automatic retry/reconnect, exactly-once recovery, hidden
  retry, queue, crash-proof durability and other robust-class machinery are
  explicitly outside dev-HMR checkpoint authority; tier is `works` (user,
  2026-09-01).
- Vite identity/version/callbacks/paths/types/lifecycle in SDK, runtime,
  control-plane, package or distribution infrastructure. Vite 7 is only the
  representative shared-memory-free browser oracle; Vite 8 only the named
  threaded-WASM boundary fixture (user, 2026-09-01).
- Playground app no-COI mode (ADR-0165 pins its COI hard-assert).
- SW-delivered COI (header-faking Service Worker): rejected route, not fog —
  it works (probe: `distribution/reference/sw-coi-shim-probe.md`) but isolates
  the whole host document, violating I9. Never graduates; a future goal wanting
  an isolated rifty-owned page may reuse the probe.
