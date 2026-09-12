# No-COI sandbox build-loop evidence

Captured 2026-09-03 from `86e5a325d`. Node `v24.16.0`, Vite `7.3.6`, pnpm
`11.9.0`, Playwright `1.60.0`, Chromium `148.0.7778.96`.

## Build differential

Input: `tools/perf/child-fs/scenario.mjs`; scenario SHA-256
`559e5e226348c484d542f197b442d3826e11d9e19c206d028c978d96a4595d4c`,
direct-dependency SHA-256
`de9e65b1ca98200f8be9b40080b3d5ac871c962786b33665d564b3da68d4b0bc`.

Real Node command after exact-direct-dependency install:

```sh
pnpm install --ignore-scripts
pnpm exec vite build --clearScreen false
# ✓ 2180 modules transformed.; exit 0
```

The installed Node graph had 200 unique name/version entries, canonical-list
SHA-256 `cbf1c729f57b07ffefb1f09f926b8df0199bc095fb1013afd2a1ab61e9e2310e`.
Node, live COI and live no-COI outputs were identical:

| path | bytes | SHA-256 |
|---|---:|---|
| `assets/index-D12zk3ct.css` | 148283 | `970108f476dc573aed8db185ceddf740ab88f02c8ad408c8a803b1f38b89fca6` |
| `assets/index-D37UuATt.js` | 692554 | `40fe96a291ede9fbbef98e7159c097c5ea49cc25708f45431f3fce353be4fb09` |
| `index.html` | 184 | `97c7da4599151ac35271f095295057c96b1936e0c1df922c86875d3f941bee60` |

The JS contains `no-coi-build-parity-marker` twice. Browser command:

```sh
pnpm test:no-coi -g \
  'build parity: headerless SDK dist equals live COI product bytes' \
  --reporter=line
# Running 1 test; 1 passed (1.6m)
```

`tools/perf/child-fs/vite-7.3.6-node-golden.json` remains the historical
direct-dependency-only run (`2195` modules). Its unfrozen transitive closure
cannot replace this dated current differential and is not silently updated.

## Identity discrimination

The committed `request-identical Vite 7/8 decoys` carrier creates the exact
real-fixture package version, bin target, cwd/binPath and `['build']` request;
alternate installed bytes emit their own markers and exit 0. No install or
control-plane code sees Vite identity.

## Installed provenance

The real registry installs are read before execution. Vite is
`8.0.16`, bin `vite → bin/vite.js`; nanoid is `3.3.18`, bin
`./bin/nanoid.cjs`. Both exact installed launchers are present; nanoid emits one
seven-character id.

## Threaded WASM

```sh
pnpm test:no-coi -g \
  'request-identical Vite 7/8 decoys|exact nanoid manifest|threaded-WASM: Vite 8 Rolldown|build parity: headerless SDK' \
  --reporter=dot
# Running 4 tests; 4 passed (1.8m)
```

Real Vite 8 reaches `NotImplementedError('toolchain.threaded-wasm')` with no
`dist`; the same-request Vite 8 decoy exits 0. Exact normalized module-line
assertions reject prefixed counts such as `12180`.
