---
area: distribution
status: ready
title: In the isolate guest `navigator` and `Navigator` have Node 24's shape and report the guest's own identity
created: 2026-11-24
why: Node 24 code that reads `navigator.userAgent` (core-js, inlined in many bundles) dies at load in the isolate guest, where every `navigator` member throws `NotImplementedError('isolate-host.navigator.<member>')`; `os.cpus()`/`os.availableParallelism()` throw the same way
user_story: As an agent running a generator in an isolate-host sandbox, I want `require('exceljs/dist/exceljs.min.js')` to get past core-js's user-agent read, but today it throws `isolate-host.navigator.userAgent` at load
sources: [docs/backlog/distribution/reference/isolate-library-probe/README.md, docs/adr/distribution/0557-run-guest-code-in-a-disposable-child-process-holding-a-rifty-v8-isolate-isolated-vm.md]
code: [packages/isolate-guest/src/guest/web-shim.ts, packages/runtime-js/src/builtins/os.ts, packages/isolate-host/tests/parity.test.ts]
---

## Context

Probe `reference/isolate-library-probe` (README, "Missing" row 4): `gen/xlsx-browser.cjs`
(`exceljs/dist/exceljs.min.js:10`) and `gen/pptx-bundle.cjs` (`pptxgenjs/dist/pptxgen.bundle.js`)
stop at core-js `internals/environment-user-agent` reading `navigator.userAgent`. The shim
(`web-shim.ts` `NAVIGATOR_MEMBERS`, `installCeilingGlobals`) makes `navigator` a plain object
whose five getters throw, and `Navigator` a ceiling thrower. Measured 2026-11-24 at 4e6442c48
(`runCode`, Node v24.16.0 host): `os.availableParallelism()` and `os.cpus()` throw
`isolate-host.navigator.hardwareConcurrency` (`os.ts` reads `navigator.hardwareConcurrency`);
guest `process.version` `v24.0.0`, `process.platform` `rifty`, `process.arch` `wasm`,
`new Intl.DateTimeFormat().resolvedOptions().locale` `en-US`.

## Challenge

challenge: 2026-11-24 — clear (no premise critic: existing-baseline repair, README §Challenge; direction is the manager's decision. Final written-result check 2026-11-24, fresh reviewer: 4 problems in the sibling drafts, resolved)

## User scenario

`sandbox.exec('gen/xlsx-browser.cjs', { args: ['out.xlsx'] })` over the probe's `node_modules`:
`require('exceljs/dist/exceljs.min.js')` passes core-js's `navigator.userAgent` read
(today: `NotImplementedError: Not implemented: isolate-host.navigator.userAgent`, exit 1).

## Acceptance

1. Parity cases 1–4 byte-equal to live `node -e` (`packages/isolate-host/tests/navigator.test.ts`) → ADR-0557
2. Parity cases 5–7 hold in the guest; no host value reaches it → ADR-0557
3. `require('core-js/actual')` (core-js 3.51.0, the real npm package) in a sandbox prints what
   `node main.js` prints over the same `node_modules` → scenario
4. Probe routes `gen/xlsx-browser.cjs`, `gen/pptx-bundle.cjs` no longer stop at `navigator`; their
   next stops recorded in the probe README → scenario
5. `navigator.locks` is the named gap `isolate-host.navigator.locks` (ceiling-list test) → ADR-0557
6. compat `isolate-host.md` rows state the shape, the values and the gaps → ADR-0557

## Reference contract

- Oracle: Node v24.16.0 `lib/internal/navigator.js` (`String(Navigator)`, `--expose-internals`
  `getNavigatorPlatform`), live `node -e`.
- Mechanism: a class with private fields (`#availableParallelism`, `#locks`, `#userAgent`,
  `#platform`, `#languages`) as Node's brand checks, enumerable prototype getters, a symbol-keyed
  constructor; semantic copy — ADR-0557 §5 2026-11-24 line + differential suite `navigator.test.ts`.

## Parity cases

1. Global `navigator`: own accessor `get navigator` (length 0), no setter, enumerable,
   configurable; same object each read; strict assignment `TypeError: Cannot set property
   navigator of #<Object> which has only a getter`, sloppy ignored; `delete` → `true`, then
   `undefined`. Global `Navigator`: writable, non-enumerable, configurable → ADR-0557
2. `Navigator.prototype` own keys `constructor, hardwareConcurrency, locks, language, languages,
   userAgent, platform`; each getter `get <name>`/0, enumerable, configurable; proto of the
   prototype `Object.prototype`; `navigator instanceof Navigator`; no own keys, `Object.keys` `[]`,
   `for…in` the six getters, `JSON.stringify` `{}`, `Object.prototype.toString` `[object Object]`,
   `util.inspect` `Navigator {}` → ADR-0557
3. `new Navigator()` → `TypeError`, message `Illegal constructor`, own enumerable `code`
   `ERR_ILLEGAL_CONSTRUCTOR`; `Navigator()` → `Class constructor Navigator cannot be invoked
   without 'new'`; `Navigator.name`/`length` `Navigator`/0 → ADR-0557
4. Getter on a foreign receiver: `Cannot read private member #<field> from an object whose class
   did not declare it` (`#availableParallelism`, `#locks`, `#languages`, `#userAgent`, `#platform`);
   `language` has no brand check (`en-US`) → ADR-0557
5. `userAgent === 'Node.js/' + process.version` major; `hardwareConcurrency ===
   os.availableParallelism() === os.cpus().length`; `language === new
   Intl.DateTimeFormat().resolvedOptions().locale`; `languages` frozen `[language]`, same array
   each read → ADR-0557
6. `platform` = Node's `getNavigatorPlatform(process.arch, process.platform)` of the guest
   (`Rifty wasm`) → ADR-0557
7. Guest values, not the host's: `hardwareConcurrency` 1 (one thread, no Workers), `userAgent`
   `Node.js/24` from `v24.0.0`, `platform` from `rifty`/`wasm` → ADR-0557

## Out of scope

- `navigator.locks`: `NotImplementedError('isolate-host.navigator.locks')` on read (Node: a
  `LockManager`); compat isolate-host.md ❌.
- `[ERR_ILLEGAL_CONSTRUCTOR]` label in `String(e)`/`stack`/inspect and Node's error prototype:
  every rifty-thrown Node error is a plain `TypeError` + `code` —
  `runtime-js/node-error-code-label`, compat ⚠️.
- `util.inspect(Navigator)` `[Function: Navigator]` (Node `[class Navigator]`) and
  `inspect(navigator, { showHidden: true })`: compat "util.inspect default format: classes" ⚠️.
- Browser hosts' guest `navigator` (the browser's `WorkerNavigator`): not changed —
  `runtime-js/browser-host-guest-navigator`, compat process.md ⚠️.
- A guest replacing `globalThis.navigator` changes `os.availableParallelism()`/`os.cpus()` (rifty's
  `os` reads the global; Node's does not): open class "guest replaces what the runtime reads",
  compat isolate-host.md row "Guest code replacing JS intrinsics".

## Decisions

- `hardwareConcurrency` 1: the isolate runs one thread (`worker_threads` is a ceiling); `os` keeps reading it, so they agree.
- `language`: V8's default locale via a captured `Intl.DateTimeFormat`/`resolvedOptions` (Node: ICU binding; equal on every measured `LANG`).
- `platform`: only Node's last branch is ported — the guest's `rifty` names no platform of Node's table; the test checks against Node's own function.
- `userAgent`/`platform` computed at shim load from `NODE_PROCESS_IDENTITY` (Node: its internal copies, guest edits to `process` do not reach them).
- Installed where the ceilings are (after runtime load): runtime load-time detection keeps seeing no `navigator`.
- Test package core-js 3.51.0 as an isolate-host devDependency; its postinstall banner not allowed (`allowBuilds: false`).
