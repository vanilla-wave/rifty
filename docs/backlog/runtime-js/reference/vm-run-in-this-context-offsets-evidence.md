# Evidence — vm-run-in-this-context-offsets (pickup 2026-09-23)

Unit: `docs/backlog/runtime-js/vm-run-in-this-context-offsets.md`. BASE
`325ae797c`. Oracle: host `node --version` → `v24.16.0`,
`node -p process.versions.v8` → `13.6.233.17-node.49`. Platform facts:
Chromium `148.0.7778.96` (Playwright 1.60.0 bundled). Consumers read from the
npm tarballs `npm pack vite@8.0.16 vitest@4.1.11`. Probe scripts lived in
`/tmp/vgoal/u10/probes/` (not committed); each block quotes the decisive code.
`frames` = the `/virtual/…` tokens of the `at …` lines of `err.stack`.

## Correction of goal evidence §Oracle (`vmoff.cjs`)

The goal evidence reads `{lineOffset: 0, columnOffset: -20}` as "column clamps
at 1" and `{lineOffset: 10, columnOffset: 5}` as `12:21` for a function on
physical line 2. Re-run below (P1): no clamp (`:1:-13`), and `columnOffset`
shifts physical line 1 only (line-2 frame `12:16`, line-1 frame `11:12`).
Also: Node 24's default `Error.prepareStackTrace` is a function, not
`undefined` (P2).

## P1 — rendered `.stack` positions (runInThisContext + Script)

```
$ node p1-strings.cjs     # vm.runInThisContext(code, opts); print frames(err.stack)
A 'throw new Error("boom")' {filename:'/virtual/mod.js', lineOffset:0, columnOffset:-20}   → at /virtual/mod.js:1:-13
B 'throw new Error("boom")' {lineOffset:10, columnOffset:5}                               → at /virtual/b.js:11:12
C '\n         throw new Error("boom")' {lineOffset:10, columnOffset:5}                     → at /virtual/c.js:12:16
D 'function f() { throw new Error("x") }\n         f()' {10, 5}                           → at f (/virtual/d.js:11:27) | at /virtual/d.js:12:10
E 'f();\nfunction f() {\n  throw new Error("x") }' {10, 5}                              → at f (/virtual/e.js:13:9) | at /virtual/e.js:11:6
F '\n\nthrow new Error("neg")' {lineOffset:-5}                                             → at /virtual/f.js:-2:7
K new vm.Script('\n  throw …', {lineOffset:4, columnOffset:9}).runInThisContext()         → at /virtual/s.js:6:9
L new vm.Script('throw …', {4, 9}).runInThisContext()                                      → at /virtual/s2.js:5:16
M new vm.Script('throw …', {filename}).runInThisContext({lineOffset:40, columnOffset:40})  → at /virtual/s3.js:1:7   (run options carry no offsets)
N '(function outer() {\n  return function inner() { throw new Error("late") } })' {lineOffset:2, columnOffset:-4}, inner() called from a later timer
                                                                                           → at inner (/virtual/late.js:4:35)
```

Full `err.stack` (P1b): a synchronous throw out of `runInThisContext` carries
Node's displayErrors decoration before the message, its line also shifted:
`"/virtual/mod.js:1\nthrow new Error(\"boom\")\n^\n\nError: boom\n    at /virtual/mod.js:1:-13\n    at Script.runInThisContext (node:vm:137:12)…"`;
`{displayErrors:false}` drops it (`"Error: boom\n    at /virtual/nd.js:4:-13…"`).
SyntaxError `'\n  let let = 1'` `{lineOffset:5, columnOffset:3}` →
`"/virtual/syn.js:7\n  let let = 1\n      ^^^\n\nSyntaxError: let is disallowed as a lexically bound name\n    at new Script (node:vm:117:7)…"`.

## P2 — CallSites seen by a guest hook; Node's default hook

```
$ node p2-callsites.cjs
before               ["function",true,{"writable":true,"enumerable":false,"configurable":true}]   # typeof / 'in' / descriptor (value omitted by JSON)
after-offset-scripts ["function",true,{"writable":true,"enumerable":false,"configurable":true}]
line2  (function top() {\n  return new Error("cs") }) {lineOffset:7, columnOffset:-3}
       → {"file":"/virtual/cs.js","url":"/virtual/cs.js","line":9,"col":10,"eval":false,"fn":"top","top":true,"str":"top (/virtual/cs.js:9:10)","enclosing":[8,null],"pos":27,"ctor":"CallSite"}
line1  (function top1() { return new Error("cs1") }) {7, -3}
       → {"file":"/virtual/cs1.js","line":8,"col":24,"eval":false,"str":"top1 (/virtual/cs1.js:8:24)","enclosing":[8,null],"pos":26}
after-reset  (Error.prepareStackTrace = undefined) ["undefined",true,{…data…}] ; after-delete ["undefined",false,null]
captureStackTrace  'var o = {}; Error.captureStackTrace(o); o' {1, 100}  → at /virtual/cap.js:2:119
same-file  a {filename:'/virtual/same.js', lineOffset:100} → 101:21 ; b {same file, 200, 50} → 201:71 ; a again → 101:21
eval-carrier  (0,eval)('(function evtop() {…})\n//# sourceURL=/virtual/ev.js')  → {"url":"/virtual/ev.js","line":2,"col":10,"eval":true,"fn":"evtop","origin":"/virtual/ev.js","str":"evtop (/virtual/ev.js:2:10)"}   (getFileName undefined)
$ node -e "const p=Error.prepareStackTrace; console.log(typeof p, p.name, p.length, String(p))"
function ErrorPrepareStackTrace 2 function ErrorPrepareStackTrace(error, trace) { return internalPrepareStackTrace(error, trace); }
$ node -e "…new Worker(…typeof Error.prepareStackTrace…)" → worker function ; vm.runInNewContext('typeof Error.prepareStackTrace') → undefined
$ node --expose-internals -p "String(require('internal/errors').defaultPrepareStackTrace)"
function defaultPrepareStackTrace(error, trace) { … errorString = kIsNodeError in error ? `${error.name} [${error.code}]: ${error.message}` : ErrorPrototypeToString(error);
  if (trace.length === 0) return errorString; return `${errorString}\n    at ${ArrayPrototypeJoin(trace, '\n    at ')}`; }
$ node --expose-internals -p "String(require('internal/errors').prepareStackTraceCallback)"
… if (typeof globalThis.Error?.prepareStackTrace === 'function') return globalThis.Error.prepareStackTrace(error, trace); … return internalPrepareStackTrace(error, trace);
$ node -e "e=new Error('x'); Object.defineProperty(e,'name',{get(){throw new Error('bad-name')}}); e.stack" → THROWS bad-name (default hook throws too)
```

## P3 / P8 — validation (`validateInt32`)

```
$ node p3-validation.cjs ; node p7-misc.cjs ; node p8-sandbox-validation.cjs
lineOffset '1'        TypeError ERR_INVALID_ARG_TYPE The "options.lineOffset" property must be of type number. Received type string ('1')
lineOffset 1.5        RangeError ERR_OUT_OF_RANGE The value of "options.lineOffset" is out of range. It must be an integer. Received 1.5
lineOffset NaN / Infinity   … It must be an integer. Received NaN / Received Infinity
lineOffset 2**31      … It must be >= -2147483648 && <= 2147483647. Received 2147483648
lineOffset 2**33      … It must be >= -2147483648 && <= 2147483647. Received 8_589_934_592   (-(2**33) → -8_589_934_592)
lineOffset null / true / 10n   … Received null / Received type boolean (true) / Received type bigint (10n)
lineOffset -1, ±int32 bounds, -0, undefined   ok
columnOffset: same messages with "options.columnOffset"
order: {filename:1, lineOffset:'x'} → options.filename first; {lineOffset:'x', columnOffset:'y'} → options.lineOffset; {columnOffset:'y', cachedData:1} → options.columnOffset
new vm.Script('1', {lineOffset:'1'}) / {columnOffset:1.5} → same errors
vm.runInContext('1', ctx, {lineOffset:'1'}) → ERR_INVALID_ARG_TYPE …lineOffset… ; vm.runInNewContext('1', {}, {columnOffset:1.5}) → ERR_OUT_OF_RANGE …columnOffset… It must be an integer. Received 1.5
vm.compileFunction('return 1', [], {columnOffset:1.5}) → ERR_OUT_OF_RANGE (same) ; {lineOffset:'1'} → ERR_INVALID_ARG_TYPE (same)
```

## P9 — validation order per entry point (IMPLEMENT, 2026-09-23)

```
$ node order.cjs      # node v24.16.0; t(label, fn) prints name/code/message or ok
compileFunction both  {lineOffset:'x', columnOffset:'y'} → TypeError ERR_INVALID_ARG_TYPE The "options.columnOffset" property must be of type number. Received type string ('y')
runInContext both / runInNewContext both                 → … "options.lineOffset" … Received type string ('x')
runInContext('1', {}, {lineOffset:'x'})                  → The "contextifiedObject" argument must be an vm.Context. Received an instance of Object
new vm.Script('1').runInThisContext({lineOffset:'x'}) / ({cachedData:5}) → ok (run options carry neither)
$ node runopts.cjs   # run options {lineOffset:'x', columnOffset:1.5, cachedData:5, produceCachedData:'y', importModuleDynamically:7, filename:9}
Script#runInThisContext / #runInContext / #runInNewContext → ok 42 (all ignored)
lineOffset 1e21 → … Received 1e_+21 ; 2**32+1 → Received 4_294_967_297 ; 2**32 → Received 4294967296 ; -Infinity → It must be an integer. Received -Infinity
lineOffset {} → Received an instance of Object ; Symbol('s') → Received type symbol (Symbol(s)) ; function foo(){} → Received function foo ; "it's" → Received type string ("it's")
{displayErrors:'x', lineOffset:'x'} → options.lineOffset first ; {filename:1} → The "options.filename" property must be of type string. Received type number (1)
filename '' with {lineOffset:3, columnOffset:2} → at <anonymous>:4:9 ; CallSite getScriptNameOrSourceURL '' ; toString "<anonymous>:4:9"
```

## P4–P6 — non-positive shifted positions

```
$ node p4-enclosing.cjs ; node p5-colnull.cjs ; node p6-negline.cjs    # hook maps CallSites to [line, col, encLine, encCol, String(site)]
'(function top() { return new Error("e") })' (`new` at col 26, `function` at col 2):
  columnOffset -24 → [1,2]  "top (/virtual/c.js:1:2)" ; -25 → [1,1] "…:1:1" ; -26 → [1,null] "top (/virtual/c.js:1)" ; -27 → [1,null] "…:1:-1" ; -30 → [1,null] "…:1:-4"
  enclosing column: co 0 → 2 ; -1 → 1 ; -2 → null ; -3 → null
'\n(function top() {\n return new Error("e") })' (throw on physical line 3):
  lineOffset -1 → 2:9 ; -2 → 1:9 ; -3 → [null, 9] "top (/virtual/l.js)" ; -4 → [null,9,null,2] "…:-1:9" ; -5 → "…:-2:9"
line 1 with {lineOffset:-1, columnOffset:-50} → [null,null,null,null] "top (/virtual/n1.js)" ; {lineOffset:-3, columnOffset:4} → [null,30,null,6] "…:-2:30"
default rendering (hook unset): co -26 → "at top (/virtual/s.js:1)" ; co -27 → "…:1:-1" ; lo -3 → "at top (/virtual/sl.js)"
```

Rule: line' = line + lineOffset; column' = column + (physical line 1 ?
columnOffset : 0); enclosing positions likewise. Getters return null for a
value ≤ 0. `toString`/default rendering: line' 0 → no `:line:col`; else
`:line'` then column' 0 → omitted, negatives printed.

## P7 — default filename, sandbox entry points, execution

```
$ node p7-misc.cjs
runInThisContext('\n  throw new Error("d")', {lineOffset:5, columnOffset:3})  → at evalmachine.<anonymous>:7:9
new vm.Script('throw new Error("d")', {5, 3}).runInThisContext()                → at evalmachine.<anonymous>:6:10
runInContext('throw …', ctx, {filename:'/virtual/ctx.js', lineOffset:3, columnOffset:2}) → at /virtual/ctx.js:4:9 ; Script#runInNewContext same → 4:9 ; compileFunction same → at /virtual/cf.js:4:9
exec: runInThisContext('var __vmOffVar = 7; this === globalThis && __vmOffVar * 6', {…, 3, -9}) → 42, globalThis.__vmOffVar 7
```

## Parity case outputs (Node v24.16.0)

`node main.js` in a temp dir with each case's `code` (the runner's Node side),
2026-09-23. `vm/run-in-this-context-offsets` (validation block elided to its
first rows; full text is the case output):

```
line1-negative-column /virtual/mod.js:1:-13
line1-positive /virtual/b.js:11:12
line2-positive /virtual/c.js:12:16
fn-line1-called-line2 /virtual/d.js:11:27 | /virtual/d.js:12:10
fn-line3-called-line1 /virtual/e.js:13:9 | /virtual/e.js:11:6
lineOffset-only /virtual/i.js:4:9
columnOffset-only /virtual/j.js:1:16
negative-line /virtual/f.js:-2:7
zero-line /virtual/zl.js | /virtual/zl.js
zero-column /virtual/zc.js:1 | /virtual/zc.js:1:17
Script-line2 /virtual/s.js:6:9
Script-line1 /virtual/s2.js:5:16
Script-run-options-ignored /virtual/s3.js:1:7
Script-reused /virtual/reused.js:7:31 || /virtual/reused.js:7:31
per-script /virtual/same.js:101:24 || /virtual/same.js:201:74 || /virtual/same.js:1:24 || /virtual/same.js:101:24
captureStackTrace /virtual/cap.js:2:136 | /virtual/cap.js:2:169
default-filename evalmachine.<anonymous>:7:9
exec 42 7
validate lineOffset string runInThisContext TypeError ERR_INVALID_ARG_TYPE The "options.lineOffset" property must be of type number. Received type string ('1')
…
validate int32 bounds runInThisContext ok
validate negative zero Script ok
deferred-line2 /virtual/late.js:4:35
deferred-line1 /virtual/late1.js:3:51
```

`vm/run-in-this-context-offsets-callsites`:

```
vite-hook line1 one => /virtual/my project/src/sum.test.ts,1,28,1,1,atLine1 [atLine1 (/virtual/my project/src/sum.test.ts:1:28)]
vite-hook line3 three => /virtual/my project/src/sum.test.ts,3,9,2,32,atLine2 [atLine2 (/virtual/my project/src/sum.test.ts:3:9)]
callsites-pattern /virtual/my project/src/sum.test.ts,4,56,4,30,sites
late-hook 1:28
restored typeof function
restored default line1 /virtual/my project/src/sum.test.ts:1:28
restored default line3 /virtual/my project/src/sum.test.ts:3:9
boundary col1 /virtual/bound.js,1,1,1,null,top
boundary line0-col0 /virtual/bound.js,null,null,null,null,top
boundary negative-line /virtual/bound.js,null,9,null,2,top
```

`vm/run-in-this-context-offsets-async` (added at IMPLEMENT; `node run-case-node.mjs`, v24.16.0):

```
async-default at inner (/virtual/async.js:13:46) | at async outer (/virtual/async.js:12:15)
async-line1 at inner1 (/virtual/async1.js:4:90) | at async outer1 (/virtual/async1.js:4:30)
async-hook false,inner2,13,47,inner2 (/virtual/async2.js:13:47) | true,outer2,12,15,async outer2 (/virtual/async2.js:12:15)
```

## Consumers on the claimed path

- vitest 4.1.11 `dist/module-evaluator.js:192-206`: `codeDefinition =
  'use strict';async (${argumentsList.join(",")})=>{{`; `vm.runInThisContext(
  codeDefinition + code + '\n}}', {filename: module.id, lineOffset: 0,
  columnOffset: -codeDefinition.length})`, then awaits the returned function
  (`this.vm` → `vm.runInContext` only for the vm pools).
  `dist/chunks/base.B6Opl8PE.js:151-154`: `runInThisContext('(() =>{\n' +
  serializedDefines + '})()', {lineOffset: 1, filename: 'virtual:load-defines.js'})`.
- vitest 4.1.11 `chunks/startVitestModuleRunner.DB-7oCpn.js:490`,
  `chunks/init.k9zZ9sLh.js:29`: `sourcemapInterceptor: "prepareStackTrace"`.
- vite 8.0.16 `dist/node/module-runner.js:824` `const originalPrepare =
  Error.prepareStackTrace`; `:829` `interceptStackTrace` assigns
  `Error.prepareStackTrace = prepareStackTrace`; `:826` reset assigns
  `originalPrepare` back; `:940-951` `cloneCallSite` copies
  `Object.getOwnPropertyNames(Object.getPrototypeOf(frame))`, calling
  `frame[name].call(frame)`; `:954` `source = frame.getFileName() ||
  frame.getScriptNameOrSourceURL()`, then `getLineNumber()` /
  `getColumnNumber()` feed its source-map lookup; `:982` renders frames itself.

## Chromium platform facts (disposable spikes, not committed)

`node chromium-probe.cjs` (page) and `chromium-probe2.cjs` (module Worker served
from a routed origin), Chromium 148.0.7778.96:

```
typeof Error.prepareStackTrace → "undefined", own property → false            (page and module worker)
CallSite.prototype own names → constructor,getColumnNumber,getEnclosingColumnNumber,getEnclosingLineNumber,getEvalOrigin,getFileName,getFunction,getFunctionName,getLineNumber,getMethodName,getPosition,getPromiseIndex,getScriptNameOrSourceURL,getScriptHash,getThis,getTypeName,isAsync,isConstructor,isEval,isNative,isPromiseAll,isToplevel,toString
descriptor getLineNumber / getColumnNumber / toString / getScriptNameOrSourceURL → writable false, enumerable false, configurable false
proto.getLineNumber = … → TypeError: Cannot assign to read only property 'getLineNumber' ; defineProperty → TypeError: Cannot redefine property: getLineNumber
accessor Error.prepareStackTrace {get} → honoured: new Error().stack, Error.captureStackTrace(o), null.x TypeError → "HOOKED 1"; getter called once per format; receiver === Error
error formatted inside a hook → internal default ("OUTER[Error: inner]")
JS default (Error.prototype.toString header + '\n    at ' + trace.join) vs V8 internal: identical for TypeError(null.x), TypeError(''), name '', name+message '', class ctor frame, captureStackTrace on {} and {name,message}, Array.map frame, multi-line message, async frames; differs only for a throwing `name` getter (internal "<error: Error: bad-name>", JS throws — Node 24 throws too, P2)
(0,eval)(src + '\n//# sourceURL=/virtual/ev.js') CallSite → getFileName undefined, getScriptNameOrSourceURL "/virtual/ev.js", line 2 col 10, isEval true, getEvalOrigin "/virtual/ev.js", toString "evtop (/virtual/ev.js:2:10)"
sourceURL "/virtual/my file.js" (space) → ignored: "eval (eval at probe (…), <anonymous>:1:21)"
sourceURL "rifty-vm://0/-5/%2Fvirtual%2Fmy%20file.js" → kept verbatim by getScriptNameOrSourceURL / getEvalOrigin / toString
Proxy over a CallSite (get trap binds natives to the target): vite-style clone works, Object.getPrototypeOf(proxy) === CallSite.prototype
```

## Rifty baseline (BASE `325ae797c`, Node host)

```
$ npx tsx rifty-baseline.ts      # imports packages/runtime-js/src/builtins/vm/index.ts
lineOffset:   NotImplementedError Not implemented: vm.runInThisContext.lineOffset
columnOffset: NotImplementedError Not implemented: vm.runInThisContext.columnOffset
Script lineOffset: NotImplementedError Not implemented: vm.Script.lineOffset
zero-offset top-level frame: at eval (/virtual/top.js:1:7) | first stack line: "Error: top"          (Node: at /virtual/top.js:1:7 | "/virtual/top.js:1")
zero-offset CallSite: {"file":"undefined","url":"/virtual/cs.js","isEval":true,"origin":"/virtual/cs.js"}   (Node: file "/virtual/cs.js", isEval false, origin undefined)
filename with space: at g (eval at <anonymous> (eval at <anonymous> (…/vm/index.ts:2:1826)), <anonymous>:1:23)   (Node: at g (/virtual/my file.js:1:23))
```

## RED runs (BASE + contract commit)

```
$ pnpm test:parity run-in-this-context-offsets
  ✗ vm/run-in-this-context-offsets-callsites.case.ts   error: NotImplementedError: Not implemented: vm.runInThisContext.columnOffset
  ✗ vm/run-in-this-context-offsets.case.ts             error: NotImplementedError: Not implemented: vm.Script.lineOffset
2 case(s) failed
$ npx vitest run packages/runtime-js/src/builtins/vm/script-offsets.test.ts packages/runtime-js/src/builtins/vm/script-offsets-stack-hook.fault.test.ts
  × a Script built with offsets runs in this context and stays loud in a sandbox   → Not implemented: vm.Script.lineOffset
  × invalid offsets fail Node's validation before any gap                         → expected [ 'NotImplementedError', …(2) ] to deeply equal [ 'TypeError', …(2) ]
  × source-map windows opened after an offset script …                            → Not implemented: vm.runInThisContext.lineOffset
  × an offset script first evaluated inside a source-map window …                 → Not implemented: vm.runInThisContext.lineOffset
  × a formatter that bypasses the hook …                                          → Not implemented: vm.runInThisContext.lineOffset
  (2 passing guards: sandbox gaps named for valid offsets; zero offsets work)
$ RIFTY_PLAYGROUND_PORT=5410 npx playwright test --config playwright.browser-unit.config.ts tests/browser-unit/vm-script-offsets.spec.ts
  ✘ vm/run-in-this-context-offsets: Chromium worker realm matches Node            → expect(run.error).toBeUndefined() Received "NotImplementedError: Not implemented: vm.Script.lineOffset"
  ✘ vm/run-in-this-context-offsets-callsites: Chromium worker realm matches Node  → Received "NotImplementedError: Not implemented: vm.runInThisContext.columnOffset"
  (baseline precondition {type:'undefined', own:false} passed; Node side produced output)
```

Fixture check (scratch copy of the fault test with `(0, eval)` in place of the
offset script, not committed): the ADR-0136 remap rows hold today
(`/work/a.ts:3:1`, `/work/b.ts:3:1`); only the offset frames read `missing`.

## Discovered outside this promise (pre-existing, for routing)

Verified above; not caused or changed by offsets:

1. Host-realm `runInThisContext`/`Script` frames are eval frames: top level
   renders `at eval (file:l:c)` (Node `at file:l:c`), CallSite `isEval()`
   true, `getFileName()` undefined, `getEvalOrigin()` = filename,
   top-level `getFunctionName()` `eval` (Node: false / filename / undefined / null).
2. Node's default `displayErrors` decoration (`file:line`, source line,
   caret, blank line before the message) is absent on errors thrown
   synchronously out of `runInThisContext`/`Script`; only an explicit
   `displayErrors` option is a loud gap today.
3. Zero-offset path: a filename that is not a valid `sourceURL` value
   (whitespace, quotes) loses the filename (`<anonymous>` frames).
4. Realm default `Error.prepareStackTrace` is Chromium's `undefined`; Node 24
   ships `ErrorPrepareStackTrace` (data property, writable, non-enumerable,
   configurable) in every main/worker realm.

## IMPLEMENT probes (2026-09-23)

Node v24.16.0 (`misc.cjs`) vs rifty after ADR-0450 (`npx tsx rifty-probe.ts`,
Node host, imports `packages/runtime-js/src/builtins/vm/index.ts`):

```
nested eval   Node  at eval (eval at g (/virtual/nested.js:1:24), <anonymous>:1:1) | at g (/virtual/nested.js:6:27)
              rifty at eval (eval at g (rifty-vm://5/3/%2Fvirtual%2Fnested.js), <anonymous>:1:1) | at g (/virtual/nested.js:6:27)
new Function  Node  at eval (eval at h (/virtual/nf.js:1:24), <anonymous>:3:8) ; rifty … eval at h (rifty-vm://5/3/%2Fvirtual%2Fnf.js) …
format inside a hook  Node  outer:at inner (/virtual/in.js:6:31) (V8 internal formatting keeps origin offsets) ; rifty: encoded identity (fault test row)
empty filename + offsets  rifty at eval (<anonymous>:4:9) (Node at <anonymous>:4:9)
no filename + offsets     rifty at eval (evalmachine.<anonymous>:4:9) ; zero offsets, no filename: rifty `eval at <anonymous> (…vm/index.ts…)` (Node evalmachine.<anonymous>:1:7)
zero offsets, filename 'rifty-vm://5/5/x'  rifty at eval (rifty-vm://5/5/x:1:7) (encoded, never read back as offsets)
filename "/virtual/my 'q' (x) ü 😀.js" + lineOffset 1 → rifty at eval (/virtual/my 'q' (x) ü 😀.js:2:7)
descriptor after an offset script {get, set, enumerable:false, configurable:true} ; assign fn → read back !== fn (wrapper "prepareStackTrace") ; assign 5 → read back ErrorPrepareStackTrace
```

Browser-unit oracle harness: Playwright 1.60.0 `WorkerHost` spawns workers
with `FORCE_COLOR: "1"` (`playwright/lib/runner/index.js:4999`); `runInNode`
inherited it, so the Node side printed `exec \x1b[33m42\x1b[39m \x1b[33m7\x1b[39m`
against rifty's `exec 42 7`. The oracle child now drops `FORCE_COLOR`
(`run-in-node.test.ts` RED: received `\x1b[33m42\x1b[39m x`).
