---
area: runtime-js
status: draft
title: On the browser hosts a guest Node program sees the browser's `WorkerNavigator`, not Node 24's `Navigator`
created: 2026-11-24
why: Node 24 code that branches on `navigator.userAgent` (core-js, bundles) or sizes work by `navigator.hardwareConcurrency` sees a Chrome browser and the host's CPU count; undeclared until 2026-11-24
sources: [docs/public/compat/process.md, docs/adr/distribution/0557-run-guest-code-in-a-disposable-child-process-holding-a-rifty-v8-isolate-isolated-vm.md, docs/backlog/runtime-js/guest-browser-only-globals.md]
code: [packages/runtime-js/src/builtins/os.ts]
---

## Context

Found while giving the isolate guest Node's `navigator`
(PR #436 (isolate `navigator` with Node's shape)); browser hosts deliberately
unchanged there. Scratch Playwright specs 2026-11-24 (Playwright 1.60.0,
Chromium 148.0.7778.96, darwin-arm64; no-COI toolchain `createSandbox` +
`node g.cjs`, COI toolchain on `unit-harness.html`, COI playground kernel
terminal) vs `node g.cjs` on Node v24.16.0:

| | Node | all three browser lanes |
|---|---|---|
| `Object.prototype.toString.call(navigator)` | `[object Object]` | `[object WorkerNavigator]` |
| `typeof Navigator` / `WorkerNavigator` | `function` / `undefined` | `undefined` / `function` |
| `userAgent` | `Node.js/24` | `Mozilla/5.0 (…) Chrome/148.0.7778.96 Safari/537.36` |
| `platform`, `language`, `hardwareConcurrency` | host's (`MacIntel`, `en-US`, 12) | browser's = host's |
| `for…in navigator` | 6 keys | 22 keys (`onLine`, `storage`, `gpu`, `usb`, `userAgentData`, …; COI toolchain list not captured) |
| accessor | own on `globalThis` (`get`, no setter, enumerable, configurable) | on `WorkerGlobalScope.prototype` |
| `os.availableParallelism()` / `os.cpus().length` | 12 / 12 | toolchain lanes 1 / 1 (`isSandboxToolchainRealm`), COI kernel 12 / 12 |

In the toolchain lanes `navigator.hardwareConcurrency` (12) disagrees with
`os.availableParallelism()` (1). Guest `process.platform`/`arch`/`version`
are `rifty`/`wasm`/`v24.0.0` on every host, so a Node-rule `navigator` would
read `Node.js/24`, `Rifty wasm`. Compat process.md row "Guest `navigator`
(browser hosts)" ⚠️.

## Question

Which `navigator` does a guest Node program see on the browser hosts: the
browser's (today; rifty itself and pdfjs-style detectors read browser members),
Node 24's shape with the guest's identity (as the isolate host since
2026-11-24), or Node's shape over host values? Adjacent to the
browser-only-globals question (`runtime-js/guest-browser-only-globals`, globals
Node lacks); here Node has the global with another shape. Changing members is
observable both ways.

## Next

Owner runtime-js. Trigger: a guest package that takes a browser branch on the
user agent or a `navigator` member Node lacks, or the browser-globals policy
decision.
