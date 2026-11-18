---
area: runtime-js
status: draft
title: "`node -e`/`-p` sets its `[eval]` bindings the way Node's wrapper does"
created: 2026-11-18
why: rifty defines `require`/`module`/`exports`/`__filename`/`__dirname` with `defineProperty`; Node assigns them, so a pre-existing non-configurable value makes every rifty eval throw where Node runs it (or fails differently per name)
sources: [docs/public/compat/process.md, tests/no-coi/no-coi-shared-realm.spec.ts]
code: [packages/runtime-js/src/module-loader/loader.ts, packages/runtime-js/src/builtins/node-entry.ts]
---

## Context

PR #408 outside finding 5. `installNodeEvalCjsBindings` (`loader.ts`) calls
`Object.defineProperty(globalThis, name, { writable, enumerable, configurable:
true })`. Node v24.16.0 `lib/internal/process/execution.js`
`runScriptInContext` assigns: the sloppy `[eval]-wrapper` does
`globalThis.module/exports/__dirname/require = …`, strict internal code does
`globalThis.__filename = name` and, after the synchronous part, when a
`module` existed before (`origModule !== undefined`), `globalThis.module =
origModule`.

Node, value preloaded with `node -r ./pre.js -e "…"` (2026-11-18 probe):
- non-configurable, writable (any of the five): the eval runs with Node's values;
- read-only `__dirname`/`require`/`exports`: the eval runs and reads the guest value (`__dirname` exit 0);
- read-only `__filename`: `TypeError: Cannot assign to read only property '__filename'` before the eval, exit 1;
- read-only `module`: the eval runs, then exit 1 (the `origModule` restore throws).

Rifty: reachable today only as no-COI shared-realm residue — a read-only
non-configurable `__dirname` left by an earlier command makes a later `-e`
exit 1 `TypeError: Cannot redefine property: __dirname` (declared in compat
process.md; `no-coi-shared-realm.spec.ts` row "a non-configurable guest
global…"). Other names/modes are code reading. `runNodeEntry` applies
`--require`/`--import` preloads to file entries only (`node-entry.ts`), so a
same-process preload cannot reach `-e` yet; it will with
`runtime-js/node-cli-preload-import-flags`.

## Next

Owner runtime-js. Parity cases per name × (read-only, non-configurable
writable, accessor) once `-e` takes preloads; until then the no-COI residue row
pins rifty's value.
