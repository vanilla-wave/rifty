---
area: runtime-js
status: ready
title: "In the isolate guest `require` behaves as Node 24 launched with `--no-require-module` until the guest has an ES module loader"
created: 2026-11-22
why: The guest claims `require(esm)` (`process.features.require_module === true`, the `module-sync` condition) without an ESM loader, so `require` of a dual package's ESM entry or of an ES module throws `TypeError: URLConstructor is not a constructor` — a leaked internal name, neither Node's behaviour nor a named gap
user_story: As an agent backend running ordinary npm libraries in an isolate sandbox, I want `require('is-generator-function')` (exceljs 4.4.0's main entry, through es-abstract) to load as in Node, but today its `require('generator-function')` takes the `module-sync` ESM entry and throws `TypeError: URLConstructor is not a constructor`
sources: [PR-421-external-review-round-1, docs/backlog/distribution/reference/isolate-library-probe/README.md, docs/adr/runtime-js/0571-prove-node-file-entry-and-fatal-report-parity-against-live-node-node-s-report-in-the-isolate-guest-only.md, ADR-0557]
code: [packages/runtime-js/src/internal/require-module.ts (new), packages/runtime-js/src/module-loader/resolver.ts, packages/runtime-js/src/module-loader/resolver-profile.ts, packages/runtime-js/src/module-loader/loader.ts, packages/runtime-js/src/builtins/process.ts, packages/isolate-guest/src/guest/entry.ts]
---

## Context

The isolate guest has no ES module loader: rifty's needs `URL`, a ceiling global there
(compat isolate-host.md "ES modules" ❌). `URLConstructor = globalThis.URL` is captured at
runtime-js load, before the guest installs its ceiling `URL` (`web-shim.ts`), so every
`require` that reaches the ESM path throws `TypeError: URLConstructor is not a constructor`
before the module runs. Fault class `sibling-drift`: one runtime path behaves per host on a
host-provided global.

Measured 2026-11-24, `runCode` (`packages/isolate-host/dist`, this branch) vs Node v24.16.0:
`process.features.require_module` `true`; `require` of `m.mjs`, of a `.js` under
`"type": "module"`, of a typeless `.js` with `export` or `let require = 1` / `const exports = 1`,
and of a package whose `exports` lists `"module-sync": "./r.mjs"` before `"default": "./i.js"`
all throw the `TypeError`; `require.resolve` of that package → `r.mjs`. Real path: exceljs 4.4.0
main entry → es-abstract → `which-builtin-type` → `is-generator-function@1.1.2/index.js:12`
(`generator-function@2.0.1`) and `is-async-function@2.1.1/index.js:13` (`async-function@1.0.0`),
both `{"module-sync": "./require.mjs", "import": "./index.mjs", "default": "./index.js"}`;
`nanoid` 6.0.2 (`"type": "module"`, docx 9.15.3's dependency) the same `TypeError`.

Manager decision 2026-11-24 (not the user's words; reversible, leaves with an isolate ESM loader):
while the guest has no ESM loader, its `require` behaves as Node 24 launched with
`--no-require-module` — a real Node mode, the oracle of this unit. Declared deviation from
Node 24's default. Browser hosts keep real `require(esm)`, unchanged.

Oracle, Node v24.16.0 `node --no-require-module` (`--no-experimental-require-module` is its
alias, same output), probed 2026-11-24 (`<root>` = the cwd, parent `<root>/[eval]` from `-e`,
or the requiring file):

| `require(x)` | Node `--no-require-module` | Node default | guest today |
|---|---|---|---|
| `process.features.require_module` | `false` (enumerable configurable getter) | `true` | `true` |
| `m.mjs` (`export const a = 1`, or no ESM syntax) | `Error` `ERR_REQUIRE_ESM` (A) | namespace | `TypeError: URLConstructor…` |
| `tm/x.js`, `tm/package.json` `"type": "module"`, ESM syntax | `Error` `ERR_REQUIRE_ESM` (B) | namespace | same `TypeError` |
| `tm/v.js`, same scope, no ESM syntax (`var x = 1`) | `Error` `ERR_REQUIRE_ESM` (C) | namespace | same `TypeError` |
| typeless `s.js` `export const a = 1` | `SyntaxError: Unexpected token 'export'` + warning (W) | namespace | same `TypeError` |
| typeless `b.js` `let require = 1` | `SyntaxError: Identifier 'require' has already been declared` + W | `{}` | same `TypeError` |
| typeless `d.js` `const exports = 1` | `SyntaxError: Identifier 'exports' has already been declared` + W | `{}` | same `TypeError` |
| `a.cjs` `let require = 1` / `e.cjs` `export …` | V8's `SyntaxError` + W | same | `ModuleLoadError` `SYNTAX_ERROR` `Failed to compile CJS module <file>: <V8 message>`, no W |
| package `{"module-sync": "./r.mjs", "default": "./i.js"}` | `i.js` (`require` and `require.resolve`) | `r.mjs` | `TypeError` / `r.mjs` |

`ERR_REQUIRE_ESM`: `e.constructor === Error`, `name` `Error`, own keys `stack`, `code`,
`message`, `stack` head `Error [ERR_REQUIRE_ESM]: `; message, `<p>` the parent path:

Without a parent (a direct `require.extensions['.js'](new Module(file), file)` call) ` from <p>` is absent and (B)'s `in <p>` reads `in null`; the hook refuses an `.mjs` too (A).

- (A) `require() of ES Module <file> from <p> not supported.\nInstead change the require of <file> to a dynamic import() which is available in all CommonJS modules.` (any `.mjs`, with or without a `package.json` above)
- (B) `require() of ES Module <file> from <p> not supported.\nInstead change the require of <basename> in <p> to a dynamic import() which is available in all CommonJS modules.`
- (C) `require() of ES Module <file> from <p> not supported.\n<basename> is treated as an ES module file as it is a .js file whose nearest parent package.json contains "type": "module" which declares all .js files in that package scope as ES modules.\nInstead either rename <basename> to end in .cjs, change the requiring code to use dynamic import() which is available in all CommonJS modules, or change "type": "module" to "type": "commonjs" in <scope>/package.json to treat all .js files as CommonJS (using .mjs for all ES modules instead).\n`

(W) stderr `(node:<pid>) Warning: Failed to load the ES module: <file>. Make sure to set "type": "module" in the nearest package.json file or use the .mjs extension.` (+ the `--trace-warnings` hint once), on every such `require`.

In this mode `import()` still loads ES modules and a file entry is still detected as ESM
(`--experimental-detect-module` is separate); in the guest both stay named gaps
(`isolate-host.dynamic-import`, `isolate-host.esm`), measured without `URLConstructor`.

## User scenario

The installed closures of `is-generator-function@1.1.2` and `is-async-function@2.1.1` in the
state of `createSandbox({ snapshot })`; `sandbox.exec(gen)` of a file that requires each and
prints its verdict on a generator, an async, a plain and an arrow function. Today: exit 1,
`TypeError: URLConstructor is not a constructor`. Node over the same files: the verdicts, exit 0.

## Acceptance

1. Isolate parity against live `node --no-require-module -e` over the same files
   (`packages/isolate-host/tests/require-esm.test.ts`): `process.features.require_module`;
   every `ERR_REQUIRE_ESM` row's constructor, `name`, `code`, message, `stack` head and own keys
   (from `-e`, from a file, and through `require.extensions['.js']` with and without a parent);
   the `module-sync` package's `require` and `require.resolve`. Never `URLConstructor` → scenario
2. The typeless-`.js` and `.cjs` SyntaxError rows: the guest's existing `ModuleLoadError`
   `SYNTAX_ERROR` carrying V8's exact message, pinned as `runtime-js/module-compile-error-node-syntax-error`;
   W absent, pinned as its own row (Out of scope) → scenario
3. The user scenario: guest stdout/exit equal live `node <gen>` (default and `--no-require-module`) → scenario
4. `require('exceljs')` in a sandbox no longer stops at the `module-sync` `require`: shown by a
   separate run in the PR report, not pinned in `library-exceljs.test.ts` (its prior stop,
   `runtime-js/cjs-global-function-assignment`, is another unit's) → scenario
5. Browser hosts unchanged: with the runtime's default the four switched behaviours stay
   Node 24's — `process.features.require_module` `true`, `module-sync` taken by `require` and
   `import`, a typeless ESM-syntax `.js` loaded by `require` as ESM, `require` of `.mjs`
   returning its namespace (`packages/runtime-js/src/module-loader/require-module-switch.test.ts`) → ADR-0557
6. ESM entry (`node m.mjs`, `node tm/x.js`, `node b.js`) and `import()` in the guest: their
   named gaps, no `URLConstructor` (same isolate test file) → ADR-0557
7. compat isolate-host.md rows say "as Node launched with `--no-require-module`" → ADR-0557

## Reference contract

- Oracle: Node v24.16.0 (`process.execPath` of the test run) with `--no-require-module`.
- Messages: Node's `ERR_REQUIRE_ESM` (A)/(B)/(C) above, text as probed; "has ESM syntax" read
  as the loader's detection (`!parsesAsCommonJs && parsesAsEsm`, `resolver-profile.ts`).
- Mechanism: one boolean `requireModule` (Node's flag name), default `true`, set by the host
  before guest code; four readers: the `module-sync` condition, `require`'s typeless-`.js`
  syntax detection, `ERR_REQUIRE_ESM` at `require` of an ES module, `process.features.require_module`.

## Parity cases

1. `process.features.require_module` → `false` → scenario
2. (A)/(B)/(C) from `-e`, from a file, and via `require.extensions['.js']` with and without a parent: constructor, `name`, `code`, message, `stack` head, own keys; the SyntaxError rows: V8's message inside the pinned wrapper → scenario
3. Dual package: `require('dual')` → CJS entry, `require.resolve('dual')` → `i.js` → scenario
4. Real `is-generator-function` / `is-async-function` verdicts (`node <gen>`) → scenario
5. RED targets: 1–4 fail today with `URLConstructor` / `true` / `r.mjs` → scenario

## Out of scope

- W, the "Failed to load the ES module" warning: rifty emits it on no host (Node emits it for a
  `.cjs` in its default mode too; rifty's browser hosts do not); the guest's stderr is empty there, pinned — finding
  `runtime-js/cjs-esm-syntax-load-warning`, compat ⚠️.
- The CJS compile error's `ModuleLoadError` wrapper (constructor, `code` `SYNTAX_ERROR`, message
  prefix): `runtime-js/module-compile-error-node-syntax-error` (user-deferred), compat ⚠️.
- `require.extensions['.js'](obj, file)` on a plain object with an own `parent`: rifty names that
  parent (it reads `module.parent`), Node none (its internal slot); `new Module(id, parent)` is
  `runtime-js/node-module-builtin-module-class`, compat ⚠️.
- ES modules in the guest (`import()`, ESM entry): `isolate-host.dynamic-import`, `isolate-host.esm`, compat ❌.
- `process.execArgv` stays `[]` (Node `['--no-require-module', …]`): the mode is the host's, not a
  launch token; `--no-require-module` in a `fork`/`Worker` `execArgv` stays
  `NotImplementedError('child_process.fork.execArgv')` on browser hosts.
- `fs` path type errors (`readFileSync({})` → `Right-hand side of 'instanceof' is not an object`,
  `fs-path.ts` `URLConstructor`): `runtime-js/isolate-fs-path-url-instanceof`.

## Decisions

- The mode is a realm-level boolean in runtime-js (`internal/require-module.ts`), set by the guest before any guest code; not a startup-options token (fork/Worker would start accepting it — a browser change).
- Typeless `.js`: `require` skips syntax detection when the mode is off (Node compiles it as CJS); `import`/entry resolution (`esm: true`) still detects.
- `module-sync` is dropped from both condition sets when off, as Node's `initializeDefaultConditions`.
- `ERR_REQUIRE_ESM` has Node's `NodeError` shape (prototype with `constructor` Error and the coded `toString`, then `Error.prototype`; own `stack`, `code`, `message`; coded `stack` head), not `ModuleLoadError` (constructor would differ).
- `process.features.require_module` becomes an enumerable configurable getter (Node's descriptor); value on browser hosts unchanged.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
challenge: 2026-11-24 — 5 problems (fresh reviewer, final written-result check, oracle spot-checked): Acceptance 1 claimed Node's shape for the pinned SyntaxError rows → scoped to `ERR_REQUIRE_ESM` rows; W bullet misread as a Node claim → reworded; the no-parent message variant missing → listed + parity row; this line missing → recorded; the fs finding named only the isolate symptom → both hosts' symptoms named. Direction is the manager's decision (premise not re-challenged).
