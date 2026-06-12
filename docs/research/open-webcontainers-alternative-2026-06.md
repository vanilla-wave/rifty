# Open WebContainers alternative — strategy (2026-06)

Synthesis of the 2026-06 strategy research: where rifty stands vs the in-browser-runtime
landscape, and the infra-first directions that became **M11 (Consumer Ready)**. The resulting work
is tracked in `docs/ROADMAP.md` and `docs/backlog/<area>/*`. Provenance doc — not a living plan; the
ROADMAP + backlog are the source of truth.

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

## The original gap (delta vs WebContainers)

The capability gap was already largely closed (real express@4 + vite@5 run headless). The remaining
adoption-infra themes identified by this research were:

1. **Standable** — install works only against the dev proxy (no prod registry proxy deployed); no
   scaffold for the un-packageable host wiring (COOP/COEP, module-worker, sw.js, WASM copy, worker URLs).
2. **Embeddable** — `createSandbox` boots a REPL+VFS+SW only; no FS-read, no AI-agent-shaped
   contract, no snapshot/fork; the IDE glue is locked in the Solid playground.
3. **Runs real-ish projects** — high-frequency walls steer ordinary npm code into hard failures
   (plausible platform/arch, fd-fs/mkdtemp, http loopback); preview hangs from buffered cross-realm
   or SW-routing gaps; off-main heavy guests + worker pools.
4. **Durable & portable** — no `persist()`/quota UX; OPFS data is trapped (the snapshot is display-only).
5. **Trustworthy** — the open-licensing position + an honest compat-matrix aren't shipped as the pitch.

All were INFRA — none needed a curated package-substitution registry.

## M11 reconciliation notes

**Already landed / decided** (verified in the 2026-06 reconcile, deliberately NOT re-filed):
- waitAsync sync-RPC dispatcher — ADR-0084/ADR-0087 + backlog `perf/syncrpc-v2-waitasync-binary-ring`.
- SW→Worker direct preview routing — ADR-0123 (port-aware owner binding).
- `node:zlib` loud-throw is intentional; the tar/gzip path is fully async (no sync-deflate need today).
- crypto sync-subset and `perf_hooks` observers are deliberate, documented loud-throw stubs.
- `cp`/`cpSync`/`renameSync` — ADR-0090.

**Filed, closed, parked, or kept as M11 backlog** (this reconciliation):
- distribution: public-api-ai-agent-contract-snapshot-restore (open-positioning pitch now lives in
  `docs/public/open-runtime-position.md`; transitive licence audit parked as
  `distribution/dependency-license-audit`)
  (+ SDK facade-limit docs closed in `packages/rifty/README.md`; existing
  create-rifty-template / workbench-controllers / framework-bindings-kit remain tagged M11).
- npm-client: package.json-driven install and top-level `.bin` copy shims are landed; prod proxy
  remains filed as `prod-npm-registry-proxy`.
- net: http.request/get loopback self-calls now route through registered local ports; ADR-0048
  streaming preview frames are reconciled as landed, with true page-worker `ReadableStream`
  backpressure still owned by the blocked perf item.
- vfs/runtime fs: OPFS mkdir/empty-dir rename structural flush tracking landed; runtime-local
  fd/mkdtemp/opendir/truncate/constants plus WASI positional fd syscalls landed; lower FsSync
  fd/fsync fidelity parked; storage-durability-and-portability remains.
- runtime-js: sourcemap-remapping-error-overlay; vm-subset-node-test-support;
  crypto-sync-subset-expansion (parked); platform-arch-adoption-friction (blocked — ADR-0026
  reconsideration via a decision subagent).
- kernel: public trust model now lives in `docs/public/trust-model.md`; hard host-operator resource
  enforcement is parked as `kernel/host-operator-resource-enforcement`.
- runtime-wasi: runwasi-kernel-dispatch-wiring (enriched — off-main-thread dispatch + worker stdin).

## Explicitly out of scope (unchanged)

A curated shadow/substitution registry (the `overrides` mechanism stays; growing the TABLE is the
user's job); remote/cloud execution + the agent-backend market (e2b/Modal/Daytona/Cloudflare);
full-system x86/Linux emulation (CheerpX/WebVM/container2wasm); WASIX as a dependency (target the
WASI 0.2 Component Model instead); browser capability ceilings (`tls`/`dgram`/`http2`-server/raw-TCP
`net.Socket`/native addons) stay loud-throw — shared physics that WebContainers hits too.
