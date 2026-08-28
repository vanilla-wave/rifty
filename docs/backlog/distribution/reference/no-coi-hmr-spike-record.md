# No-COI resident Vite/HMR spike — durable record (2026-08-28)

Provenance: spike `prototype/no-coi-agent-loop` on throwaway branch
`t3code/prototype-hmr-agent-scenarios` (commit 61aeec95f, `FINDINGS-HMR.md` +
`hmr-result.json`). Branch artifacts rot — load-bearing numbers inlined here;
re-verify against current main before building on them. Build-loop probe
sibling: `runtime-js/reference/no-coi-degradation-probes.md`.

Path measured (production-shaped): agent `writeFileSync` + durable flush →
real Vite 7.3.6 watcher/transform → net BroadcastChannel HTTP+WS bridge →
production `sw.js` → `/preview/5174/` iframe with random `bootId` (stable ID
proves HMR, not hidden reload). Chromium 148, no COOP/COEP,
`typeof SharedArrayBuffer === 'undefined'` in page and worker.

| observation | value |
|---|---|
| Vite listen / optimizeDeps commit / first SW preview | 0.5 s / 4.3 s / 4.4 s |
| 100 HMR cycles | 100/100, p50 244 ms, p95 265 ms (repeat 1: 245/266) |
| 50-file transform storm | 50/50 beforeUpdate+afterUpdate; agent fs-RPC p95 0.3 ms |
| resident `vite build` with dev alive | correct artifact 2.1 s; agent fs p95 387 ms during bursts |
| heap after 100 cycles (forced GC, CDP) | worker +0.12 %, page +0.81 % — plateau |
| CPU wedge (real plugin infinite loop, HMR-triggered) | agent+fs+dev share one blocked loop; worker stays ALIVE-but-blocked — no death event; only external `worker.terminate()` recovers |
| terminate → dev ready | 6.6 s (OPFS reopen 5.5 s, esbuild from cache 49 ms, listen 0.9 s) |
| preview WS after same-port reboot | does NOT reconnect; only iframe reload restores (12.75 s probe) |
| kill during unflushed multi-file write-through (10 trials × 2 repeats) | 0/120 files partial/corrupt (per-file old-or-new); 5/10 reopened trees crossed generations (up to 12 new files + old manifest) — silent, external oracle only; in-memory persist ledger dies with worker |
| acknowledged flush → full page reload | tree survives byte-for-byte; OPFS reopen 5.5 s |

Verdict recorded at the time: happy path steady; single-realm gives no failure
containment and no crash-atomic workspace recovery — `flush()` is the only
durability boundary.
