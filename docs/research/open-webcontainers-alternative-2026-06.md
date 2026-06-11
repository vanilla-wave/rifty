# Open WebContainers alternative — strategy (2026-06)

Synthesis of the 2026-06 strategy research: where rifty stands vs the in-browser-runtime
landscape, and the infra-first directions that became **M11 (Consumer Ready)**. The work is filed
as `docs/backlog/<area>/*` items tagged M11 (grep `M11` in `docs/backlog`). Provenance doc — not a
living plan; the ROADMAP + backlog are the source of truth.

## Positioning

rifty is the only credible **open + self-hostable + lightweight + browser-local** Node runtime.
The win is ownership/auditability — not raw browser capability (those ceilings are shared with
WebContainers) and not curated package breadth (explicitly declined: no shadow registry; npm-dep
compatibility is the user's responsibility).

Licensing wedge (verified 2026-06):

| Project | Runtime licence | Self-host | Cost |
|---|---|---|---|
| WebContainers | proprietary (the MIT `webcontainer-core` repo is only a client shim that loads code from StackBlitz servers) | Enterprise-only | commercial prod paid; free cap ~500 sessions/mo or 10k req/mo; private registry = Enterprise |
| CodeSandbox Nodebox | Sustainable Use (source-available, no commercial embed); stalled since 2023-11 | — | — |
| CheerpX / WebVM | engine proprietary, CDN-locked, 32-bit-only | forbidden without a commercial licence | free only for individuals / 1-person cos |
| Sandpack (UI kit only) | Apache-2.0 | — | — |
| **rifty** | **MIT, royalty-free web standards** | **yes** | **0** |

The lightweight+open+self-hostable+browser-local quadrant is essentially uncontested.

## The gap (delta vs WebContainers)

The capability gap is largely closed (real express@4 + vite@5 run headless). What remains is
**adoption infra**, not capability:

1. **Standable** — install works only against the dev proxy (no prod registry proxy deployed); no
   scaffold for the un-packageable host wiring (COOP/COEP, module-worker, sw.js, WASM copy, worker URLs).
2. **Embeddable** — `createSandbox` boots a REPL+VFS+SW only; no FS-read, no AI-agent-shaped
   contract, no snapshot/fork; the IDE glue is locked in the Solid playground.
3. **Runs real-ish projects** — high-frequency walls steer ordinary npm code into hard failures
   (plausible platform/arch, fd-fs/mkdtemp, http loopback); preview streaming/SW→Worker; off-main
   heavy guests + worker pools.
4. **Durable & portable** — no `persist()`/quota UX; OPFS data is trapped (the snapshot is display-only).
5. **Trustworthy** — the open-licensing position + an honest compat-matrix aren't shipped as the pitch.

All are INFRA — none needs a curated package-substitution registry.

## Directions

**Already landed / decided** (verified in the 2026-06 reconcile, deliberately NOT re-filed):
- waitAsync sync-RPC dispatcher — ADR-0084/ADR-0087 + backlog `perf/syncrpc-v2-waitasync-binary-ring`.
- SW→Worker direct preview routing — ADR-0123 (port-aware owner binding).
- `node:zlib` loud-throw is intentional; the tar/gzip path is fully async (no sync-deflate need today).
- crypto sync-subset and `perf_hooks` observers are deliberate, documented loud-throw stubs.
- `cp`/`cpSync`/`renameSync` — ADR-0090.

**Filed as M11 backlog** (this push):
- distribution: license-positioning-honest-compat-pitch; public-api-ai-agent-contract-snapshot-restore
  (+ the existing create-rifty-template / workbench-controllers / sdk-umbrella-facade-limits /
  framework-bindings-kit, now tagged M11).
- npm-client: packagejson-driven-install-and-bin-linking (prod proxy already filed as prod-npm-registry-proxy).
- net: http-request-loopback-own-ports (streaming preview already filed).
- vfs: opfs-mkdir-flush-tracking (correctness); storage-durability-and-portability;
  fd-based-fs-constants-and-syscalls.
- runtime-js: sourcemap-remapping-error-overlay; vm-subset-node-test-support;
  crypto-sync-subset-expansion (parked); platform-arch-adoption-friction (blocked — ADR-0026
  reconsideration via a decision subagent).
- kernel: host-operator-resource-policy-sandbox.
- runtime-wasi: runwasi-kernel-dispatch-wiring (enriched — off-main-thread dispatch + worker stdin).

## Explicitly out of scope (unchanged)

A curated shadow/substitution registry (the `overrides` mechanism stays; growing the TABLE is the
user's job); remote/cloud execution + the agent-backend market (e2b/Modal/Daytona/Cloudflare);
full-system x86/Linux emulation (CheerpX/WebVM/container2wasm); WASIX as a dependency (target the
WASI 0.2 Component Model instead); browser capability ceilings (`tls`/`dgram`/`http2`-server/raw-TCP
`net.Socket`/native addons) stay loud-throw — shared physics that WebContainers hits too.
