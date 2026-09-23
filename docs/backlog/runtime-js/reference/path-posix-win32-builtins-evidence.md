# Evidence — runtime-js/path-posix-win32-builtins (pickup 2026-09-23)

Oracle: host Node v24.16.0, npm 11.17.0 (`node --version`, `npm --version`).
Rifty baseline: branch `t3code/vitest-run-browser` @ `325ae797c`. Probe
scripts lived in `/tmp/vgoal/u2/oracle` (not committed); sources quoted.

## Oracle — `node:path/posix` (Node v24.16.0)

`esm.mjs`:

```js
import { join } from 'node:path/posix';
import posixDefault, * as posixNs from 'node:path/posix';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
console.log('join', join('a', 'b'), join('/x/', '../y', 'z.js'));
console.log('default === path.posix', posixDefault === path.posix);
console.log('ns.default === path.posix', posixNs.default === path.posix);
console.log('ns.join === path.posix.join', posixNs.join === path.posix.join);
const dyn = await import('node:path/posix');
console.log('dynamic default === path.posix', dyn.default === path.posix, dyn.join === join);
console.log('require node:path/posix === path.posix', require('node:path/posix') === path.posix);
console.log('require path/posix === path.posix', require('path/posix') === path.posix);
const mod = require('node:module');
console.log('isBuiltin', mod.isBuiltin('node:path/posix'), mod.isBuiltin('path/posix'));
console.log('builtinModules has path/posix', mod.builtinModules.includes('path/posix'));
```

```
$ node esm.mjs
join a/b /y/z.js
default === path.posix true
ns.default === path.posix true
ns.join === path.posix.join true
dynamic default === path.posix true true
require node:path/posix === path.posix true
require path/posix === path.posix true
isBuiltin true true
builtinModules has path/posix true
exit=0
```

`cjs.cjs` (plain CJS `require`, both spellings):

```
$ node cjs.cjs
node:path/posix === path.posix true
path/posix === node:path/posix true
join a/b /a/c/
require.resolve node:path/posix path/posix
exit=0
```

ESM namespace keys (`import * as ns from 'node:path/posix'; Object.keys(ns)`):

```
_makeLong,basename,default,delimiter,dirname,extname,format,isAbsolute,join,matchesGlob,normalize,parse,posix,relative,resolve,sep,toNamespacedPath,win32
```

## Oracle — `path.win32` / `node:path/win32` (Node v24.16.0)

`win32.cjs`:

```
$ node win32.cjs
win32 === posix false
win32.sep "\\" delimiter ";"
win32.join "a\\b"
win32.basename "Code.exe"            # input 'C:\\Program Files\\Code\\Code.exe'
path/win32 === path.win32 true
posix.posix === posix true posix.win32 === win32 true
path === path.posix true
matchesGlob function _makeLong function
exit=0
```

## Rifty baseline @ 325ae797c (in-process loader, `createModuleLoader(MemoryFsSync)`)

Scratch tsx script (deleted), CJS `/app/main.js` probing each line in try/catch:

```
win32 === posix true
win32.sep "/"
win32.join "a/b"
require node:path/win32 threw ModuleLoadError MODULE_NOT_FOUND "Built-in 'node:path/win32' is not implemented"
require path/win32 threw Error MODULE_NOT_FOUND "Cannot find module 'path/win32'\nRequire stack:\n- /app/main.js"
require node:path/posix threw ModuleLoadError MODULE_NOT_FOUND "Built-in 'node:path/posix' is not implemented"
posix.posix undefined
isBuiltin node:path/win32 false
```

So `path.win32` silently answers with POSIX semantics (pre-existing,
`path.ts` "We don't ship `win32`"); `node:path/win32` is a loud loader miss.

## Claimed tree scan (vitest 4.1.11 + vite 8.0.16, real npm 11.17.0)

```
$ cat package.json
{"name":"probe","private":true,"type":"module","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"4.1.11"},"overrides":{"vite":"8.0.16"}}
$ npm install --no-audit --no-fund      → added 44 packages in 5s
$ node -p "…vite…+…vitest… version"      → 8.0.16 4.1.11   (rolldown 1.0.3)
$ grep -rn --include='*.js' --include='*.mjs' --include='*.cjs' -E "['\"](node:)?path/(posix|win32)['\"]" node_modules
node_modules/@vitest/mocker/dist/redirect.js:50:	"path/posix",
node_modules/@vitest/mocker/dist/redirect.js:51:	"path/win32",
node_modules/@vitest/mocker/dist/node.js:7:import { join } from 'node:path/posix';
$ grep -rn … -E "\.win32\b" node_modules
node_modules/rolldown/dist/shared/binding-CXquf8ay.mjs:128…171:  __require("./rolldown-binding.win32-*.node")   (file names)
node_modules/vite/dist/node/chunks/node.js:10232:  path$9.win32.basename(fullProcessPath)
node_modules/pathe/dist/index.cjs:39:exports.win32 = win32;                        (pathe's own impl)
```

- `redirect.js:50-51` are strings in a `Set` for `isNodeBuiltin` (no import;
  `module.isBuiltin` wins when present, `redirect.js:70`).
- vite `node.js:10232` sits in `getEditorFromWindowsProcesses`, called only
  under `process.platform === "win32"` (`node.js:10255`, launch-editor) —
  unreachable on rifty (`linux`) and not on `vitest run`.
- The only claimed-path consumer is `@vitest/mocker/dist/node.js:7`.

## RED @ 325ae797c (carriers committed with the contract)

```
$ pnpm -s test:parity posix-subpath
node-parity-runner: 2 case(s) matching 'posix-subpath'
  ✗ path/posix-subpath-import.case.ts
    error: ModuleLoadError: Built-in 'node:path/posix' is not implemented
  ✗ path/posix-subpath-require.case.ts
    diff (- node / + rifty):
      - node:path/posix true
      + node:path/posix threw MODULE_NOT_FOUND
      - path/posix true
      + path/posix threw MODULE_NOT_FOUND
      - join a/b
      + join threw MODULE_NOT_FOUND
      - isBuiltin true true
      + isBuiltin false false
      - builtinModules true
      + builtinModules false
2 case(s) failed
```

Same case code run directly under Node v24.16.0 (dumped from the case files):

```
== import                         == require
join a/b /y/z.js                  node:path/posix true
default true                      path/posix true
namespace true true               join a/b
dynamic true true                 isBuiltin true true
                                  builtinModules true
```

Discrimination probes (temporary one-line edits of `builtins/index.ts`,
reverted; not implementation):

```
registerBuiltin('path/posix', () => pathModule)                → ✗ both: default/namespace/dynamic false; require identity false
registerBuiltin('path/posix', () => ({ ...pathModule.posix })) → ✗ both: same identity lines false
registerBuiltin('path/posix', () => pathModule.posix)          → ✓ both ("all cases match")
```

Ceiling pin `tests/conformance/builtins/path.test.ts` ("node:path/win32
ceiling"): passes @ 325ae797c; with `registerBuiltin('path/win32', () =>
pathModule.win32)` added → `AssertionError: expected function to throw an
error, but it didn't`.

## GREEN (implementation: `registerBuiltin('path/posix', () => pathModule.posix)`)

```
$ pnpm -s test:parity posix-subpath
node-parity-runner: 2 case(s) matching 'posix-subpath'
  ✓ path/posix-subpath-import.case.ts
  ✓ path/posix-subpath-require.case.ts
all cases match
```

Surrounding divergences (Out of scope), Node v24.16.0 `ceiling.cjs`:

```js
const path = require('path');
const mod = require('node:module');
console.log('require(path/posix) === require(path)', require('path/posix') === require('path'));
const x = require('node:path/posix');
console.log('posix members', JSON.stringify([typeof x.posix, typeof x.win32, typeof x.matchesGlob, typeof x._makeLong]));
console.log('isBuiltin path/win32', mod.isBuiltin('path/win32'), mod.isBuiltin('node:path/win32'));
console.log('builtinModules path/win32', mod.builtinModules.includes('path/win32'));
console.log('require path/win32 === path.win32', require('path/win32') === path.win32);
```

```
$ node --version && node ceiling.cjs
v24.16.0
require(path/posix) === require(path) true
posix members ["object","object","function","function"]
isBuiltin path/win32 true true
builtinModules path/win32 true
require path/win32 === path.win32 true
```

Rifty after the registration (scratch vitest probe, deleted;
`createModuleLoader(MemoryFsSync)`, same probes in try/catch):

```
path === path.posix false
require(path/posix) === require(path) false
posix members ["undefined","undefined","undefined","undefined"]
require path/win32 threw Error MODULE_NOT_FOUND "Cannot find module 'path/win32'\nRequire stack:\n- /app/main.js"
require node:path/win32 threw ModuleLoadError MODULE_NOT_FOUND "Built-in 'node:path/win32' is not implemented"
isBuiltin path/win32 [false,false]
builtinModules path/win32 false
win32 === posix true
named matchesGlob threw SyntaxError "The requested module 'node:path/posix' does not provide an export named 'matchesGlob' (imported by /app/named.mjs)"
ns keys basename,default,delimiter,dirname,extname,format,isAbsolute,join,normalize,parse,relative,resolve,sep,toNamespacedPath
```
