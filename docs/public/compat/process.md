# Compatibility matrix — Process lifecycle & event loop

Hand-maintained (the `pnpm compat:generate` data-driven sink isn't wired yet). Update by hand after
touching the child-realm drain / keepalive code. Covers how a rifty child process exits — the
event-loop drain model (ADR-0152) and its one deliberate, loud divergence from Node.

A run-to-completion child (`serve` absent/false) exits when its event loop DRAINS (no live refed
handle), like real Node — not at top-level resolve. A long-lived server uses `serve:true` and is
never drain-reaped (kept alive by its own ports). Backing tests:
`tests/e2e/owner-shell-async-lifecycle.spec.ts`, `packages/kernel/tests/worker-entry-drain.test.ts`,
`packages/runtime-js/src/module-loader/loader-keepalive.test.ts`.

| Feature | Status | Notes |
|---|---|---|
| Exit on event-loop drain (not top-level resolve) | ✅ | Post-top-level async (timers, detached `import().then(run)`) completes before reap |
| Keepalive counts `setTimeout`/`setInterval` | ✅ | libuv-style refcount; loop stays alive while a refed timer exists |
| Keepalive counts `setImmediate` | ✅ | |
| Keepalive counts pending dynamic `import()` | ✅ | Both `loader.import` and routed user-code `import()` (`__import`) |
| `unhandledrejection` → stderr + non-zero exit | ✅ | Record-not-swallow; never silent `exit 0`. Node parity (default warn + non-zero) |
| **Drain cap: a refed loop that never drains is force-killed** | ⚠️ | **Deliberate non-Node divergence.** At 30 s the worker exits 1 + a self-explanatory stderr line, where Node runs forever. Browser-worker safety-net against a genuine hang/leak — generous + loud. Legit-forever programs use `serve:true` (the cap never fires there). See ADR-0152 §4 |
| Detached `fetch()` / network keepalive | ❌ | NOT counted — network in flight after top-level can be reaped early. `backlog/runtime-js/timer-unref-keepalive` (network path) |
| `fs.watch` / `fs.watchFile` keepalive | ⚠️ | The poll `setInterval` IS counted → an active watcher with no `.unref()` force-exits at the cap, where Node runs forever |
| Timer `.unref()` / `.ref()` / `.hasRef()` | ❌ | Not implemented → an `.unref()`'d timer can't opt out of keepalive (drains to cap). `backlog/runtime-js/timer-unref-keepalive` |
| `process.exit(N)` propagates the exit code | ✅ | Via the `RIFTY_PROCESS_EXIT` shape (ADR-0039) |

## Known limitations

- The drain cap uses wall-clock (`performance.now()`), so a CPU-busy worker could in principle trip
  the 30 s cap; the cap is generous, so the risk is low.
- The keepalive model is honestly the count of timers/immediates/pending imports — NOT the full
  libuv handle set (see the `fetch`/`fs.watch`/`.unref()` rows above and ADR-0152 "Explicit gaps").
