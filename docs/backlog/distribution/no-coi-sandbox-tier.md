---
area: distribution
status: draft
title: no-COI sandbox tier — Vite 7 agent loop on a headerless page
created: 2026-08-28
why: COOP/COEP host wiring excludes GH-Pages-class hosting and blocks pages without response-header control (ADR-0002:19, iframe-embed.md:13, M11 Standable scaffold pain); two spikes PROVED the full agent loop (install → build → dev+HMR) end-to-end in real no-COI Chromium with byte-identical artifacts — value rests on the hosting/embed unlock, not speed
user_story: As an AI-agent platform (or docs-site author) without response-header control, I want create → write → npm install → vite build → extract dist → dev+HMR on a Vite 7 project, but today createSandbox throws COI_REQUIRED_MESSAGE and the real-Vite composition lives behind the workbench COI gate
sources: [ADR-0002, ADR-0072, ADR-0150, ADR-0165, ADR-0316, distribution/iframe-embed, runtime-js/reference/no-coi-degradation-probes, kernel/process-equals-web-worker]
---

## Question

Exact loud-gated no-COI tier contract: which surfaces work, degrade (how loudly), throw —
for the single-worker sandbox running a real Vite 7.3.6 project driven by an agent over the async SDK.

## Context — evidence

Static analysis 2026-08-25 (adversarially verified) + browser spike (worktree branch
`t3code/prototype-no-coi-agent-cycle`, `prototype/no-coi-agent-loop/{FINDINGS,NO-COI-CAPABILITY-REPORT}.md`).

Proven in real no-COI Chromium (spike):
- Full loop: `createSandbox({requireCrossOriginIsolation:false})` → npm install 78 pkgs (react,
  @gravity-ui/uikit, vite@7.3.6) → esbuild-wasm adapter → `vite build` via runNodeEntry on
  `node_modules/.bin/vite` → 5 edit→rebuild→read-dist cycles. Artifacts byte-identical to COI playground
  (2180 modules, same content hashes).
- Perf: no-COI == COI same topology (COI is not a perf factor); single worker ~2x faster per cycle than
  product (2.09s vs 4.05s wall; vite self 1.13s vs 1.65s) — structural: no ~1s spawn floor, no sync-RPC fs
  (~1µs/op in-realm vs ~33µs = 2 SAB hops/small read).
- OPFS works no-COI (gate `vfs/boot.ts:23` = policy): full loop on forced `installOpfsFs()`; cost one-time
  cold +5.8s (cache-warm 78 pkgs), durable edit ~1.2ms. NOT proven: reload-durability roundtrip.
- Same-realm fallbacks run: worker_threads polyfill (warn-once) exit 0; fork+IPC works. Both BETTER than
  product-COI today (COI: execArgv NotImplementedError; fork+IPC hung >45s — separate captures).
- Structural constraint: long-lived realm mandatory — recycling realm per run costs 5.6s OPFS re-open
  (worse than product 4.05s). One wedged build takes fs with it; no cheap per-run isolation buy-back.
- STALENESS NOTE (2026-08-28): product-comparison numbers above were measured against pre-#279 main;
  one-hop `readFileHead` reads + SyncRpc v5 binary frames have since landed (ADR-0366,
  `perf/reference/child-fs-rpc-hot-path.md` — hop now ~10µs), so the child-fs share of the ~2x gap has
  shrunk; the ~1s spawn floor is untouched. Value claim rests on hosting/embed unlock, not the speedup.

Mandatory tier work found by spikes (first two already captured as standalone items on main):
1. BLOCKER: bare `SharedArrayBuffer` TextDecoder poisoning — `runtime-js/worker-realm-compat-bare-sab-referenceerror`
   (RED-first fix; spike patch has no RED test; sibling `util-types.ts:27,31` unverified).
2. CRITICAL fidelity: same-realm `spawn` silently drops child stdout to parent console —
   `runtime-js/same-realm-spawn-stdio-pipe-drop`. Root cause pinned: `withChildProcess` swaps `process`,
   not `console`. Declared residual: microtask leak (same limit process has). Not covered by warn-once plan.
3. `os.cpus()`/`availableParallelism` report host hardware (12) → tools size 12-worker pools on one event
   loop. Fix: report 1 in no-COI tier.
4. Warn-once for spawn same-realm route (align with worker_threads; settled fork).

Direction fork with `kernel/process-equals-web-worker` (M6): that item aims to drop the same-realm
`new Function` fallback in favor of real Worker-per-child; this tier promotes the same-realm path to a
supported surface. Its open fork (honest degraded mode vs remove) must be resolved WITH this tier at FIT,
not silently decided here.

Facts from static analysis (still true): 2 prod `new SharedArrayBuffer` sites, both kernel spawn fabric;
execSync loud-throws (correct as-is); Vite 8/Rolldown pthread-wasm COI-only forever
(`vite-esbuild-runtime.ts:31-32`; asserted, not re-measured) — and `npm create vite` defaults to 8, so
"agent scaffolds fresh project" needs pinned Vite 7 template or a loud named error, never a wasm crash.

HMR spike 2026-08-28 (branch `t3code/prototype-hmr-agent-scenarios`, commit 61aeec95f,
`prototype/no-coi-agent-loop/FINDINGS-HMR.md` + `hmr-result.json`; production-shaped path:
agent write+flush → real Vite 7 watcher → net BroadcastChannel HTTP+WS bridge → production sw.js → iframe):
- Dev boots no-COI: listen ~0.5s, optimizeDeps commit ~4.3s (real esbuild-wasm, 20 files/9.79MB).
- HMR steady: 100/100 cycles, p50 244ms / p95 265ms, bootId stable (no hidden reloads); 50-file storm
  50/50 updates, agent fs-RPC p95 0.3ms during storm; heap plateau (+0.12% worker / +0.81% page over 100).
- Resident `vite build` correct (2.1s) with dev alive; agent fs stalls p95 387ms during build bursts.
- Wedge (real plugin infinite loop, HMR-triggered): agent+fs+dev share one blocked loop — structural,
  non-preemptible. Recovery: terminate → dev ready 6.6s (OPFS reopen 5.5s); preview WS does NOT
  auto-reconnect to same-port server — only iframe reload restores (12.75s probe).
- Kill during unflushed multi-file write-through, 10 trials ×2 repeats: 0/120 files partial/corrupt
  (per-file old-or-new atomic), but 5/10 reopened trees CROSS GENERATIONS (up to all-new data + old
  manifest) — silent, only external oracle detects; in-memory persist-failure ledger dies with worker.
  Acknowledged `flush()` is a real durability boundary; tree consistency before it is not promisable
  without transaction/journal/epoch machinery.
- Clean reload durability green: full page reload → tree survives byte-for-byte, reopen ~5.5s.

Open verifications:
- No no-COI CI lane exists; both spike harnesses are throwaway (deep imports, forced OPFS gate,
  committed-sw.js serving — FINDINGS-HMR §8, report §12).

## Decisions (interview closed 2026-08-28 — all forks resolved by user)

1. Acceptance = agent headless SDK loop, own origin (GH-Pages-class); third-party iframe w/o origin out.
2. OPFS persistence in tier (policy flip + reload-durability proof — proven green in HMR spike).
3. Degradation = warn-once + capability report; execSync stays throw; mandatory console-swap
   (doctrine: no silent lie at any tier); `os.cpus()`/`availableParallelism` → 1.
4. dev+HMR IN the tier; slice order build+extract first, dev+HMR second.
5. Tier = `works`. `robust` declined on evidence: wedge non-preemptible in one event loop,
   pre-flush tree consistency needs journal/epoch — different-epic-class machinery.
6. Preview after worker death = explicit reload policy: died-event + documented restore
   (reboot + iframe reload) SDK primitive. Auto-reconnect (epoch/heartbeat mechanism) declined.
7. Durability contract = acknowledged `flush()` boundary; forced kill before flush does not promise
   tree consistency — declared loudly (docs + capability report); per-file old-or-new atomicity stated.
   Workspace transaction/journal declined at this tier.

## Proposed Invariants (for `rifty-goal` FIT; each false on main today)

1. On a real no-COI Chromium page (`crossOriginIsolated===false`), `createSandbox` boots and the
   capability report enumerates working / degraded(warn) / throwing surfaces. (Today: default throw,
   no report.)
2. `npm install` of a real Vite 7 dep set completes no-COI. (Today: dies on bare-SAB TextDecoder
   ReferenceError — `worker-realm-compat.ts:75,80`.)
3. Agent loop write → `vite build` (node_modules/.bin/vite) → read `dist/`, artifacts byte-identical
   to the COI product. (Today: real-Vite composition exists only behind workbench COI gates.)
4. `vite dev` boots no-COI; agent write+flush → HMR update visible in SW-served preview iframe with
   stable bootId (no hidden reload). (Today: unreachable.)
5. OPFS no-COI: acknowledged flush → full page reload → tree survives byte-for-byte. (Today:
   `vfs/boot.ts:23` forces memory backend.)
6. Worker death surfaces as an event + documented restore primitive (reboot + iframe reload) recovers
   dev+preview. (Today: none.)
7. Same-realm spawn child `console.*` reaches the child's stdout pipe; spawn warns once; execSync
   loud-throws; cpus report 1. (Today: silent stdout loss.)
8. A no-COI CI lane (no COOP/COEP headers served) proves 1-7 in real Chromium. (Today: zero no-COI lanes.)

Epic-shaped; fit via `rifty-goal` FIT. Slice order: bare-SAB guard (RED-first) → console swap + cpus →
OPFS flip + reload proof → build composition + no-COI lane → dev+HMR + death/restore primitive.

## Challenge

challenge: 2026-08-28 — 6 problems
- Cheaper route unexamined: the repo's own hosting doc (docs/public/hosting-netlify.md:82) names a coi-serviceworker shim as the GH-Pages route to full-fidelity COI, and the accepted scope (Decision 1: own origin, GH-Pages-class) is exactly where a page can register such a SW — yet the doc never weighs this one-script alternative against an epic (8 invariants, new CI lane, console-swap/cpus machinery, OPFS policy flip, permanent second topology).
- Impact claim unsized: '#1 adoption caveat (M11 Standable)' appears nowhere in the repo but this doc — ROADMAP:83-85 treats COOP/COEP as one item of scaffold-emitted host wiring, and the doc offers zero evidence of what share of real adopters actually lack response-header control.
- Embed value claimed but not delivered: the why cites 'drop-in embeds (iframe-embed.md:13)' as motivating exclusion, yet Decision 1 rules third-party iframe without origin control out of acceptance, so the proposed work unlocks none of the embed scenario it is sold on.
- Value ceiling pinned to one aging Vite version: by the doc's own evidence Vite 8/Rolldown is 'COI-only forever' and `npm create vite` already defaults to 8 (runtime gate is exact 7.3.6, vite-esbuild-runtime.ts), so the tier's flagship agent scenario decays from day one to a pinned-template niche — this durability cost is recorded as a fact but never weighed against the epic-class investment.
- Direction conflict unacknowledged: the tier promotes the in-realm same-realm child path to a supported product surface, while docs/backlog/kernel/process-equals-web-worker.md (M6 open acceptance, ROADMAP:43) aims to drop that exact `new Function` fallback for real Worker-per-child — that item's open fork ('honest degraded mode vs remove') is silently decided here and the item is absent from sources.
- The why header still leads with '~2x faster per cycle than the product path' although the doc's own staleness note disavows the speedup as pre-#279-stale and states the value rests on hosting/embed unlock — the premise line advertises a claim the body retracts.

(Post-challenge edits: problem 5 → direction-fork section added + item in sources; problem 6 → why
rewritten to lead with the hosting unlock. Problems 1-4 stand as advisory input for FIT signoff:
1 (coi-serviceworker shim) and 2 (unsized adopter share) challenge the premise the owner must weigh;
3 restates Decision 1's own-origin scope honestly; 4 is the recorded Vite-7 pin.)
