---
area: playground
status: ready
title: Ordinary webpack-dev-server starter proves the generic npm dev-server path
created: 2026-09-03
why: The preset-deglue scenario explicitly promises that replacing Vite with webpack-dev-server keeps install, LIVE, preview, HMR, and reload working, but main has no ordinary webpack starter or end-to-end proof of that non-Vite path.
user_story: As a developer evaluating rifty, I want to open an ordinary webpack 5 project and use its stock dev server and HMR, but today only Vite-backed starters prove that browser workflow.
epic: preset-deglue
blocked_by: []
sources: [docs/backlog/epics/preset-deglue.md, ADR-0189, ADR-0349, ADR-0350, ADR-0351, ADR-0352, ADR-0353, ADR-0354, ADR-0355]
code: [apps/playground/src/templates/webpack-dev-server.ts, apps/playground/src/templates/npm-dev-server-node-ws.ts, packages/workbench/src/workbench/project-definition.ts, packages/workbench/src/workbench/node-project-runtime.ts, tests/e2e/helpers/webpack-dev-server-scenario.ts, tests/e2e/helpers/npm-dev-server-node-ws-scenario.ts]
---

## Context

`docs/backlog/epics/preset-deglue.md` names webpack-dev-server and bare
`node server.mjs` as the observable non-Vite proof. PR #122 originally carried
that implementation without a unit item. This document restores the missing
contract and records that process defect; it does not claim the checkpoint
preceded the existing implementation.

Node 24 oracle, executed 2026-09-03:

`RIFTY_RUN_WEBPACK_NODE_ORACLE=1 pnpm exec tsx tests/diagnostics/webpack-dev-server-node24-oracle.ts`

Result: PASS on Node 24.16.0/npm 11.17.0. `npm run dev` ran webpack 5.109.2,
webpack-cli 5.1.4, webpack-dev-server 5.2.6, css-loader 7.1.4, and style-loader
4.0.0; HTTP served the generated HTML/JS/CSS and a source+CSS edit produced a
second successful compilation with an HMR update.

The first PR CI run reached all product scenarios but failed three browser-unit
assertions because their esbuild-only WASM ledger also counted the newly
host-published QuickJS bootstrap once per Node Worker realm. The exact RED is
`pnpm test:browser-unit tests/browser-unit/esbuild-vite-contract.spec.ts --grep
"direct CJS require"`: expected only sql.js, received sql.js plus eight exact
`@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm` requests.

## Challenge

challenge: 2026-09-03 — 3 problems
- impact: документ не оценивает долю webpack-dev-server-пользователей или вклад этого starter в общий adoption gap; «ordinary» не доказывает приоритет относительно M11-барьеров.
- cheaper route: generic `npm-dev-server` уже напрямую доказывает hidden bare `node server.mjs` fixture; webpack tile и многолинейные cold-install journeys требуют отдельного UX-обоснования, а не genericity.
- direction: работа ближе к M10 tooling-proof, тогда как активный M11 сфокусирован на standable/embeddable/durable UX; документ не сравнивает opportunity cost даже с открытым full real-Vite browser e2e.

The bare Node fixture proves only that the plan and preview transport contain no
webpack branch. It cannot prove that an ordinary npm tool using memfs, callable
legacy streams, VM compilation, generated assets, stock HMR, and strict
Host/Origin checks works. The webpack tile is the smallest organic package that
closes the epic's explicitly named webpack scenario; the Node 24 oracle and
three Chromium carriers compare the same user journey rather than multiplying
features. No repository evidence supports a webpack-user share, so this item
makes no adoption-size claim. It closes an already-open preset-deglue promise
and does not displace or weaken M11's embeddable/durable contracts.

## User scenario

Open Playground → webpack starter. The terminal visibly installs the declared
npm dependencies and runs exactly `webpack serve`. LIVE and the routed preview
appear on webpack's actual port; the page loads its generated JS/CSS. Editing
JS or CSS updates through webpack's stock HMR without navigating the iframe.
Reloading the Playground restores the project and restarts the recorded command.
The same seeded bytes run unchanged under local Node 24/npm.

## Acceptance

- The visible seed is ordinary webpack 5 + webpack-cli 5 +
  webpack-dev-server 5 + css/style loaders. `/package.json` owns exactly
  `scripts.dev = "webpack serve"`; the CommonJS webpack config owns
  `publicPath: "auto"` and the preferred port. → ADR-0349, ADR-0355
- The public Playground plan adds only `kind: "npm-dev-server"`. It exposes no
  webpack field, command, bin, entry path, port, host, or readiness regex.
  Workbench validates the exact manifest and runs root-pinned `npm run dev`;
  a hidden bare-Node+WS fixture proves the path has no webpack branch.
  → ADR-0349
- Preview readiness comes from the first owner/PTY-correlated routed HTTP
  candidate. Only physical child exit owns stopped state; a failed HTTP proof
  leaves the live run stoppable. → ADR-0349
- Local development and emitted-production Chromium journeys cold-install the
  real graph, reach LIVE/HTTP 200, independently update JS and CSS through stock
  no-navigation HMR, then reload/restart over persisted edits. → scenario
- A CI-active HTTPS journey at the reserved non-local hostname proves the
  visible exact-host allow-list, truthful browser Origin, HTTP 200, and stock
  HMR. Wildcards, `allowedHosts: "all"`, and Host/Origin rewrites fail the
  contract. → ADR-0355
- Webpack's reached Node surfaces retain their separate parity proofs:
  ArrayBuffer-backed Buffer aliasing, callable legacy stream constructors,
  `vm.createContext` name/code-generation policy, routed static eval imports,
  request-socket EventEmitter methods, and monotonic SAB reply deadlines.
  → scenario

## Reference contract

- Node 24.16.0/npm 11.17.0 on the exact seeded tree is the starter oracle;
  command and PASS transcript are recorded in `## Context`.
- webpack-dev-server 5.2.6 owns its emitted client, compilation output, HMR
  protocol, and Host/Origin validation. Rifty supplies only npm execution and
  its generic HTTP/WebSocket preview transport.

## Parity cases

- Exact seeded tree under local Node 24 and rifty: `npm install` resolves the
  five declared tools; `npm run dev` serves generated HTML/JS/CSS; JS+CSS edits
  trigger a second successful compilation and visible update. → scenario
- `pnpm -s test:parity buffer/from-backing-store` and
  `pnpm -s test:parity stream/callable` preserve Node backing-store aliasing,
  bounds/growth, and all five streams' call/construct, prototype, re-entry, and
  option behavior. → ADR-0350, ADR-0353
- `pnpm -s test:parity vm/create-context-webpack` and
  `pnpm -s test:parity modules/function-constructor-import` preserve
  webpack-reached VM/static eval-import behavior; unsafe forms stay loud.
  `pnpm -s test:parity http/server-request-socket` preserves the request-socket
  EventEmitter surface middleware observes. → scenario

## Fault matrix

| Axis | Boundary | Honest outcome / proof |
|---|---|---|
| frozen-assumption | hosted browser | non-local HTTPS Host/Origin completes stock HMR; localhost-only proof cannot close acceptance → ADR-0355 |
| provenance-lie / corrupt-input | plan/manifest/network/SAB | exact manifest owns command; exact Host/Origin survive; malformed identity/hostname rejects; reply state authorizes consume → ADR-0331, ADR-0349, ADR-0354, ADR-0355 |
| observable-order / poisoned-cache | worker/QuickJS/SAB | listener+URL precede init; HTTP cleanup preserves primary failure; rejected preload retries; native timeout stays terminal → ADR-0331, ADR-0351, ADR-0352 |
| unbounded-read | preview/SAB | preview proof and repeated early wakes share finite monotonic deadlines → ADR-0331, ADR-0349 |
| sibling-drift | runtime twins | CJS/ESM/eval, five streams, browser/programmatic Origin, and sync/async waits share owners → REV-7 |
| torn-state | project lifecycle | exact bytes/command survive reload; HMR keeps frame identity; physical exit alone owns stopped → scenario |

## Out of scope

- Arbitrary npm script selection: `npm-dev-server` means the conventional
  `scripts.dev`; a different public plan requires a new decision.
- webpack loaders/plugins beyond the seeded versions. A dependency reaching an
  unsupported Node API throws `NotImplementedError`; no compatibility claim is
  inferred from this starter.
- Public `WebAssembly.compileStreaming` and `instantiateStreaming` remain
  explicit compat ❌ Promise-rejected gaps under ADR-0158.
- `IncomingMessage.socket.destroy()` remains an explicit HTTP compat ⚠️ loud
  gap because a port-registry request has no per-request TCP transport;
  middleware's listener surface is covered, but a finalhandler headers-sent
  error path can surface that `NotImplementedError`.
- Response clone keepalive remains
  `runtime-js/fetch-keepalive-response-clone-lifecycle` (draft).

## Decisions

ready-verdict: 2026-09-03 — Contract+RED @ 76e669240
review: checkpoints
contract-red: round 1 — blocker @ 75802657a
final-green: 2026-09-03 — pass @ f068554e6 (legacy pre-RDY-3 record)
re-cut: 2026-09-03 — grouped 21 legacy rows into 15 traced rows after concurrent RDY-3/RDY-4 merge — trace: none

- ADR-0349 owns the zero-field plan; ADR-0355 owns exact-host policy; ADR-0354 forbids Host/Origin rewriting.
- Challenge answer: hidden bare Node proves genericity, not real-webpack compatibility.
- Process repair 2026-09-03: implementation predates this unit document.
