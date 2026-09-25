# Evidence — vitest-run-acceptance (PICKUP 2026-09-23)

Branch base `325ae797c` (goal branch `t3code/vitest-run-browser`). Host oracle:
Node v24.16.0, npm 11.17.0, Darwin arm64, live registry.npmjs.org
(`npm install --prefer-online`: the local npm cache served a stale `vite`
packument, `latest` 8.2.2 vs live 8.3.0). Transcripts below are ANSI-stripped
(`perl -pe 's/\e\[[0-9;?]*[A-Za-z]//g; s/\r//g'`); nothing else edited.

## Host-harness artifact: agent markers change vitest's default reporter

std-env 4 `isAgent` (env `AI_AGENT`, `CLAUDECODE`, `CODEX_THREAD_ID`,
`CURSOR_AGENT`, …) makes vitest 4.1.11 map the default reporter to
`MinimalReporter` (`chunks/index.UpGiHP7g.js:4241` `"agent": MinimalReporter`;
`printTestModule` returns early for non-failed modules) and turns watch off
(`chunks/defaults.9aQKnqFk.js:48`). Same project, fixed state:

```
$ AI_AGENT=claude npx vitest run
 RUN  v4.1.11 /private/tmp/vgoal/u12/oracle-final.dBYW


 Test Files  1 passed (1)
      Tests  2 passed (2)
[exit 0]
$ npx vitest run            (markers unset)
 RUN  v4.1.11 /private/tmp/vgoal/u12/oracle-final.dBYW

 ✓ src/sum.test.ts (2 tests) 1ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
[exit 0]
```

So the prior-attempt claim "native default reporter omits a passing file's
line" (draft PR #351) was an agent-shell artifact. Every oracle run below
unsets the markers:
`env -u CLAUDECODE -u CLAUDE_CODE -u CLAUDE_CODE_ENTRYPOINT -u AI_AGENT -u CODEX_SANDBOX -u CODEX_THREAD_ID -u CURSOR_AGENT -u NO_COLOR -u FORCE_COLOR -u CI`.
The rifty guest env carries none of them.

## Oracle — scenario on real Node

Files (byte-identical to `tests/e2e/vitest-run.spec.ts` seed, checked by
running the spec's generated `printf` lines in bash and `diff`ing):

```
package.json        {"type":"module","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"4.1.11"},"overrides":{"vite":"8.0.16"}}
vitest.config.ts    import { defineConfig } from 'vitest/config';
                    export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })
src/sum.ts          export const sum = (a: number,
                      b: number): number => a + b
src/sum.test.ts     1 import { expect, test } from 'vitest';
                    2 import { sum } from './sum';
                    3
                    4 test('first sum', () => {
                    5   expect(sum(1, 2)).toBe(3);
                    6 });
                    7
                    8 test('second sum', () => {
                    9   expect(sum(1, 2)).toBe(4);      ← fix: toBe(3)
                   10 });
test/decoy.test.ts  import { test } from 'vitest';
                    test('DECOY-COLLECTED', () => {
                      throw new Error('DECOY-COLLECTED: include glob ignored');
                    });
```

Install:

```
$ npm install --prefer-online --no-audit --no-fund
added 44 packages in 14s                                             [exit 0]
$ npm ls vite
└─┬ vitest@4.1.11
  ├─┬ @vitest/mocker@4.1.11
  │ └── vite@8.0.16 deduped
  └── vite@8.0.16 overridden
$ node -e '<TREE_PROBE of the spec>'
VITE-DIRS=["node_modules/vite@8.0.16"]
LOCK-VITE=["node_modules/vite@8.0.16"]
VITEST=4.1.11
WASM32=false        (host picks @rolldown/binding-darwin-arm64; the wasm32 binding is the browser's, scenario line 2)
```

vitest's lock edge is `vite: "^6.0.0 || ^7.0.0 || ^8.0.0"` (the goal's
"`vite ^8` edge" is the `^8` arm of it).

Failing state, `npx vitest run` (non-TTY):

```
 RUN  v4.1.11 /private/tmp/vgoal/u12/oracle-final.ETFh

 ❯ src/sum.test.ts (2 tests | 1 failed) 3ms
   ✓ first sum 1ms
   × second sum 2ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/sum.test.ts > second sum
AssertionError: expected 3 to be 4 // Object.is equality

- Expected
+ Received

- 4
+ 3

 ❯ src/sum.test.ts:9:21
      7|
      8| test('second sum', () => {
      9|   expect(sum(1, 2)).toBe(4);
       |                     ^
     10| });
     11|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
   Start at  15:36:58
   Duration  82ms (transform 10ms, setup 0ms, import 14ms, tests 3ms, environment 0ms)

[exit 1]
```

`--reporter=verbose` (failing) replaces the three module/test lines with:

```
 ✓ src/sum.test.ts > first sum 1ms
 × src/sum.test.ts > second sum 2ms
   → expected 3 to be 4 // Object.is equality
```

Fixed state, `npx vitest run`:

```
 RUN  v4.1.11 /private/tmp/vgoal/u12/oracle-final.ETFh

 ✓ src/sum.test.ts (2 tests) 1ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  15:37:01
   Duration  76ms (transform 10ms, setup 0ms, import 14ms, tests 1ms, environment 0ms)

[exit 0]
```

Fixed `--reporter=verbose`: `✓ src/sum.test.ts > first sum` /
`✓ src/sum.test.ts > second sum` instead of the module line.

Variants, line sets after normalizing durations/timestamps/root (script over
the full transcript; `only-in-variant` / `only-in-default` vs `npx vitest run`
of the same state):

```
fail  | npm test                                   | +['> test', '> vitest run']            | -[]
fail  | --pool=threads                             | +[]                                    | -[]
fail  | --pool=threads --reporter=verbose          | = --reporter=verbose
fail  | (tty) vitest run / --pool=threads          | + transient summary window only ('❯ src/sum.test.ts [queued]', 'Test Files 0 passed (1)', …; erased on screen)
fixed | npm test                                   | +['> test', '> vitest run']            | -[]
fixed | --pool=threads                             | +[]                                    | -[]
fixed | (tty) vitest run / --pool=threads          | + window + ['✓ first sum', '✓ second sum'] (TTY renderSucceed, single file)
exit codes: every fail-state run 1, every fixed-state run 0 (forks default, threads, verbose, npm test, tty)
```

Stable (claimed, I4): the RUN version line, module/test lines above, `FAIL`
header, assertion message + `- Expected`/`+ Received`/`- 4`/`+ 3` diff,
location `src/sum.test.ts:9:21` + code frame, `Test Files`/`Tests` counts,
exit code. Not claimed: durations, `Start at`, `Duration`, the RUN root
path, ANSI, TTY-only transient window and TTY-only per-test lines of a
passing file.

Decoy discriminates `include` (fixed state, config moved away):

```
$ mv vitest.config.ts away; npx vitest run
 ❯ test/decoy.test.ts (1 test | 1 failed) 2ms
   × DECOY-COLLECTED 2ms
 ✓ src/sum.test.ts (2 tests) 1ms
 FAIL  test/decoy.test.ts > DECOY-COLLECTED
Error: DECOY-COLLECTED: include glob ignored
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 2 passed (3)
[exit 1]
```

## Oracle — outside the claim

```
$ npx vitest < /dev/null                     (stdin not a TTY — rifty's shell children today)
 RUN  v4.1.11 …   ✓ src/sum.test.ts (2 tests)   Test Files  1 passed (1)   [exit 0]
$ (pty stdin+stdout) npx vitest              (python pty, 10 s)
 ✓ src/sum.test.ts (2 tests) … PASS  Waiting for file changes...
       press h to show help, press q to quit      [still running after 10 s]
$ npx vitest --watch < /dev/null
 DEV  v4.1.11 … ✓ src/sum.test.ts (2 tests) … PASS  Waiting for file changes...   [still running after 10 s]
$ overrides {"vite":"8.0.15"}; npm install; npx vitest run
 vite@8.0.15 overridden … ✓ src/sum.test.ts (2 tests)  Test Files  1 passed (1)   [exit 0]
```

Same project + `jsdom@30.0.1 happy-dom@20.0.0 @vitest/coverage-v8@4.1.11
@vitest/browser-playwright@4.1.11 playwright@1.60.0` (117 packages):
`--environment=jsdom`, `--environment=happy-dom`, `--pool=vmThreads`,
`--pool=vmForks` → `Test Files  1 passed (1)` `[exit 0]`; `--coverage` →
same + `% Coverage report from v8` `[exit 0]`.

## Static reads — first rifty-relevant API per unclaimed mode

Sources: installed trees above; `npm pack` / registry tarballs of vite
8.0.15, 8.0.16, 8.3.0, 7.3.6 in `/tmp/vgoal/u12/packs`; rifty at `325ae797c`.

| mode | first rifty-relevant API | rifty today | honest named throw without sniffing? |
|---|---|---|---|
| `environment: 'jsdom'` | after `import('jsdom')` (undici guard = map item 5): jsdom `lib/jsdom/browser/Window.js:58` `vm.createContext(vm.constants.DONT_CONTEXTIFY)` (vitest defaults `runScripts: "dangerously"`, `chunks/index.DC7d2Pf8.js:434`) | `vm` exports no `constants` (`builtins/vm/index.ts:427-435`) → bare `TypeError: Cannot read properties of undefined (reading 'DONT_CONTEXTIFY')` | yes — `vm.constants` + `createContext(DONT_CONTEXTIFY)` named `NotImplementedError`; generic `vm` member, no chart item owns it |
| `environment: 'happy-dom'` | `import('happy-dom')` → `window/GlobalWindow.js:22` class field `Function = globalThis.Function` | ESM Function guard `module-loader.esm-global-function-assignment` (`module-loader/esm.ts:81-83`); draft PR #351 observed it after its guard fix | yes — the existing guard, when the key IS `Function` (goal I6) |
| coverage (`@vitest/coverage-v8`) | main + worker `import('@vitest/coverage-v8')` → `dist/index.js:1` `import inspector from 'node:inspector/promises'` | `inspector/promises` unregistered (`builtins/index.ts` registers `inspector` loud proxy only) → `ModuleLoadError: Built-in 'node:inspector/promises' is not implemented` | yes — today |
| browser mode (`@vitest/browser-playwright`) | provider `import('playwright')` (`dist/index.js:880`) → playwright-core `utilsBundle.js` `class … extends http.Agent`, `coreBundle.js` `new HttpsHappyEyeballsAgent({keepAlive:true})` at load | `node:http` has no `Agent` → bare `TypeError: Class extends value undefined …`; `https.Agent` exists and throws `Not implemented: node:https.Agent` (`net/src/https.ts:226`) | yes — a loud `http.Agent` (generic, ADR-0010/0181 shape); no chart item owns it |
| `vmThreads` / `vmForks` | vitest adds `--experimental-vm-modules` to pool `execArgv` (`chunks/cli-api.CnMVyzaz.js:3434,3452`); worker needs `vm.SourceTextModule` (`chunks/vm.CXMd5FHa.js:46`) | Worker: `worker_threads.Worker.execArgv` throw for any execArgv; fork: execArgv dropped silently | yes — map item 11 ("any other flag a named throw") |
| watch (`vitest` without `run`) | `watch: !isCI && process.stdin.isTTY && !isAgent` (`chunks/defaults.9aQKnqFk.js:48`); shortcuts only `if (stdin.isTTY && ctx.config.watch)` (`cli-api.CnMVyzaz.js:14611`) → `readline.emitKeypressEvents` / `stdin.setRawMode` | shell children get `stdinIsTTY: false` (`workbench/src/glue/child-terminal.ts:26`) → bare `vitest` = one run, as Node with non-TTY stdin; `--watch` skips shortcuts, waits on vite's watcher over rifty's polling `fs.watch` (setInterval handle, `builtins/fs-watch.ts:142`) — no ceiling on the path | **no** — only a mode ban; the loud `setRawMode` ceiling is reachable only if the terminal gave children a TTY stdin (terminal work, `terminal/raw-stdin-deferred-items`) |
| other vite versions | npm-client install: lightningcss shadow recipe admits `^1.32.0`; vite install patches are needle-shaped (`tools/shadow-registry/src/runtime/vite-cli-install-policy.ts`) | needles present in 8.0.15, 8.0.16, 8.3.0, 7.3.6 (`cli=1 chok=1 url=1` each); 8.0.x–8.1.x declare `lightningcss ^1.32.0` → install; 8.2.x/8.3.0 declare `^1.33.0` → loud `Not implemented: lightningcss.version` | **no** — 8.0.15 etc. are expected to run (draft PR #351 observed 8.0.15 working); loudness only by version sniffing, which the goal rejects |

## RED — Chromium, this branch (`325ae797c` + spec)

```
$ RIFTY_PLAYGROUND_PORT=5412 pnpm exec playwright test --project=chromium-heavy tests/e2e/vitest-run.spec.ts --workers=1
  ✘ 1 … npm install + vitest run report Node results and exit codes on both pools (9.0s)
  ✘ 2 … unclaimed modes fail loudly with a named ceiling, never a silent pass (18.8s)
  1)  $ npm install
      npm: installing all from package.json…
      npm: + vitest@4.1.11
      npm: + obug@2.2.1
      npm: install failed: Failed to fetch packument 8.0.16: 404
      Expected: 0
      Received: 1
      > 115 |   expect(result.exitCode, result.output).toBe(0);
  2)  (unpinned manifest step passed: exit 1 + `Not implemented: lightningcss.version`)
      $ npm install          ← pinned ceiling manifest
      npm: + vitest@4.1.11 (cached)
      npm: + obug@2.2.1 (cached)
      npm: install failed: Failed to fetch packument 8.0.16: 404
      Expected: 0
      Received: 1
  2 failed
```

Both fail on goal I1 (npm-spelled override parsed as a package name), the
scenario's first wall.

Scratch copy (not committed) with the override respelled `vite@8.0.16`,
same port, `--project=chromium-light`: install, lightningcss line and tree
probe (`VITE-DIRS`/`LOCK-VITE`/`VITEST`/`WASM32=true`) pass; the next wall:

```
  ✘ 1 … (19.4s)
    Error: vitest run
    ⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯
    ModuleLoadError: Built-in 'node:path/posix' is not implemented
    > 194 |       expect(result.exitCode, `${line}\n${result.output}`).toBe(1);
    Expected: 1
    Received: 0
  ✘ 2 … (41.2s)   jsdom/happy-dom/coverage/browser-playwright/playwright installed; then
    Error: vitest run --environment=jsdom
    ModuleLoadError: Built-in 'node:path/posix' is not implemented
    Expected: 1
    Received: 0
```

## Reception r1 — watch / other-versions premise (2026-09-23)

Re-verified for the Contract+RED r1 blocker (goal scenario 5 + I7); host
Node v24.16.0 / npm 11.17.0, public registry, `--prefer-online`:

```
$ npm view vite@<v> dependencies.lightningcss --registry=https://registry.npmjs.org
8.0.15 ^1.32.0 · 8.0.16 ^1.32.0 · 8.1.0 ^1.32.0 · 8.1.5 ^1.32.0      (shadow recipe admits → installs)
8.2.0 ^1.33.0 · 8.2.2 ^1.33.0 · 8.3.0 ^1.33.0                        (→ loud lightningcss.version)
7.3.6 (none)                                                          (installs; rifty's vite-command.md pair)
$ npm view vite dist-tags.latest   → 8.3.0     (a lagging mirror answered 8.2.2)
$ npm view vitest@4.1.11 dependencies.vite   → ^6.0.0 || ^7.0.0 || ^8.0.0
```

rifty at this branch: `packages/workbench/src/glue/child-terminal.ts:26`
`stdinIsTTY: false` (unconditional) → vitest `watch` default off, shortcuts
skipped; `packages/runtime-js/src/builtins/process.ts:322-323`
`setRawMode()` → `throwStdinGap('process.stdin.setRawMode')` (loud, reachable
only with a TTY stdin). Result: no honest named throw on the watch path or on
installable versions; loudness needs a mode/version ban or TTY child stdin.

## RED r2 — after goal amend, rebased on `52e469720` (2026-09-23)

Spec + bare `vitest` step (row 11); `path/posix` and process named-member
units landed on the goal branch since RED r1.

```
$ RIFTY_PLAYGROUND_PORT=5412 pnpm exec playwright test --project=chromium-heavy tests/e2e/vitest-run.spec.ts --workers=1
  ✘ 1 … (6.0s)   $ npm install … npm: install failed: Failed to fetch packument 8.0.16: 404
                 Expected: 0  Received: 1   (spec :115 via :181)
  ✘ 2 … (13.2s)  unpinned step passed; pinned install: same 404 (spec :115 via :242)
  2 failed
```

First failure unchanged: goal I1. Scratch copy (override `vite@8.0.16`,
`--project=chromium-light`, not committed): install + tree probe pass; the
`node:path/posix` wall is gone, the next is

```
  ✘ 1  Error: vitest run
       ⎯⎯⎯ Startup Error ⎯⎯⎯
       NotImplementedError: Not implemented: module-loader.esm-global-function-assignment (ESM module /node_modules/@vitest/utils/dist/timers.js writes the Function binding/global property; …)
       Expected: 1  Received: 0
  ✘ 2  Error: vitest run --environment=jsdom   (same Startup Error, exit 0)
```

→ goal I6 (the ESM `Function` write guard), still a scenario wall; the
Startup Error exiting 0 is the I3/I4 exit-code path.

## IMPLEMENT — on the integrated goal tree (2026-09-25)

`vg/u12` merged `t3code/vitest-run-browser` at `d1a44f616` (all children
landed). RED r3, same command as §RED:

```
  ✓ 1 … npm install + vitest run report Node results and exit codes on both pools (56.2s)
  ✘ 2 … unclaimed modes fail loudly with a named ceiling, never a silent pass (43.3s)
      Expected pattern: /Not implemented: [^\n]*DONT_CONTEXTIFY/u
      Caused by: TypeError: Cannot read properties of undefined (reading 'DONT_CONTEXTIFY')
       ❯ exports.createWindow node_modules/jsdom/lib/jsdom/browser/Window.js:60:44
```

The claimed scenario is green as landed; the first wall is the jsdom ceiling
this unit owns (Decisions 2026-09-23). Browser mode was next behind it
(§Static reads: `http.Agent` absent).

Node oracle for the two members (v24.16.0):

```
$ node -e 'const vm=require("node:vm"); console.log(vm.constants, Object.isFrozen(vm.constants)); …'
[Object: null prototype] {
  USE_MAIN_CONTEXT_DEFAULT_LOADER: Symbol(vm_dynamic_import_main_context_default),
  DONT_CONTEXTIFY: Symbol(vm_context_no_contextify)
} true
descriptor on vm: writable/enumerable/configurable true; Object.keys(vm) includes 'constants'
createContext(DONT_CONTEXTIFY) → object, isContext true, own intrinsics (c.Array !== Array)
createContext(DONT_CONTEXTIFY, {name:1}) → ERR_INVALID_ARG_TYPE The "options.name" property must be of type string. Received type number (1)
$ node -e 'const http=require("node:http"); …'
typeof http.Agent 'function', name 'Agent', length 1, descriptor writable/enumerable/configurable true,
Object.getPrototypeOf(https.Agent) === http.Agent
```

Carriers, RED before the product change (logs in the unit's scratch):

```
$ npx vitest run packages/runtime-js/src/builtins/vm/dont-contextify-ceiling.test.ts packages/net/src/http/agent.test.ts
 FAIL dont-contextify-ceiling.test.ts  TypeError: Cannot destructure property 'DONT_CONTEXTIFY' of 'default.constants' as it is undefined.
 FAIL agent.test.ts (3)                TypeError: http.Agent is undefined
$ pnpm test:parity vm/constants
  ✗ vm/constants.case.ts  error: SyntaxError: The requested module 'node:vm' does not provide an export named 'constants'
$ pnpm test:parity http/agent-shape
  ✗ http/agent-shape.case.ts  error: TypeError: Class extends value undefined is not a constructor or null
```

After (ADR-0464): both unit files pass (3 + 3), both parity cases match,
`pnpm test:parity vm/` and `http/` all match.

`check:esbuild-legacy-retirement` then failed on
`packages/workbench/dist/assets/typescript-worker.js` (same 10 022 694 bytes,
new SHA-256). Rebuilt with the pre-change sources: the pinned
`98a6fa18…` came back; old vs new differ in 39 bytes, all inside the five
renamed chunk import names (`chunk-*.js` ×4, `module-loader-*.js`) — pin
updated to `4d7c0ef3…` only (`traps.md` copied-asset-fingerprints).

## GREEN — Chromium, the claimed scenario and every ceiling (2026-09-25)

```
$ RIFTY_PLAYGROUND_PORT=5412 pnpm exec playwright test --project=chromium-heavy tests/e2e/vitest-run.spec.ts --workers=1
  ✓ 1 … npm install + vitest run report Node results and exit codes on both pools (56.3s)
  ✓ 2 … unclaimed modes fail loudly with a named ceiling, never a silent pass (1.3m)
  2 passed (2.3m)
```

Outputs, from an uncommitted copy of the spec that prints each command's
slice (same seed/commands, `--project=chromium-light`; ANSI stripped,
`Users/…` source frames elided):

```
$ npm install                                   [exit 0]
npm: + vite@8.0.16 … npm: + lightningcss-wasm@1.32.0 …
npm: lightningcss@^1.32.0 → lightningcss-wasm@1.32.0 (substituted from shadow registry, ADR-0051)
npm: installed 48 package(s) in 13.2s
$ vitest run                                    [exit 1]
 RUN  v4.1.11 /
 ❯ src/sum.test.ts (2 tests | 1 failed) 4ms
   ✓ first sum 1ms
   × second sum 3ms
 FAIL  src/sum.test.ts > second sum
AssertionError: expected 3 to be 4 // Object.is equality
- Expected
+ Received
- 4
+ 3
 ❯ src/sum.test.ts:9:21
      9|   expect(sum(1, 2)).toBe(4);
       |                     ^
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
$ npm test                                      [exit 1]   > vitest run + the same block
$ vitest run --pool=threads --reporter=verbose  [exit 1]
 ✓ src/sum.test.ts > first sum 1ms
 × src/sum.test.ts > second sum 3ms
   → expected 3 to be 4 // Object.is equality      (+ the same failure block and counts)
$ vitest run   (fixed)                          [exit 0]
 ✓ src/sum.test.ts (2 tests) 1ms
   ✓ first sum 1ms                                  (TTY stdout: Node's TTY renderSucceed lines, §Oracle)
   ✓ second sum 0ms
 Test Files  1 passed (1)
      Tests  2 passed (2)
$ vitest       (fixed, non-TTY stdin)           [exit 0]   same lines, one run
$ npm install  (unpinned)                       [exit 1]
npm: + vite@8.3.1 …
npm: install failed: Not implemented: lightningcss.version (shadow recipe does not admit ^1.33.0)
$ vitest run --environment=jsdom                [exit 1]
Caused by: NotImplementedError: Not implemented: vm.createContext.DONT_CONTEXTIFY (the vm engines contextify a given object only; handing out a fresh realm's own global is not supported)
 ❯ exports.createWindow node_modules/jsdom/lib/jsdom/browser/Window.js:60:17
$ vitest run --environment=happy-dom            [exit 1]
Caused by: NotImplementedError: Not implemented: module-loader.esm-global-function-assignment (ESM module /node_modules/happy-dom/lib/window/GlobalWindow.js writes the Function binding/global property; …
$ vitest run --coverage                         [exit 1]
ModuleLoadError: Built-in 'node:inspector/promises' is not implemented
$ vitest run --pool=vmThreads                   [exit 1]
Caused by: NotImplementedError: Not implemented: worker_threads.Worker.execArgv (startup option '--experimental-vm-modules' is not carried; …)
[vitest-pool]: Timeout terminating vmThreads worker for test files /src/sum.test.ts.
close timed out after 10000ms
Tests closed successfully but something prevents Vite server from exiting
$ vitest run --pool=vmForks                     [exit 1]
Caused by: NotImplementedError: Not implemented: child_process.fork.execArgv (startup option '--experimental-vm-modules' is not carried; …)
  (same three teardown lines)
$ vitest run   (browser-mode config)            [exit 1]
NotImplementedError: Not implemented: node:https.Agent (TLS termination is not available in the browser — a custom https Agent has no socket pool to manage)
 ❯ new HttpsHappyEyeballsAgent node_modules/playwright-core/lib/coreBundle.js:7935:31
```

Browser mode now reaches playwright-core's first construction
(`coreBundle.js:7945` `new HttpsHappyEyeballsAgent`); the `class extends
http.Agent` declarations before it evaluate as on Node.

Registry drift since PICKUP: `npm view vite dist-tags.latest` → `8.3.1`,
`npm view vite@8.3.1 dependencies.lightningcss` → `^1.33.0` (npm 11.17.0,
public registry) — the page's ⚠️ versions row names 8.2.0 through 8.3.1.

### Observation — teardown after a pool-start ceiling

Node with a pool Worker whose start throws (`test.execArgv: ['--bogus-flag']`,
same project, markers unset, stdin `/dev/null`):

```
$ npx vitest run --config vitest.bogus.config.ts --pool=vmThreads     [exit 1] 10s
Caused by: Error: Initiated Worker with invalid execArgv flags: --bogus-flag
[vitest-pool]: Timeout terminating vmThreads worker for test files …/src/sum.test.ts.
$ … --pool=threads                                                    [exit 1] 10s   (same shape)
```

Node exits when the pool's ref'd terminate timer (`cli-api.CnMVyzaz.js:3550`)
fires; in rifty the process is still alive when vitest's unref'd `exit()`
teardown timer (`:14033-14046`, armed milliseconds later with the same 10 s)
fires and prints `close timed out after 10000ms` / `… prevents Vite server
from exiting`. Exit code and the named ceiling match. Root cause not
diagnosed: a handle the never-closed Vite server holds in rifty, or drain
latency after the last ref'd timer. Unclaimed-mode error path only (claimed
runs close normally) — a deferred discovery, not this unit's result.
