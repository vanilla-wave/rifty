# Path subpath registration — 2026-09-23

Authority: goal I6, map item 2 (existing namespaces); original observed
`@vitest/mocker` import failure in `vitest-run-in-browser-evidence.md`.

## Real Node baseline

Node v24.16.0, `node --input-type=module`:

```js
import path from 'node:path';
import posix, { join } from 'node:path/posix';
import win32 from 'node:path/win32';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
console.log(process.version);
console.log(JSON.stringify({
  posixIdentity: posix === path.posix,
  cjsPosixIdentity: require('path/posix') === path.posix,
  namedJoin: join('a', 'b'),
  win32Identity: win32 === path.win32,
  cjsWin32Identity: require('path/win32') === path.win32,
  win32Join: win32.join('a', 'b'),
  posixJoin: posix.join('a', 'b'),
  sameFlavour: win32 === posix,
}));
```

```text
v24.16.0
{"posixIdentity":true,"cjsPosixIdentity":true,"namedJoin":"a/b","win32Identity":true,"cjsWin32Identity":true,"win32Join":"a\\b","posixJoin":"a/b","sameFlavour":false}
```

Rifty `path.ts` already exports `win32 = posix`. That pre-existing
Windows-semantics defect remains explicit: registration identity parity
does not prove Windows path operation parity.

## RED

`node --import tsx tools/node-parity-runner/src/cli.ts path/subpaths`:

```text
path/subpaths-cjs.case.ts: Cannot find module 'path/posix'
path/subpaths-esm.case.ts: Built-in 'node:path/posix' is not implemented
2 case(s) failed
```

`pnpm test:run packages/runtime-js/src/module-loader/path-subpaths.test.ts`:
2 failed; both `path/posix` and `path/win32` report `Cannot find module`.

`pnpm test:parity path/subpaths` itself hit sandbox EPERM opening tsx's IPC
pipe; the equivalent `node --import tsx ...` ran both cases normally.

## Root / class sweep

`builtins/index.ts` registered only `path`. Registry canonicalizes `node:`
at its existing chokepoint; both missing names are siblings at this owner.
Axis: `sibling-drift`, owned in-process policy/graph projection boundary.
Existing subpath registrations: `util/types`, `assert/strict`,
`timers/promises`, `fs/promises`, `stream/promises`, `stream/consumers`,
`stream/web`, `dns/promises`. No transport/state mechanism changes.
Transport loss/duplication/reordering physically excluded by that boundary.

## GREEN / discrimination

- `node --import tsx tools/node-parity-runner/src/cli.ts /path/` — 7/7 match,
  including both new CJS/ESM subpath cases.
- `pnpm test:run packages/runtime-js/src/module-loader/path-subpaths.test.ts
  packages/runtime-js/src/module-loader/builtin-overrides.test.ts` — 3/3 pass.
- Revert-check each registration independently: remove its one registry line,
  run `pnpm test:run packages/runtime-js/src/module-loader/path-subpaths.test.ts
  -t 'loads the existing posix'` (then `win32`); each fails `Cannot find module`
  for its subpath. Both lines restored afterward.
- `pnpm backlog:check` — pass.
- `pnpm exec biome check --write` on the three new test/case files — pass.

Independent Final+GREEN and whole-unit gates remain with the goal driver.
