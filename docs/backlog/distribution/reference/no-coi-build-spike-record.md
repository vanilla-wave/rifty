# No-COI build-loop spike — durable record (2026-08-25)

Provenance: throwaway branch `t3code/prototype-no-coi-agent-cycle`,
`prototype/no-coi-agent-loop/FINDINGS.md`. Branch artifacts rot (declined-concepts
row on ownerless git refs), so the load-bearing numbers are inlined here. Written
2026-08-31 because `no-coi-sandbox-tier` cited "byte-identical artifacts" against
records that never carried the install/build evidence — the citation, not the
spike, was the gap. Re-verify against current main before building on it.

Environment: macOS darwin 25.3.0, Chromium (Playwright bundled). 3 repeats per
harness lane; product lane run 3× (spread within noise).

## Scenario — identical in every lane

`react@^19.2` + `react-dom@^19.2` + `@gravity-ui/uikit@^7.48.1` +
`@gravity-ui/icons@^2.16` + `date-fns@^4.1` + `vite@7.3.6` → **78 packages**.
Then 5 agent cycles: rewrite `src/Panel.jsx` → `vite build` → read `dist/`.

Same work proven, not assumed: every lane reports `2180 modules transformed` and
emits `index-BFe216yH.js` (692 518 B) + `index-D12zk3ct.css` (148 283 B) — same
content hashes in harness and product. Each harness build asserts the iteration
marker is present in the emitted JS, so a stale-graph rebuild cannot pass as real.

## Medians (ms)

| lane | install | esbuild prep | cold build | warm build p50 | edit | 200× fs-RPC 4 KiB |
|---|---|---|---|---|---|---|
| `no-coi` (memory) | 14 948 | 2 182 | 2 559 | **2 091** | 0.1 | 5 |
| `coi` (memory) | 15 633 | 2 195 | 2 603 | **2 115** | 0.1 | 73 |
| `coi-opfs` | 15 173 | 2 040 | 8 119 | **2 103** | 1.4 | 75 |
| `no-coi-opfs` | 15 000 | 1 722 | 8 390 | **2 073** | 1.2 | 5 |
| `product-coi` (real playground) | 26 640 | — | 4 029 | **4 293** | 1 148 | — |

Vite's own self-report, same build: no-COI single worker 1.13 s vite / 2.09 s wall
(0.96 s overhead); product COI 1.65 s vite / 4.29 s wall (2.64 s overhead).

## What this proves — and what it does not

Proves: the single-worker composition runs the real Vite 7 agent loop to
byte-identical artifacts, and does so with LESS harness overhead than today's
product path.

Does NOT prove that dropping COI is the source of the win: the `no-coi` and `coi`
harness lanes are within noise of each other (14 948 vs 15 633 install; 2 091 vs
2 115 warm build). The gap is harness-vs-product composition, not isolation. Any
claim that the no-COI tier is "faster" must name that axis, or it misattributes a
composition win to the absence of `SharedArrayBuffer`. The one axis where the
lanes genuinely diverge is fs-RPC (5 ms vs 73 ms per 200 calls) — in-realm calls
versus the SAB ring.
