# Evidence — process-lifecycle-events-exit-code (vitest-run-in-browser item 7, I3)

Oracle: host Node v24.16.0 (npm 11.17.0), macOS arm64, 2026-09-23. Rifty
baseline: BASE `92215e3b4f94bd20801f5d57b5e109e83f809d48` (branch `vg/u7`).
Prior draft PRs #349/#351/#352 were read as evidence only; every fact below
was re-run here.


## §N Node v24.16.0 mechanism (source)

```
$ node -e "const s=process.binding('natives')['internal/process/per_thread']; const i=s.indexOf('function exit('); console.log(s.slice(i, i+420))"
function exit(code) {
    if (arguments.length !== 0) {
      process.exitCode = code;
    }

    if (!process._exiting) {
      process._exiting = true;
      process.emit('exit', process.exitCode || kNoFailure);
    }
    // FIXME(joyeecheung): ...
    process.reallyExit(process.exitCode || kNoFailure);
$ node -e "const s=process.binding('natives')['internal/process/execution']; const i=s.indexOf('function createOnGlobalUncaughtException'); console.log(s.slice(i, i+1100))"
  return (er, fromPromise) => {
    clearDefaultTriggerAsyncId();
    const type = fromPromise ? 'unhandledRejection' : 'uncaughtException';
    process.emit('uncaughtExceptionMonitor', er, type);
    if (exceptionHandlerState.captureFn !== null) {
      exceptionHandlerState.captureFn(er);
    } else if (!process.emit('uncaughtException', er, type)) {
      try {
        if (!process._exiting) {
          process._exiting = true;
          process.exitCode = kGenericUserError;
          process.emit('exit', kGenericUserError);
        }
      } catch {
        // Nothing to be done about it at this point.
      }
      return false;
    }
$ node -e "const s=process.binding('natives')['internal/process/promises']; …"   # isErrorLike, throwUnhandledRejectionsMode, UnhandledPromiseRejection
function isErrorLike(obj) {
  return typeof obj === 'object' && obj !== null && ObjectPrototypeHasOwnProperty(obj, 'stack');
}
function throwUnhandledRejectionsMode(promise, promiseInfo) {
  const reason = promiseInfo.reason;
  const handled = emitUnhandledRejection(promise, promiseInfo);
  if (!handled) {
    const err = isErrorLike(reason) ? reason : new UnhandledPromiseRejection(reason);
    triggerUncaughtException(err, true /* fromPromise */);
    return false;
  }
  return true;
}
class UnhandledPromiseRejection extends Error {
  code = 'ERR_UNHANDLED_REJECTION';
  name = 'UnhandledPromiseRejection';
  constructor(reason) {
    super('This error originated either by throwing inside of an ' +
    'async function without a catch block, or by rejecting a promise which ' +
    'was not handled with .catch(). The promise rejected with the reason "' +
    noSideEffectsToString(reason) + '".');
  }
}
```

The fatal path sets `exitCode = 1` and emits `'exit'` 1 behind the same
`_exiting` guard as `exit()`; a throwing `uncaughtException` listener escapes
this function (C++ `TriggerUncaughtException` then exits 7, o16) without the
`'exit'` emission. `noSideEffectsToString` is V8's side-effect-free rendering
(o44 table).

## §O1 Node oracle — programs

Scripts (each run as `node <file>` from `/tmp/vgoal/u7/oracle`; the transcript
prints stdout, the first stderr error line and the status):

```js
// o01-timer.mjs
process.on('uncaughtException', (e, origin) => console.log('caught', e.message, origin));
setTimeout(() => { throw new Error('boom'); }, 0);
setTimeout(() => console.log('after'), 20);

// o02-immediate.mjs
process.on('uncaughtException', (e, origin) => console.log('caught', e.message, origin));
setImmediate(() => { throw new Error('imm'); });
setTimeout(() => console.log('after'), 20);

// o03-fs.cjs
const fs = require('node:fs');
process.on('uncaughtException', (e, origin) => console.log('caught', e.message, origin));
fs.readFile(__filename, () => { throw new Error('io'); });
setTimeout(() => console.log('after'), 50);

// o04-nexttick.mjs
process.on('uncaughtException', (e, origin) => console.log('caught', e.message, origin));
process.nextTick(() => { throw new Error('tick'); });
setTimeout(() => console.log('after'), 20);

// o05-rejection.mjs
const p = Promise.reject(new Error('rej'));
process.on('unhandledRejection', (r, promise) => console.log('caughtR', r.message, promise === p));
setTimeout(() => console.log('after'), 20);

// o06-rej-fallback.mjs
process.on('uncaughtException', (e, origin) => console.log('caught', e.message, origin));
Promise.reject(new Error('rej2'));
setTimeout(() => console.log('after'), 20);

// o07-exit-natural.mjs
process.on('beforeExit', (c) => console.log('BEFORE-EXIT', c));
process.on('exit', (c) => console.log('EXIT', c, process.exitCode));
process.on('exit', (c) => console.log('EXIT2', c));
console.log('a');

// o08-exitcode-exit.mjs
process.on('exit', (c) => console.log('EXIT', c));
process.exitCode = 3;
process.exit();

// o09-exitcode-read.mjs
console.log('initial', typeof process.exitCode, process.exitCode);
process.exitCode = '3';
console.log('string', typeof process.exitCode, process.exitCode);
process.exitCode = null;
console.log('null', process.exitCode === null ? 'null' : typeof process.exitCode);
process.exitCode = undefined;
console.log('undef', typeof process.exitCode);
process.exitCode = 4;
process.exitCode = undefined;

// o10-exit-undefined.mjs
process.exitCode = 3;
process.exit(undefined);

// o11-exit-listener-reassign.mjs
process.on('exit', (c) => { console.log('EXIT', c); process.exitCode = 5; });
process.on('exit', (c) => console.log('EXIT-B', c, process.exitCode));

// o12-exit-reentrant.mjs
let n = 0;
process.on('exit', (c) => { n++; console.log('EXIT', c, n); process.exit(2); });
process.exit(1);

// o13-exit-timer.mjs
process.on('exit', (c) => { console.log('EXIT', c); setTimeout(() => console.log('TIMER-IN-EXIT'), 0); });
setTimeout(() => console.log('done'), 5);

// o14-uncaught-death-exit.mjs
process.on('exit', (c) => console.log('EXIT', c, process.exitCode));
setTimeout(() => { throw new Error('dead'); }, 0);

// o15-rejection-death-exit.mjs
process.on('exit', (c) => console.log('EXIT', c, process.exitCode));
Promise.reject(new Error('deadR'));

// o16-handler-throws.mjs
process.on('exit', (c) => console.log('EXIT', c));
process.on('uncaughtException', () => { throw new Error('inner'); });
setTimeout(() => { throw new Error('outer'); }, 0);

// o17-monitor.mjs
process.on('uncaughtExceptionMonitor', (e, origin) => console.log('monitor', e.message, origin));
process.on('uncaughtException', (e, origin) => console.log('caught', e.message, origin));
setTimeout(() => { throw new Error('m'); }, 0);

// o18-rej-order.mjs
process.on('unhandledRejection', (r) => console.log('unhandled', r.message));
setTimeout(() => console.log('timer0'), 0);
Promise.reject(new Error('ord'));
console.log('sync');

// o19-exit-in-rej-handler.mjs
process.on('exit', (c) => console.log('EXIT', c));
process.on('unhandledRejection', (r) => { process.exitCode = 1; console.log('handler', r.message); process.exit(); });
Promise.reject(new Error('vit'));
setTimeout(() => console.log('never'), 50);

// o20-nexttick-nohandler.mjs
process.on('exit', (c) => console.log('EXIT', c));
process.nextTick(() => { throw new Error('tickdead'); });
setTimeout(() => console.log('never'), 20);

// o21-exit-arg-event.mjs
process.on('exit', (c) => console.log('EXIT', c, process.exitCode));
process.exitCode = 9;
process.exit(5);

// o22-exitcode-natural.mjs
process.on('exit', (c) => console.log('EXIT', c, process.exitCode));
process.exitCode = 4;

// o23-cjs-toplevel-throw.cjs
process.on('uncaughtException', (e, origin) => console.log('caught', e.message, origin));
setTimeout(() => console.log('after'), 20);
throw new Error('top');

// o24-esm-toplevel-throw.mjs
process.on('uncaughtException', (e, origin) => console.log('caught', e.message, origin));
setTimeout(() => console.log('after'), 20);
throw new Error('topesm');

// o25-listener-emitter-throw.mjs
import { EventEmitter } from 'node:events';
process.on('uncaughtException', (e, origin) => console.log('caught', e.message, origin));
const ee = new EventEmitter();
ee.on('x', () => { throw new Error('emit'); });
setTimeout(() => { ee.emit('x'); console.log('not-reached'); }, 0);
setTimeout(() => console.log('after'), 20);

// o26-exit-sentinel-handler.mjs
process.on('uncaughtException', (e) => console.log('caught', e.message));
process.on('exit', (c) => console.log('EXIT', c));
setTimeout(() => { process.exit(6); }, 0);

// o27-exit-in-uncaught.mjs
process.on('exit', (c) => console.log('EXIT', c));
process.on('uncaughtException', (e) => { console.log('caught', e.message); process.exit(4); });
setTimeout(() => { throw new Error('x'); }, 0);
setTimeout(() => console.log('never'), 30);

// o28-once-exit.mjs
process.once('exit', (c) => console.log('ONCE', c));
process.exitCode = 2;

// o29-exit-in-exit-with-code-read.mjs
process.on('exit', (c) => { console.log('EXIT', c); process.exitCode = 7; process.exit(); });
process.exit(0);

// o30-rej-handled-then-exitcode.mjs
process.on('unhandledRejection', () => {});
Promise.reject(new Error('q'));
setTimeout(() => console.log('exitCode', typeof process.exitCode), 20);

// o31-esm-top-throw-rejhandler.mjs
process.on('unhandledRejection', (r, p) => console.log('unhandled', r.message, p instanceof Promise));
process.on('uncaughtException', (e, origin) => console.log('caught', e.message, origin));
setTimeout(() => console.log('after'), 20);
throw new Error('topesm2');

// o32-esm-tla-reject.mjs
process.on('uncaughtException', (e, origin) => console.log('caught', e.message, origin));
setTimeout(() => console.log('after'), 20);
await Promise.reject(new Error('tla'));

// o33-esm-top-throw-nohandler.mjs
process.on('exit', (c) => console.log('EXIT', c));
setTimeout(() => console.log('never'), 20);
throw new Error('topdead');

// o34-cjs-top-throw-nohandler.cjs
process.on('exit', (c) => console.log('EXIT', c));
setTimeout(() => console.log('never'), 20);
throw new Error('topdeadcjs');

// o35-exit-then-code-in-listener.mjs
process.on('exit', (c) => { console.log('EXIT', c); });
process.exitCode = 3;
setTimeout(() => { process.exitCode = undefined; }, 0);

// o36-uncaught-multi-listeners.mjs
process.on('uncaughtException', (e) => console.log('h1', e.message));
process.on('uncaughtException', (e) => console.log('h2', e.message));
setTimeout(() => { throw new Error('mm'); }, 0);
setTimeout(() => console.log('after', typeof process.exitCode), 20);

// o37-rej-nonerror.mjs
process.on('unhandledRejection', (r) => console.log('r', typeof r, r));
Promise.reject(42);
Promise.reject(undefined);

// o38-uncaught-nonerror.mjs
process.on('uncaughtException', (e, o) => console.log('e', typeof e, e, o));
setTimeout(() => { throw 'str'; }, 0);

// o39-exit-listener-throws.mjs
process.on('exit', (c) => { console.log('EXIT', c); throw new Error('inexit'); });
process.on('uncaughtException', (e) => console.log('caught', e.message));

// o40-remove-handler-then-throw.mjs
const h = (e) => console.log('caught', e.message);
process.on('uncaughtException', h);
setTimeout(() => { throw new Error('first'); }, 0);
setTimeout(() => { process.off('uncaughtException', h); throw new Error('second'); }, 10);
setTimeout(() => console.log('never'), 40);
process.on('exit', (c) => console.log('EXIT', c));

// o41-exit-in-exit-no-arg.mjs
process.on('exit', (c) => { console.log('EXIT', c); process.exit(); });
process.on('exit', (c) => console.log('EXIT-B', c));
process.exitCode = 3;

// o42-once-exit-remove.mjs
const f = (c) => console.log('should-not', c);
process.once('exit', f);
process.off('exit', f);
process.on('exit', (c) => console.log('EXIT', c));

// o44-wrap.cjs
process.on('uncaughtException', (e, o) => console.log(JSON.stringify([typeof e, e && e.name, e && e.code, e && e.message && e.message.replace(/^.*The promise rejected with the reason /, ''), e && Object.prototype.hasOwnProperty.call(e, 'stack'), e instanceof Error, o])));
const vals = [42, 'str', undefined, null, true, Symbol('s'), { a: 1 }, [1, 2], new Map(), Object.create(null), { stack: 'x' }, 10n, function f() {}, Object.assign(Object.create(Error.prototype), { message: 'proto-only' })];
let i = 0;
const next = () => { if (i < vals.length) { Promise.reject(vals[i++]); setTimeout(next, 5); } };
next();
```

```
$ ./run.sh o*.mjs o*.cjs     # run.sh: node "$f"; print stdout, first stderr Error line, $?
# node v24.16.0 2026-09-23T17:42Z
$ node o01-timer.mjs
  | caught boom uncaughtException
  | after
  [exit 0]
$ node o02-immediate.mjs
  | caught imm uncaughtException
  | after
  [exit 0]
$ node o03-fs.cjs
  | caught io uncaughtException
  | after
  [exit 0]
$ node o04-nexttick.mjs
  | caught tick uncaughtException
  | after
  [exit 0]
$ node o05-rejection.mjs
  | caughtR rej true
  | after
  [exit 0]
$ node o06-rej-fallback.mjs
  | caught rej2 unhandledRejection
  | after
  [exit 0]
$ node o07-exit-natural.mjs
  | a
  | BEFORE-EXIT 0
  | EXIT 0 undefined
  | EXIT2 0
  [exit 0]
$ node o08-exitcode-exit.mjs
  | EXIT 3
  [exit 3]
$ node o09-exitcode-read.mjs
  | initial undefined undefined
  | string number 3
  | null undefined
  | undef undefined
  [exit 0]
$ node o10-exit-undefined.mjs
  | 
  [exit 0]
$ node o11-exit-listener-reassign.mjs
  | EXIT 0
  | EXIT-B 0 5
  [exit 5]
$ node o12-exit-reentrant.mjs
  | EXIT 1 1
  [exit 2]
$ node o13-exit-timer.mjs
  | done
  | EXIT 0
  [exit 0]
$ node o14-uncaught-death-exit.mjs
  | EXIT 1 1
  stderr: Error: dead
  [exit 1]
$ node o15-rejection-death-exit.mjs
  | EXIT 1 1
  stderr: Error: deadR
  [exit 1]
$ node o16-handler-throws.mjs
  | 
  stderr: Error: inner
  [exit 7]
$ node o17-monitor.mjs
  | monitor m uncaughtException
  | caught m uncaughtException
  [exit 0]
$ node o18-rej-order.mjs
  | sync
  | unhandled ord
  | timer0
  [exit 0]
$ node o19-exit-in-rej-handler.mjs
  | handler vit
  | EXIT 1
  [exit 1]
$ node o20-nexttick-nohandler.mjs
  | EXIT 1
  stderr: Error: tickdead
  [exit 1]
$ node o21-exit-arg-event.mjs
  | EXIT 5 5
  [exit 5]
$ node o22-exitcode-natural.mjs
  | EXIT 4 4
  [exit 4]
$ node o23-cjs-toplevel-throw.cjs
  | caught top uncaughtException
  | after
  [exit 0]
$ node o24-esm-toplevel-throw.mjs
  | caught topesm unhandledRejection
  | after
  [exit 0]
$ node o25-listener-emitter-throw.mjs
  | caught emit uncaughtException
  | after
  [exit 0]
$ node o26-exit-sentinel-handler.mjs
  | EXIT 6
  [exit 6]
$ node o27-exit-in-uncaught.mjs
  | caught x
  | EXIT 4
  [exit 4]
$ node o28-once-exit.mjs
  | ONCE 2
  [exit 2]
$ node o29-exit-in-exit-with-code-read.mjs
  | EXIT 0
  [exit 7]
$ node o30-rej-handled-then-exitcode.mjs
  | exitCode undefined
  [exit 0]
$ node o31-esm-top-throw-rejhandler.mjs
  | caught topesm2 unhandledRejection
  | after
  [exit 0]
$ node o32-esm-tla-reject.mjs
  | caught tla unhandledRejection
  | after
  [exit 0]
$ node o33-esm-top-throw-nohandler.mjs
  | EXIT 1
  stderr: Error: topdead
  [exit 1]
$ node o34-cjs-top-throw-nohandler.cjs
  | EXIT 1
  stderr: Error: topdeadcjs
  [exit 1]
$ node o35-exit-then-code-in-listener.mjs
  | EXIT 0
  [exit 0]
$ node o36-uncaught-multi-listeners.mjs
  | h1 mm
  | h2 mm
  | after undefined
  [exit 0]
$ node o37-rej-nonerror.mjs
  | r number 42
  | r undefined undefined
  [exit 0]
$ node o38-uncaught-nonerror.mjs
  | e string str uncaughtException
  [exit 0]
$ node o39-exit-listener-throws.mjs
  | EXIT 0
  | caught inexit
  [exit 0]
$ node o40-remove-handler-then-throw.mjs
  | caught first
  | EXIT 1
  stderr: Error: second
  [exit 1]
$ node o41-exit-in-exit-no-arg.mjs
  | EXIT 3
  [exit 3]
$ node o42-once-exit-remove.mjs
  | EXIT 0
  [exit 0]
```

Facts used by the contract (script → fact):

- o01/o02/o03/o04/o25/o23: a throw from a timer, `setImmediate`, an fs
  callback, a `nextTick` callback, an EventEmitter listener run by a timer, and
  a CJS entry reaches `'uncaughtException'` listeners as `(err, 'uncaughtException')`;
  the program continues (`after`) and exits 0.
- o24/o31/o32: an ESM entry throw or top-level-await rejection reaches
  `'uncaughtException'` with origin `'unhandledRejection'` — even with an
  `'unhandledRejection'` listener installed (o31: that listener is not called).
- o05/o18/o37: `'unhandledRejection'` listeners get `(reason, promise)` (promise
  identity holds; non-Error reasons raw); the program continues.
- o06: with no `'unhandledRejection'` listener, `'uncaughtException'` listeners
  get `(reason, 'unhandledRejection')`.
- o07/o13/o22/o28/o35/o42: natural exit emits `'exit'` once with
  `process.exitCode || 0`; `process.exitCode` reads `undefined` in the listener
  when unset; a timer scheduled inside `'exit'` never runs; a removed `once`
  listener is not called.
- o08/o10/o21/o09: `exitCode=3; exit()` → 3; `exit(undefined)` after
  `exitCode=3` → 0 (an explicit argument replaces `exitCode`); `exit(5)` with
  `exitCode=9` → `'exit'` 5 and status 5; unset `exitCode` reads `undefined`,
  `'3'` reads number 3, `null` reads `undefined`.
- o11/o12/o29/o41: an `'exit'` listener setting `exitCode = 5` → status 5 (the
  code argument stays 0); `exit(2)` inside an `'exit'` listener → listeners are
  not re-emitted, later listeners do not run, status 2; `exitCode=7; exit()`
  inside the listener → 7.
- o14/o15/o20/o33/o34/o40: no listener → stderr names the error, `'exit'` fires
  with 1 and `process.exitCode` reads 1 inside it, status 1 (timer, rejection,
  nextTick, ESM/CJS entry, a listener removed before the second throw).
- o16: an `'uncaughtException'` listener that throws → stderr names the inner
  error, no `'exit'` event, status 7.
- o17: `'uncaughtExceptionMonitor'` runs before the `'uncaughtException'`
  listeners with the same `(err, origin)`.
- o19/o26/o27: `process.exit()` inside an `'unhandledRejection'` or
  `'uncaughtException'` listener (and `exit(6)` from a timer with an
  `'uncaughtException'` listener installed) terminates with that code and one
  `'exit'` event; the exit is never delivered to `'uncaughtException'`.
- o36/o30: every `'uncaughtException'` listener runs; a handled error leaves
  `process.exitCode` `undefined`.
- o39: a throw from an `'exit'` listener reaches `'uncaughtException'` (not
  claimed; see the unit's Out of scope).

`UnhandledPromiseRejection` wrapping (o44): with only an `'uncaughtException'`
listener, a rejection reason without an own `stack` property is delivered as an
`Error` named `UnhandledPromiseRejection`, `code: 'ERR_UNHANDLED_REJECTION'`,
message `This error originated either by throwing inside of an async function
without a catch block, or by rejecting a promise which was not handled with
.catch(). The promise rejected with the reason "<r>".`; an own-`stack` object
passes through raw. `<r>` per reason:

```
$ node o44-wrap.cjs      # [typeof, name, code, "<r>".tail, own stack, instanceof Error, origin]
["object","UnhandledPromiseRejection","ERR_UNHANDLED_REJECTION","\"42\".",true,true,"unhandledRejection"]
["object","UnhandledPromiseRejection","ERR_UNHANDLED_REJECTION","\"str\".",true,true,"unhandledRejection"]
["object","UnhandledPromiseRejection","ERR_UNHANDLED_REJECTION","\"undefined\".",true,true,"unhandledRejection"]
["object","UnhandledPromiseRejection","ERR_UNHANDLED_REJECTION","\"null\".",true,true,"unhandledRejection"]
["object","UnhandledPromiseRejection","ERR_UNHANDLED_REJECTION","\"true\".",true,true,"unhandledRejection"]
["object","UnhandledPromiseRejection","ERR_UNHANDLED_REJECTION","\"Symbol(s)\".",true,true,"unhandledRejection"]
["object","UnhandledPromiseRejection","ERR_UNHANDLED_REJECTION","\"#<Object>\".",true,true,"unhandledRejection"]
["object","UnhandledPromiseRejection","ERR_UNHANDLED_REJECTION","\"[object Array]\".",true,true,"unhandledRejection"]
["object","UnhandledPromiseRejection","ERR_UNHANDLED_REJECTION","\"#<Map>\".",true,true,"unhandledRejection"]
["object","UnhandledPromiseRejection","ERR_UNHANDLED_REJECTION","\"[object Object]\".",true,true,"unhandledRejection"]
["object",null,null,null,true,false,"unhandledRejection"]
["object","UnhandledPromiseRejection","ERR_UNHANDLED_REJECTION","\"10\".",true,true,"unhandledRejection"]
["object","UnhandledPromiseRejection","ERR_UNHANDLED_REJECTION","\"function f() {}\".",true,true,"unhandledRejection"]
["object","UnhandledPromiseRejection","ERR_UNHANDLED_REJECTION","\"Error: proto-only\".",true,true,"unhandledRejection"]
[exit 0]
```

## §O2 Node oracle — `node -e` / `node -p`

```
$ bash o43-eval.sh
$ node -e "process.on('exit',c=>console.log('L|exit',c,process.exitCode));setTimeout(()=>{throw new Error('FATAL-EVAL')},0)"
L|exit 1 1
  stderr: process.on('exit',c=>console.log('L|exit',c,process.exitCode));setTimeout(()=>{throw new Error('FATAL-EVAL')},0)
  [exit 1]
$ node -e "process.on('exit',c=>console.log('L|exit',c));Promise.reject(new Error('FATAL-EVAL-R'))"
L|exit 1
  stderr: process.on('exit',c=>console.log('L|exit',c));Promise.reject(new Error('FATAL-EVAL-R'))
  [exit 1]
$ node -e "process.on('exit',c=>console.log('L|exit',c));process.on('unhandledRejection',(r,p)=>console.log('L|caughtR',r.message,p instanceof Promise));Promise.reject(new Error('rej'))"
L|caughtR rej true
L|exit 0
  [exit 0]
$ node -e "process.on('exit',c=>console.log('L|exit',c,process.exitCode));process.exitCode=3;process.exit()"
L|exit 3 3
  [exit 3]
$ node -e "process.on('exit',c=>console.log('L|exit',c));process.on('uncaughtException',(e,o)=>console.log('L|caught',e.message,o));setTimeout(()=>console.log('L|after'),20);throw new Error('ev')"
L|caught ev uncaughtException
L|after
L|exit 0
  [exit 0]
$ node -e "process.on('exit',c=>{console.log('L|exit',c);process.exit(2)});process.exit(1)"
L|exit 1
  [exit 2]
$ node -p "process.on('exit',c=>console.log('EXIT',c,process.exitCode));setTimeout(()=>console.log('timer'),5);42"
timer
42
EXIT 0 undefined
  [exit 0]
$ node -p "process.on('exit',c=>console.log('EXIT',c));process.exitCode=2;'v'"
v
EXIT 2
  [exit 2]
```

Eval follows the program facts: handlers continue, fatal errors emit `'exit'`
1, `exit()` uses `exitCode`, re-entry exits 2, and `-p` prints its result
before the natural `'exit'`.

## §O3 Live-oracle cases (browser-unit carrier sources)

Sources: `tests/browser-unit/fixtures/process-lifecycle-cases.ts` (the spec runs
the same sources in live Node at test time). Transcript of those sources in
Node v24.16.0. `print-cases.mts` (repo root):

```ts
import { processLifecycleCases, runLifecycleOracle, lifecycleRows } from './tests/browser-unit/fixtures/process-lifecycle-cases.ts';
console.log(`# node ${process.version}`);
for (const c of processLifecycleCases) {
  const r = await runLifecycleOracle(c);
  const errLine = r.stderr.split('\n').find((l) => /Error/.test(l)) ?? '';
  console.log(`$ node ${c.nodeArgv[0] === '-e' ? '-e <' + c.name + '>' : c.nodeArgv.join(' ')}   (${c.name})`);
  console.log('  rows: ' + JSON.stringify(lifecycleRows(r.stdout)));
  if (c.fatal) console.log('  stderr has ' + c.fatal + ': ' + r.stderr.includes(c.fatal) + (errLine ? ' | ' + errLine.trim().slice(0, 100) : ''));
  console.log('  [exit ' + r.code + ']');
}
```

```
$ npx tsx print-cases.mts   # imports processLifecycleCases + runLifecycleOracle; prints L| rows, fatal marker, status
# node v24.16.0
$ node timer-handler.cjs   (timer-handler)
  rows: ["L|caught boom uncaughtException","L|after undefined","L|exit 0 undefined"]
  [exit 0]
$ node immediate-handler.cjs   (immediate-handler)
  rows: ["L|caught imm uncaughtException","L|after","L|exit 0 undefined"]
  [exit 0]
$ node fs-callback-handler.cjs   (fs-callback-handler)
  rows: ["L|caught io uncaughtException","L|after","L|exit 0 undefined"]
  [exit 0]
$ node nexttick-handler.cjs   (nexttick-handler)
  rows: ["L|caught tick uncaughtException","L|after","L|exit 0 undefined"]
  [exit 0]
$ node nonerror-handler.cjs   (nonerror-handler)
  rows: ["L|caught string false false undefined undefined str uncaughtException","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"42\". unhandledRejection","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"str\". unhandledRejection","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"undefined\". unhandledRejection","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"null\". unhandledRejection","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"true\". unhandledRejection","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"Symbol(s)\". unhandledRejection","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"10\". unhandledRejection","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"#<Object>\". unhandledRejection","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"[object Array]\". unhandledRejection","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"#<Map>\". unhandledRejection","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"[object Object]\". unhandledRejection","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"function f() {}\". unhandledRejection","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"Error: proto\". unhandledRejection","L|caught object false true undefined undefined [object Object] unhandledRejection","L|after","L|exit 0 undefined"]
  [exit 0]
$ node monitor-order.cjs   (monitor-order)
  rows: ["L|monitor m uncaughtException","L|caught m uncaughtException","L|exit 0 undefined"]
  [exit 0]
$ node rejection-handler.cjs   (rejection-handler)
  rows: ["L|caughtR rej true","L|after","L|exit 0 undefined"]
  [exit 0]
$ node rejection-only-handler.cjs   (rejection-only-handler)
  rows: ["L|caughtR lone","L|exit 0 undefined"]
  [exit 0]
$ node rejection-fallback.cjs   (rejection-fallback)
  rows: ["L|caught rej2 unhandledRejection","L|after","L|exit 0 undefined"]
  [exit 0]
$ node entry-throw-handler.cjs   (entry-throw-handler)
  rows: ["L|caught top uncaughtException","L|after","L|exit 0 undefined"]
  [exit 0]
$ node entry-throw-handler-esm.mjs   (entry-throw-handler-esm)
  rows: ["L|caught topesm unhandledRejection","L|after","L|exit 0 undefined"]
  [exit 0]
$ node natural-exit.cjs   (natural-exit)
  rows: ["L|body undefined","L|exit 0 undefined"]
  [exit 0]
$ node natural-exit-code.cjs   (natural-exit-code)
  rows: ["L|late","L|exit 4 4"]
  [exit 4]
$ node exitcode-read.cjs   (exitcode-read)
  rows: ["L|initial undefined","L|string number 3","L|null undefined","L|reset undefined"]
  [exit 0]
$ node exit-no-arg.cjs   (exit-no-arg)
  rows: ["L|exit 3 3"]
  [exit 3]
$ node exit-startup-error.cjs   (exit-startup-error)
  rows: ["L|exit 1 1"]
  [exit 1]
$ node exit-undefined-arg.cjs   (exit-undefined-arg)
  rows: ["L|exit 0 undefined"]
  [exit 0]
$ node exit-arg-override.cjs   (exit-arg-override)
  rows: ["L|exit 5 5"]
  [exit 5]
$ node exit-listener-reassign.cjs   (exit-listener-reassign)
  rows: ["L|exit 0","L|exit-b 0 5"]
  [exit 5]
$ node exit-reentrant.cjs   (exit-reentrant)
  rows: ["L|exit 1 1"]
  [exit 2]
$ node exit-listener-timer.cjs   (exit-listener-timer)
  rows: ["L|done","L|exit 0 undefined"]
  [exit 0]
$ node exit-in-rejection-handler.cjs   (exit-in-rejection-handler)
  rows: ["L|handler vit","L|exit 1 1"]
  [exit 1]
$ node exit-in-uncaught-handler.cjs   (exit-in-uncaught-handler)
  rows: ["L|caught x","L|exit 4 4"]
  [exit 4]
$ node fatal-timer.cjs   (fatal-timer)
  rows: ["L|exit 1 1"]
  stderr has FATAL-TIMER: true | setTimeout(() => { throw new Error('FATAL-TIMER'); }, 0);
  [exit 1]
$ node fatal-rejection.cjs   (fatal-rejection)
  rows: ["L|exit 1 1"]
  stderr has FATAL-REJECTION: true | Promise.reject(new Error('FATAL-REJECTION'));
  [exit 1]
$ node fatal-nexttick.cjs   (fatal-nexttick)
  rows: ["L|exit 1 1"]
  stderr has FATAL-TICK: true | process.nextTick(() => { throw new Error('FATAL-TICK'); });
  [exit 1]
$ node fatal-entry.cjs   (fatal-entry)
  rows: ["L|exit 1 1"]
  stderr has FATAL-ENTRY: true | throw new Error('FATAL-ENTRY');
  [exit 1]
$ node fatal-handler-throws.cjs   (fatal-handler-throws)
  rows: []
  stderr has FATAL-INNER: true | process.on('uncaughtException', () => { throw new Error('FATAL-INNER'); });
  [exit 7]
$ node -e <eval-handler>   (eval-handler)
  rows: ["L|caught boom uncaughtException","L|after","L|exit 0"]
  [exit 0]
$ node -e <eval-rejection-handler>   (eval-rejection-handler)
  rows: ["L|caughtR rej true","L|exit 0"]
  [exit 0]
$ node -e <eval-exit-no-arg>   (eval-exit-no-arg)
  rows: ["L|exit 3 3"]
  [exit 3]
$ node -e <eval-fatal-timer>   (eval-fatal-timer)
  rows: ["L|exit 1 1"]
  stderr has FATAL-EVAL: true | process.on('exit',c=>console.log('L|exit',c,process.exitCode));setTimeout(()=>{throw new Error('FATA
  [exit 1]
$ node node_modules/.bin/lifecycle-bin   (bin-startup-error)
  rows: ["L|late","L|exit 1 1"]
  [exit 1]
$ node fork-parent.cjs   (fork-child)
  rows: ["L|child-caught child-boom uncaughtException","L|child-after","L|child-exit 3 3","L|child-close 3"]
  [exit 0]
$ node worker-parent.cjs   (worker-thread-handler)
  rows: ["L|msg caught wboom uncaughtException","L|wexit 3"]
  [exit 0]
$ node exec-parent.cjs   (exec-sync-child)
  rows: ["L|child-caught exec-boom uncaughtException","L|child-late","L|child-exit 0 undefined","L|parent-done"]
  [exit 0]
```

## §B Rifty baseline at BASE (RED)

Browser-unit, real Chromium supervised children (`RIFTY_PLAYGROUND_PORT=5407
npx playwright test --config playwright.browser-unit.config.ts
tests/browser-unit/owner-node-process-lifecycle.spec.ts`, 2026-09-23): 36/36
cases differ (long rows cut at 600 chars):

```
LIFECYCLE-MISMATCHES 36
timer-handler
  node  {"rows":["L|caught boom uncaughtException","L|after undefined","L|exit 0 undefined"],"exit":0,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":true}
immediate-handler
  node  {"rows":["L|caught imm uncaughtException","L|after","L|exit 0 undefined"],"exit":0,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":true}
fs-callback-handler
  node  {"rows":["L|caught io uncaughtException","L|after","L|exit 0 undefined"],"exit":0,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":true}
nexttick-handler
  node  {"rows":["L|caught tick uncaughtException","L|after","L|exit 0 undefined"],"exit":0,"fatal":true}
  rifty {"rows":["L|caught tick undefined","L|after"],"exit":0,"fatal":true}
nonerror-handler
  node  {"rows":["L|caught string false false undefined undefined str uncaughtException","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"42\". unhandledRejection","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"str\". unhandledRejection","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"undefined\". unhandledRejection","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"null\". unhandledRejection","L|caught object true true UnhandledPromiseRejection ERR_UNHANDLED_REJECTION \"tr
  rifty {"rows":[],"exit":1,"fatal":true}
monitor-order
  node  {"rows":["L|monitor m uncaughtException","L|caught m uncaughtException","L|exit 0 undefined"],"exit":0,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":true}
rejection-handler
  node  {"rows":["L|caughtR rej true","L|after","L|exit 0 undefined"],"exit":0,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":true}
rejection-only-handler
  node  {"rows":["L|caughtR lone","L|exit 0 undefined"],"exit":0,"fatal":true}
  rifty {"rows":[],"exit":0,"fatal":true}
rejection-fallback
  node  {"rows":["L|caught rej2 unhandledRejection","L|after","L|exit 0 undefined"],"exit":0,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":true}
entry-throw-handler
  node  {"rows":["L|caught top uncaughtException","L|after","L|exit 0 undefined"],"exit":0,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":true}
entry-throw-handler-esm
  node  {"rows":["L|caught topesm unhandledRejection","L|after","L|exit 0 undefined"],"exit":0,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":true}
natural-exit
  node  {"rows":["L|body undefined","L|exit 0 undefined"],"exit":0,"fatal":true}
  rifty {"rows":["L|body number"],"exit":0,"fatal":true}
natural-exit-code
  node  {"rows":["L|late","L|exit 4 4"],"exit":4,"fatal":true}
  rifty {"rows":["L|late"],"exit":4,"fatal":true}
exitcode-read
  node  {"rows":["L|initial undefined","L|string number 3","L|null undefined","L|reset undefined"],"exit":0,"fatal":true}
  rifty {"rows":["L|initial number","L|string number 3","L|null number","L|reset number"],"exit":0,"fatal":true}
exit-no-arg
  node  {"rows":["L|exit 3 3"],"exit":3,"fatal":true}
  rifty {"rows":[],"exit":0,"fatal":true}
exit-startup-error
  node  {"rows":["L|exit 1 1"],"exit":1,"fatal":true}
  rifty {"rows":[],"exit":0,"fatal":true}
exit-undefined-arg
  node  {"rows":["L|exit 0 undefined"],"exit":0,"fatal":true}
  rifty {"rows":[],"exit":0,"fatal":true}
exit-arg-override
  node  {"rows":["L|exit 5 5"],"exit":5,"fatal":true}
  rifty {"rows":[],"exit":5,"fatal":true}
exit-listener-reassign
  node  {"rows":["L|exit 0","L|exit-b 0 5"],"exit":5,"fatal":true}
  rifty {"rows":[],"exit":0,"fatal":true}
exit-reentrant
  node  {"rows":["L|exit 1 1"],"exit":2,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":true}
exit-listener-timer
  node  {"rows":["L|done","L|exit 0 undefined"],"exit":0,"fatal":true}
  rifty {"rows":["L|done"],"exit":0,"fatal":true}
exit-in-rejection-handler
  node  {"rows":["L|handler vit","L|exit 1 1"],"exit":1,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":true}
exit-in-uncaught-handler
  node  {"rows":["L|caught x","L|exit 4 4"],"exit":4,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":true}
fatal-timer
  node  {"rows":["L|exit 1 1"],"exit":1,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":true}
fatal-rejection
  node  {"rows":["L|exit 1 1"],"exit":1,"fatal":true}
  rifty {"rows":[],"exit":0,"fatal":false}
fatal-nexttick
  node  {"rows":["L|exit 1 1"],"exit":1,"fatal":true}
  rifty {"rows":["L|never"],"exit":0,"fatal":false}
fatal-entry
  node  {"rows":["L|exit 1 1"],"exit":1,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":true}
fatal-handler-throws
  node  {"rows":[],"exit":7,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":false}
eval-handler
  node  {"rows":["L|caught boom uncaughtException","L|after","L|exit 0"],"exit":0,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":true}
eval-rejection-handler
  node  {"rows":["L|caughtR rej true","L|exit 0"],"exit":0,"fatal":true}
  rifty {"rows":[],"exit":0,"fatal":true}
eval-exit-no-arg
  node  {"rows":["L|exit 3 3"],"exit":3,"fatal":true}
  rifty {"rows":[],"exit":0,"fatal":true}
eval-fatal-timer
  node  {"rows":["L|exit 1 1"],"exit":1,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":true}
bin-startup-error
  node  {"rows":["L|late","L|exit 1 1"],"exit":1,"fatal":true}
  rifty {"rows":["L|late"],"exit":0,"fatal":true}
fork-child
  node  {"rows":["L|child-caught child-boom uncaughtException","L|child-after","L|child-exit 3 3","L|child-close 3"],"exit":0,"fatal":true}
  rifty {"rows":["L|child-close 1"],"exit":0,"fatal":true}
worker-thread-handler
  node  {"rows":["L|msg caught wboom uncaughtException","L|wexit 3"],"exit":0,"fatal":true}
  rifty {"rows":["L|wexit 1"],"exit":0,"fatal":true}
exec-sync-child
  node  {"rows":["L|child-caught exec-boom uncaughtException","L|child-late","L|child-exit 0 undefined","L|parent-done"],"exit":0,"fatal":true}
  rifty {"rows":[],"exit":1,"fatal":true}
```

Notable baseline facts: handlers are never called for timer/immediate/fs/entry
errors or rejections (status 1); the nextTick path calls the listener without
an origin and silently drops a throw with no listener (`L|never`, status 0);
`fatal-rejection`, `rejection-only-handler` and `eval-rejection-handler` exit 0
with no output — the drain settles before Chromium dispatches
`unhandledrejection` (`runtime-js/late-unhandled-rejection-drain`); no
`'exit'` event on any path; `exitCode` reads a number; `exit()` ignores
`exitCode` (`exit-no-arg`, `exit-startup-error`, `bin-startup-error` → 0); a
throwing handler exits 1, not 7.

Parity, forked program children (`pnpm test:parity exit-lifecycle-child`):

```
  ✗ process/exit-lifecycle-child.case.ts
    diff (- node / + rifty):
      - {"file":"natural.js","stdout":["body undefined","exit 0 undefined"],"code":0,"signal":null,"loud":false}
      + {"file":"natural.js","stdout":["body number"],"code":0,"signal":null,"loud":false}
      - {"file":"natural-code.js","stdout":["late","exit 4 4"],"code":4,"signal":null,"loud":false}
      + {"file":"natural-code.js","stdout":["late"],"code":4,"signal":null,"loud":false}
      - {"file":"exitcode-read.js","stdout":["initial undefined","string number 3","null undefined","reset undefined"],"code":0,"signal":null,"loud":false}
      + {"file":"exitcode-read.js","stdout":["initial number","string number 3","null number","reset number"],"code":0,"signal":null,"loud":false}
      - {"file":"exit-no-arg.js","stdout":["exit 3 3"],"code":3,"signal":null,"loud":false}
      + {"file":"exit-no-arg.js","stdout":[],"code":0,"signal":null,"loud":false}
      - {"file":"exit-startup-error.js","stdout":["exit 1 1"],"code":1,"signal":null,"loud":false}
      + {"file":"exit-startup-error.js","stdout":[],"code":0,"signal":null,"loud":false}
      - {"file":"exit-undefined-arg.js","stdout":["exit 0 undefined"],"code":0,"signal":null,"loud":false}
      + {"file":"exit-undefined-arg.js","stdout":[],"code":0,"signal":null,"loud":false}
      - {"file":"exit-arg-override.js","stdout":["exit 5 5"],"code":5,"signal":null,"loud":false}
      + {"file":"exit-arg-override.js","stdout":[],"code":5,"signal":null,"loud":false}
      - {"file":"exit-listener-reassign.js","stdout":["exit 0","exit-b 0 5"],"code":5,"signal":null,"loud":false}
      + {"file":"exit-listener-reassign.js","stdout":[],"code":0,"signal":null,"loud":false}
      - {"file":"exit-reentrant.js","stdout":["exit 1 1"],"code":2,"signal":null,"loud":false}
      + {"file":"exit-reentrant.js","stdout":[],"code":1,"signal":null,"loud":false}
      - {"file":"exit-listener-timer.js","stdout":["done","exit 0 undefined"],"code":0,"signal":null,"loud":false}
      + {"file":"exit-listener-timer.js","stdout":["done"],"code":0,"signal":null,"loud":false}
      - {"file":"nexttick-handler.js","stdout":["caught tick uncaughtException","after","exit 0 undefined"],"code":0,"signal":null,"loud":false}
      + {"file":"nexttick-handler.js","stdout":["caught tick undefined","after"],"code":0,"signal":null,"loud":false}
      - {"file":"nexttick-fatal.js","stdout":["exit 1 1"],"code":1,"signal":null,"loud":true}
      + {"file":"nexttick-fatal.js","stdout":["never"],"code":0,"signal":null,"loud":false}
1 case(s) failed
[ELIFECYCLE] Command failed with exit code 1.
```

`pnpm test:parity eval-exit-lifecycle` (physical `node -e`/`-p` children): all
nine invocations differ — no `'exit'` rows, `body number`, `exit-no-arg` /
`exit-startup-error` status 0, `exit-reentrant` status 1, `exit-listener-reassign`
status 0, `print-before-exit` stdout `timer\n42\n`, `nexttick-handler`
`caught tick undefined`.

Unit REDs: `npx vitest run
packages/runtime-js/src/builtins/process-exit-lifecycle.test.ts` → `expected []
to deeply equal [ 3 ]` (no `'exit'` emission) and `expected error to match
asymmetric matcher … [Error: process.exit(1)]` (re-entrant exit keeps 1);
`npx vitest run
packages/runtime-js/src/internal/event-loop-keepalive-late-rejection.fault.test.ts`
→ `expected 'resolved' to be 'rejected:late-rejection'`.

## §G IMPLEMENT — added carriers (RED → GREEN) and probes

Oracle probes for implementation choices (host Node v24.16.0, 2026-09-23):

```
$ node esm-str.mjs      # uncaughtException listener; setTimeout after; ESM entry `throw 'str'`
L|caught string str unhandledRejection
L|after
[exit 0]
$ node cjs-str.cjs      # same, CommonJS entry
L|caught string str uncaughtException
L|after
[exit 0]
$ node mon-fatal.cjs    # monitor + exit listener, no uncaughtException listener, timer throw
L|mon m uncaughtException
L|exit 1 1
[exit 1]
$ node -e "process.exitCode=null;console.log(process.exitCode===null?'null':typeof process.exitCode)"
undefined
$ node -e "process.exitCode=3; process.exit(null)"; echo $?
0
$ node -p "process.on('uncaughtException',(e,o)=>console.log('caught',e,o));process.on('exit',c=>console.log('exit',c));throw 1"
caught 1 uncaughtException
exit 0
$ node cb-throw.cjs     # fs.stat / util.callbackify / zlib.gzip callbacks throw; both listeners installed
caught callbackify uncaughtException
caught fs-stat uncaughtException
caught zlib-gzip uncaughtException
after
exit 0 undefined
[exit 0]
```

`tools/node-parity-runner/cases/process/eval-entry-throw-lifecycle.case.ts`
(Contract+RED concern: eval entry throw uncovered). RED = the implementation
minus the `runNodeEntry` dispatch (`git checkout node-entry.ts`), rest applied:

```
$ pnpm test:parity eval-entry-throw-lifecycle
  ✗ process/eval-entry-throw-lifecycle.case.ts
      -     "stdout": "caught ev uncaughtException\nafter\nexit 0 undefined\n",
      +     "stdout": "",
      -     "label": "print-entry-throw-handler",
      -     "stdout": "caught 1 uncaughtException\nexit 0 undefined\n",
      +     "code": 1,
      -     "label": "entry-throw-fatal",
      -     "stdout": "exit 1 1\n",
      +     "stdout": "",
```

`tools/node-parity-runner/cases/process/callback-throw-uncaught-child.case.ts`
(fault-class sweep: a callback run inside the promise reaction that settled it).
RED = `runNodeCallback` without its catch (the BASE shape):

```
$ pnpm test:parity callback-throw-uncaught-child
  ✗ process/callback-throw-uncaught-child.case.ts
      - {"file":"fs-stat.js","stdout":["caught fs-stat uncaughtException","after","exit 0 undefined"],"code":0,"signal":null}
      + {"file":"fs-stat.js","stdout":["unhandled fs-stat","after","exit 0 undefined"],"code":0,"signal":null}
      - {"file":"fs-read-file.js","stdout":["caught fs-read-file uncaughtException","after","exit 0 undefined"],"code":0,"signal":null}
      + {"file":"fs-read-file.js","stdout":["unhandled fs-read-file","after","exit 0 undefined"],"code":0,"signal":null}
      - {"file":"callbackify.js","stdout":["caught callbackify uncaughtException","after","exit 0 undefined"],"code":0,"signal":null}
      + {"file":"callbackify.js","stdout":["unhandled callbackify","after","exit 0 undefined"],"code":0,"signal":null}
      - {"file":"zlib-gzip.js","stdout":["caught zlib-gzip uncaughtException","after","exit 0 undefined"],"code":0,"signal":null}
      + {"file":"zlib-gzip.js","stdout":["unhandled zlib-gzip","after","exit 0 undefined"],"code":0,"signal":null}
```

`tools/node-parity-runner/cases/process/eval-print-explicit-exit.case.ts`
(Contract+RED concern: `-p` with an explicit `exit()`). Oracle and RED = the
implementation without the `'exit'` emission in `NodeProcessExit.exit`:

```
$ node -p "process.on('exit',c=>process.stdout.write('EXIT '+c+'\n'));setTimeout(()=>process.exit(3),5);42"
EXIT 3
42
[exit 3]
$ node -p "process.on('exit',c=>process.stdout.write('EXIT '+c+'\n'));process.exit(4);42"
EXIT 4
[exit 4]
$ pnpm test:parity eval-print-explicit-exit        # RED
  ✗ process/eval-print-explicit-exit.case.ts
      -     "stdout": "EXIT 3\n42\n",
      +     "stdout": "42\n",
      -     "stdout": "EXIT 4\n",
      +     "stdout": "",
```

Sibling probe (temporary case, not committed): `fs.createReadStream(f).on('data', throw)`
and a throw inside a user `promises.stat().then` already match Node.

GREEN (implementation applied): `pnpm test:parity process/` → 35/35 match
(incl. `exit-lifecycle-child`, `eval-exit-lifecycle`, all `node-eval-context*`);
`eval-entry-throw-lifecycle` and `callback-throw-uncaught-child` match;
browser-unit `owner-node-process-lifecycle.spec.ts` → 1 passed (36/36 cases);
`npx vitest run packages tests/conformance tools` → 628 files / 9353 tests pass.

## §F Final+GREEN r1 — fatal rejection terminal (RED → GREEN)

Blocker (review of `494474229`): a no-listener rejection ran the fatal `'exit'`
1, then only recorded the reason; the terminal waited for the next drain
sample, and a user task in between (`setTimeout(() => process.exit(0), 1)`)
sent the first kernel exit request with 0. Node oracle (host Node v24.16.0,
2026-09-23; every program starts `process.on('exit', (c) => console.log('L|exit', c, process.exitCode));`
unless it is a parent):

```
$ node rej-then-exit0-1ms.cjs       # Promise.reject(new Error('V1')); setTimeout(() => process.exit(0), 1)
L|exit 1 1
stderr: … Error: V1 …   [exit 1]
$ node rej-then-exit0-0ms.cjs       # same, 0 ms
L|exit 1 1
stderr: … Error: V2 …   [exit 1]
$ node rej-then-log-0ms.cjs         # Promise.reject(new Error('V3')); setTimeout(() => console.log('L|after'), 0)
L|exit 1 1
stderr: … Error: V3 …   [exit 1]
$ node rej-exit-listener-code.cjs   # 'exit' listener sets process.exitCode = 5; Promise.reject(new Error('V5'))
L|exit 1 1
stderr: … Error: V5 …   [exit 5]
$ node throw-exit-listener-code.cjs # same listener; setTimeout(() => { throw new Error('T5') }, 0)
L|exit 1 1
stderr: … Error: T5 …   [exit 5]
$ node fork-fatal-parent.cjs        # = browser-unit fork-fatal-rejection-then-exit
L|child-exit 1 1
L|child-close 1
$ node wt-fatal-parent.cjs          # = worker-thread-fatal-rejection-then-exit, 'error' listener prints M|
M|werror WT-FATAL
L|wexit 1
$ node xs-parent.cjs                # execSync of a child: reject + setTimeout(exit(0), 1); prints e.message line 1, e.status
M| Command failed: node xs-child.cjs … 1
$ node rej-exit-listener-exit2.cjs  # 'exit' listener calls process.exit(2); Promise.reject(new Error('V7'))
L|exit 1 1
[exit 2] stderr-bytes=0
$ node exit0-then-rej.cjs           # setTimeout(() => { Promise.reject(new Error('V8')); process.exit(0); }, 0)
L|exit 0 0
[exit 0] stderr-bytes=0
```

So Node's fatal status is `exitCode` after the `'exit'` listeners (`?? 1`),
and nothing of the program runs after it. Fix (ADR-0445 rule 3): the trap runs
`NodeProcessExit.fatal` at once (stderr, then the one kernel exit request with
`uint8(exitCode ?? 1)`); the drain records that exit signal.

RED (fix's tests on `494474229` product code; GREEN = the fix):

```
$ npx vitest run packages/runtime-js/src/builtins/process-exit-lifecycle.test.ts
  × fatal unhandled rejection (ADR-0445) > prints and requests status 1 at the trap; a later exit(0) requests nothing
-     "code": 1,
+     "code": 0,
      "kind": "control:self-exit",
$ RIFTY_PLAYGROUND_PORT=5407 npx playwright test --config playwright.browser-unit.config.ts tests/browser-unit/owner-node-process-lifecycle.spec.ts
LIFECYCLE-MISMATCHES 4
fatal-rejection-then-exit
  node  {"rows":["L|exit 1 1"],"exit":1,"fatal":true}
  rifty {"rows":["L|exit 1 1"],"exit":0,"fatal":false}
fork-fatal-rejection-then-exit
  node  {"rows":["L|child-exit 1 1","L|child-close 1"],"exit":0,"fatal":true}
  rifty {"rows":["L|child-exit 1 1","L|child-close 0"],"exit":0,"fatal":true}
worker-thread-fatal-rejection-then-exit
  node  {"rows":["L|wexit 1"],"exit":0,"fatal":true}
  rifty {"rows":["L|wexit 0"],"exit":0,"fatal":true}
exec-sync-fatal-rejection-then-exit
  node  {"rows":["L|exec-failed"],"exit":0,"fatal":true}
  rifty {"rows":["L|exec-ok"],"exit":0,"fatal":true}
```

The first GREEN printed the error after an `exit()` that had already
requested the kernel exit (probe `p5-rej-exit0-0ms` r0 showed `Error: P1`
after `L|exit 0 0`); Node prints nothing then (`rej-exit-listener-exit2`,
`exit0-then-rej`). RED for the guard (`process-exit-lifecycle.test.ts` cases
4–5 before `NodeProcessExit.#terminal`):

```
× … an exit() inside the fatal exit listener owns the status and nothing prints
    - Array []   + Array [ "Error: V7 …" ]
× … a rejection seen after exit(0) prints nothing and keeps status 0
    - Array []   + Array [ "Error: V8 …" ]
```

GREEN (`db9a3c439`): the five unit cases pass; `pnpm pr:check` test:run and
test:parity pass; the browser-unit spec passes every case 3/3 runs, sibling
browser-unit lanes 27/27, e2e chromium-light 25/25, `pnpm test:e2e:prod` 8/8;
the reviewer's probe (`rej-then-exit0-1ms`) matches Node 6/6. Probes on the fix before the guard (the guard acts only
after an earlier exit request): `p5-rej-listener-code` (rejection, `'exit'`
listener sets `exitCode = 5`): rifty 5 = Node 3/3; `p5-rej-nonerror`
(`Promise.reject(42)`): `UnhandledPromiseRejection` on stderr, status 1 = Node.
`p5-throw-listener-code` (a throw, same listener): rifty 1, Node 5 3/3 — the
default Worker report's status; Out of scope + compat ⚠️.

Sibling sweep: every kernel child (program lifecycle, `.bin`, fork, execSync
branch, worker thread) shares the realm trap and its control port — covered by
the four cases above. Eval already claimed the first terminal
(`beginNodeEvalUnhandled`). The no-COI project command has no control port;
by code reading (not executed, no carrier) it prints the error on the
invocation's stderr and its drain rejects with the exit signal — a loud failed
result, never 0; handler dispatch there stays ⚠️ unclaimed. (Final+GREEN b-r1 reading disputes this: the no-COI toolchain worker never calls `installProcessGlobals`, so its traps likely take the NO_PROCESS path — unprobed either way; nothing claimed.) Execsync probe
(`node xs-parent.cjs`, parent prints the thrown message): `494474229` →
`L|no-throw` 3/3 (child exited 0); the fix → `Command failed with exit code 1`
3/3.

Not fixed (Out of scope, delivery order): `rej-then-log-0ms` prints
`L|after` then `L|exit 1 1` in rifty (6/6). The row order shows the 0 ms timer
ran before Chromium dispatched `unhandledrejection` — the trap had not run yet.
The same order makes a 0 ms `exit(0)` win (`p5-rej-exit0-0ms`: rifty
`L|exit 0 0`, status 0; Node `L|exit 1 1`, status 1; 3/3); Node processes the
rejection first (o18).

## §F2 Final+GREEN r1 reception — rejection vs an already-queued Node callback

Sibling sweep of the §F fault class by trigger (reception, 2026-09-23, HEAD
`91f6fa4e1`). Every program starts with the §F `'exit'` row. Node: host
v24.16.0, `node <f>.cjs` ×3 (`/tmp/vgoal/u7/rcp/node-oracle{,2}.txt`).
Rifty: scratch browser-unit probe (real Chromium, live Node oracle, spec
`/tmp/vgoal/u7/rcp/zz-u7-reception-probe.spec.ts` copied into
`tests/browser-unit/` and removed after; `RIFTY_PLAYGROUND_PORT=5407 npx
playwright test --config playwright.browser-unit.config.ts
tests/browser-unit/zz-u7-reception-probe.spec.ts`), `node <f>.cjs` in the
shell, 3 rounds. "no stderr" = the terminal output holds only the rows.

| program (after the `'exit'` row) | Node rows, status | rifty rows, status (3/3) |
|---|---|---|
| `Promise.reject(new Error('V1')); setTimeout(() => process.exit(0), 1)` | `L\|exit 1 1`, stderr, 1 | same |
| `Promise.reject(new Error('I1')); setImmediate(() => process.exit(0))` | `L\|exit 1 1`, stderr, 1 | `L\|exit 0 0`, no stderr, 0 |
| `Promise.reject(new Error('I2')); setImmediate(() => console.log('L\|after'))` | `L\|exit 1 1`, stderr, 1 | `L\|after`, `L\|exit 1 1`, stderr, 1 |
| `Promise.reject(new Error('F1')); fs.readFile(__filename, () => process.exit(0))` | `L\|exit 1 1`, stderr, 1 | `L\|exit 0 0`, no stderr, 0 |
| `Promise.reject(new Error('F2')); fs.readFile(__filename, () => console.log('L\|after'))` | `L\|exit 1 1`, stderr, 1 | `L\|after`, `L\|exit 1 1`, stderr, 1 |
| `Promise.reject(new Error('F3')); fs.stat(__filename, () => process.exit(0))` | `L\|exit 1 1`, stderr, 1 | `L\|exit 0 0`, no stderr, 0 |
| `Promise.reject(new Error('S3')); fs.promises.readFile(__filename).then(() => process.exit(0))` | `L\|exit 1 1`, stderr, 1 | `L\|exit 0 0`, no stderr, 0 |
| `setTimeout(() => { Promise.reject(new Error('S1')) }, 1); setTimeout(() => process.exit(0), 1)` | `L\|exit 1 1`, stderr, 1 | `L\|exit 0 0`, no stderr, 0 |
| `setImmediate(() => { Promise.reject(new Error('S2')) }); setImmediate(() => process.exit(0))` | `L\|exit 1 1`, stderr, 1 | `L\|exit 0 0`, no stderr, 0 |
| `setTimeout(() => { Promise.reject(new Error('T1')); setImmediate(() => process.exit(0)) }, 1)` | `L\|exit 1 1`, stderr, 1 | `L\|exit 0 0`, no stderr, 0 |
| `fs.readFile(__filename, () => { Promise.reject(new Error('S5')); setImmediate(() => process.exit(0)) })` | `L\|exit 1 1`, stderr, 1 | `L\|exit 0 0`, no stderr, 0 |
| `Promise.reject(new Error('N1')); process.nextTick(() => process.exit(0))` | `L\|exit 0 0`, 0 | same |
| `unhandledRejection` listener prints `L\|rej`; `Promise.reject(new Error('S4')); setImmediate(() => console.log('L\|imm'))` | `L\|rej S4`, `L\|imm`, `L\|exit 0 undefined`, 0 | `L\|imm`, `L\|rej S4`, `L\|exit 0 undefined`, 0 |

Node runs `runNextTicks()` (microtasks, then `processTicksAndRejections` while
a rejection is pending) between timers and before each immediate:

```
$ node --expose-internals -e "const q=require('internal/process/task_queues'); console.log(q.setupTaskQueue().runNextTicks.toString())"
function runNextTicks() {
  if (!hasTickScheduled() && !hasRejectionToWarn())
    runMicrotasks();
  if (!hasTickScheduled() && !hasRejectionToWarn())
    return;

  processTicksAndRejections();
}
$ node --expose-internals -e "<internal/timers getTimerCallbacks(runNextTicks): processImmediate + processTimers source, lines naming runNextTicks>"
function processImmediate() {
        runNextTicks();
function processTimers(now) {
        runNextTicks();
```

So in Node a no-listener rejection is fatal before the next Node callback.
Chromium reports it in its own `unhandledrejection` task, which it queues
after the task that made the rejection. A Node callback queued before that
task runs first. That covers a `setImmediate` message posted in the same
turn, a timer that becomes ripe at the same time, and an fs callback, which
rifty runs as a promise reaction in the same task. §F's trap-time terminal is
correct once the trap runs, but the trap cannot run earlier. The only
order-true route found is a fence: each Node callback (timer, immediate,
fs/I/O callback) runs in a host task posted after the previous callback's
task ended. By design reasoning (not executed), that costs at least two
host-task hops per callback and moves `setImmediate` behind a same-turn
`setTimeout(0)` (ADR-0085). Parity 10
("never 0") is violated as declared for these programs. The ready
Out-of-scope delivery-order row names only a same-turn `setTimeout(0)`.
Routed as a `STOP-1a` fork (unit `## Decisions`).

Resolved 2026-09-24 (user, option B): Parity 10 and its fault row claim
rejections Chromium has already delivered; the already-queued-callback case is
Out of scope, compat ⚠️, and the fence goes to backlog
`runtime-js/late-unhandled-rejection-drain` (draft kept). The probe stays here
as evidence, not a committed test: the repo has no known-failing test pattern
(`git grep` for `test.fails`/`it.fails`/`.fixme(` over tests, packages and
the parity runner: none; the runner fails on any divergence).

## §V vitest 4.1.11 lifecycle uses (static)

```
$ npm pack vitest@4.1.11 && tar xzf vitest-4.1.11.tgz && cd package/dist/chunks
$ grep -n 'process.exitCode == null\|process.once("exit"\|process.on("unhandledRejection"\|setTimeout(() => process.exit(), 1)\|if (process.exitCode === void 0)\|processOn("uncaughtException"\|processOn("unhandledRejection"\|processListeners(event).length > 1\|const processOn = process.on.bind' cac.uFydS1Z4.js cli-api.CnMVyzaz.js init.k9zZ9sLh.js init-forks.H5ZuobOQ.js
init.k9zZ9sLh.js:95:const processOn = process.on.bind(process);
init.k9zZ9sLh.js:105:		if (processListeners(event).length > 1) return;
init.k9zZ9sLh.js:115:	processOn("uncaughtException", uncaughtException);
init.k9zZ9sLh.js:116:	processOn("unhandledRejection", unhandledRejection);
init-forks.H5ZuobOQ.js:7:const processOn = process.on.bind(process);
cli-api.CnMVyzaz.js:2057:			if (process.exitCode === void 0) process.exitCode = exitCode !== void 0 ? 128 + exitCode : Number(signal);
cli-api.CnMVyzaz.js:2059:			setTimeout(() => process.exit(), 1);
cli-api.CnMVyzaz.js:2063:		process.once("exit", onExit);
cli-api.CnMVyzaz.js:2081:		process.on("unhandledRejection", onUnhandledRejection);
cac.uFydS1Z4.js:2347:		if (process.exitCode == null) process.exitCode = 1;
cac.uFydS1Z4.js:2387:		if (process.exitCode == null) process.exitCode = 1;
$ grep -rn beforeExit . | wc -l
       0
```

cac's Startup Error path sets `exitCode` only when it reads `null`/`undefined`,
then calls `exit()` with no argument; vitest's `'exit'` hook reads `exitCode ===
undefined` and schedules `setTimeout(() => process.exit(), 1)`; its
main-process rejection handler sets `exitCode = 1` and calls `exit()`; pool
workers bind `process.on` and install both error listeners. The forks pool also
binds `process.exit`.

## §L Launch paths at BASE (code)

- `packages/workbench/src/workers/node-entry-bootstrap.ts`: program launches
  with `nodeServe` (shell `node <file>`, `.bin` programs, `child_process`
  spawn/fork children) and eval launches run `runNodeProgramLifecycle`;
  natural exit calls `proc.exit(normalizeExitCode(proc.exitCode))`
  (`node-program-lifecycle.ts`). Other launches (execSync `node <script>`
  children, `nodeServe:false`; worker threads) `await runEntry()` then
  `if (proc.exitCode) proc.exit(proc.exitCode)` before the kernel drain.
- `packages/runtime-js/src/builtins/process.ts`: `#exitCode = 0`;
  `exit(code = 0)` sets it and throws `RIFTY_PROCESS_EXIT`, no `'exit'` emit;
  `drainNextTicks` emits `'uncaughtException'` with no origin and no fatal path.
- `packages/runtime-js/src/internal/event-loop-keepalive.ts`: the realm
  `error` trap claims eval launches only; the `unhandledrejection` trap records
  the reason for the drain (ADR-0152 §3) without consulting process listeners;
  `awaitDrain` settles on the first zero-ref sample (TODO
  `runtime-js/late-unhandled-rejection-drain`).
- Numeric `exitCode` readers: `packages/runtime-js/src/ipc/in-process-node-entry-runner.ts`,
  `packages/workbench/src/workers/no-coi-project-command.ts`,
  `tools/node-parity-runner/src/run-in-rifty.ts` (exec-sync harness),
  `packages/workbench/src/workers/node-program-lifecycle.ts`;
  `no-coi-toolchain-worker.ts` already treats `undefined`.
- Harness: `tools/node-parity-runner/src/worker-env-kernel-worker.ts` mirrors
  the browser traps from host `uncaughtException`/`unhandledRejection`.
