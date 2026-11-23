# Baseline — builtin names the isolate guest prints (PR #425, 2026-11-23)

RED for unit `runtime-js/guest-builtin-names`. Observed on PR #425's tree
(isolate-host `runCode`, guest bundle built from it) against live Node
v24.16.0. Reproduce: for each program, `runCode(code)` (`packages/isolate-host`)
and `node -e code` in an empty temp dir with
`code = "require('fs').writeFileSync('m.js', " + JSON.stringify(program) +
"); require('./m.js');"`; outputs below verbatim (temp dir → `<root>`).

Cause: a constructor's source (SFI) name is what V8 and inspect print. The
streams' constructors are one generic `function publishedConstructor`
(`packages/io/src/streams/callable-constructor.ts`); the bundler renames a
class or function named like another binding (`TextEncoder2 = class`).

## Fatal report

### program
```js
const { Readable } = require('stream');
const r = new Readable({ read() {} });
r.on('data', function onData() { throw new Error('rd'); });
r.push('x');
```
Node v24.16.0 (`node:*` frames dropped):
```
<root>/m.js:3
r.on('data', function onData() { throw new Error('rd'); });
                                 ^

Error: rd
    at Readable.onData (<root>/m.js:3:40)

Node.js v24.16.0
```
isolate:
```
Error: rd
    at publishedConstructor.onData (<root>/m.js:3:40)

Node.js v24.0.0
```

### program
```js
const { Writable } = require('stream');
const wr = new Writable({ write(c, e, cb) { throw new Error('wr'); } });
wr.write('x');
```
Node v24.16.0 (`node:*` frames dropped):
```
<root>/m.js:2
const wr = new Writable({ write(c, e, cb) { throw new Error('wr'); } });
                                            ^

Error: wr
    at Writable.write [as _write] (<root>/m.js:2:51)
    at Object.<anonymous> (<root>/m.js:3:4)

Node.js v24.16.0
```
isolate:
```
Error: wr
    at publishedConstructor.write [as _write] (<root>/m.js:2:51)
    at Object.<anonymous> (<root>/m.js:3:4)

Node.js v24.0.0
```

### program
```js
const { Transform } = require('stream');
const t = new Transform({ transform(c, e, cb) { throw new Error('tr'); } });
t.write('x');
```
Node v24.16.0 (`node:*` frames dropped):
```
<root>/m.js:2
const t = new Transform({ transform(c, e, cb) { throw new Error('tr'); } });
                                                ^

Error: tr
    at Transform.transform [as _transform] (<root>/m.js:2:55)
    at Object.<anonymous> (<root>/m.js:3:3)

Node.js v24.16.0
```
isolate:
```
Error: tr
    at publishedConstructor.transform (<root>/m.js:2:55)
    at Object.<anonymous> (<root>/m.js:3:3)

Node.js v24.0.0
```

### program
```js
const { PassThrough } = require('stream');
const p = new PassThrough();
p.on('data', function onData() { throw new Error('pt'); });
p.write('x');
```
Node v24.16.0 (`node:*` frames dropped):
```
<root>/m.js:3
p.on('data', function onData() { throw new Error('pt'); });
                                 ^

Error: pt
    at PassThrough.onData (<root>/m.js:3:40)

Node.js v24.16.0
```
isolate:
```
Error: pt
    at publishedConstructor.onData (<root>/m.js:3:40)

Node.js v24.0.0
```

### program
```js
throw new TextEncoder();
```
Node v24.16.0 (`node:*` frames dropped):
```
<root>/m.js:1
throw new TextEncoder();
^

TextEncoder { Symbol(encoder): true }

Node.js v24.16.0
```
isolate:
```
TextEncoder2 {}

Node.js v24.0.0
```

### program
```js
throw Object.assign(new Error('y'), { dec: new TextDecoder() });
```
Node v24.16.0 (`node:*` frames dropped):
```
<root>/m.js:1
throw Object.assign(new Error('y'), { dec: new TextDecoder() });
^

Error: y
    at Object.<anonymous> (<root>/m.js:1:21)
    at [eval]:1:108
  dec: TextDecoder {
    Symbol(decoder): true,
    Symbol(flags): 0,
    Symbol(encoding): 'utf-8',
    Symbol(kIgnoreBOM): false,
    Symbol(kFatal): false,
    Symbol(kUTF8FastPath): true,
    Symbol(handle): undefined,
    Symbol(single-byte): undefined,
    Symbol(chunk): null,
    Symbol(BOM seen): false
  }
}

Node.js v24.16.0
```
isolate:
```
Error: y
    at Object.<anonymous> (<root>/m.js:1:21)
    at [eval]:1:108 {
  dec: TextDecoder2 {}
}

Node.js v24.0.0
```

## Workbench bundles (not swept for reachability)

`packages/workbench/dist/assets/*.js` (2026-11-23): `class Server2` (the
`net.createServer()` class, `packages/net/src/register-builtins.ts`; its
PR #425 fix was withdrawn — no CI lane builds these bundles), `var Worker2 =
class`, `function setTimeout2`, and isomorphic-git's bundled npm `buffer@6.0.3`
`function Buffer2`. Whether the guest of the no-COI SDK or the COI Workbench
reaches any of them in a prod build is not established (the browser carriers
run the dev server).

## `.name` sweep (isolate, every builtin module export and listed globals)

`require('module').builtinModules` (no `_`/internal), each exported function's
`name`, plus globals `setTimeout`…`Buffer`: 113 of 404 differ from Node; 39
are bundler suffixes:

```
path.isAbsolute: rifty isAbsolute2 node isAbsolute
path.dirname: rifty dirname2 node dirname
path.basename: rifty basename2 node basename
path.extname: rifty extname2 node extname
path.parse: rifty parse4 node parse
path.format: rifty format2 node bound _format
path/posix.isAbsolute: rifty isAbsolute2 node isAbsolute
path/posix.dirname: rifty dirname2 node dirname
path/posix.basename: rifty basename2 node basename
path/posix.extname: rifty extname2 node extname
path/posix.parse: rifty parse4 node parse
path/posix.format: rifty format2 node bound _format
util.TextEncoder: rifty TextEncoder2 node TextEncoder
util.TextDecoder: rifty TextDecoder2 node TextDecoder
util/types.isAnyArrayBuffer: rifty isAnyArrayBuffer2 node 
querystring.parse: rifty parse5 node parse
querystring.stringify: rifty stringify3 node stringify
querystring.encode: rifty stringify3 node stringify
querystring.decode: rifty parse5 node parse
url.parse: rifty parse6 node urlParse
url.format: rifty format3 node urlFormat
url.resolve: rifty resolve2 node urlResolve
buffer.atob: rifty atob2 node atob
buffer.btoa: rifty btoa2 node btoa
timers.setTimeout: rifty setTimeout2 node setTimeout
timers.clearTimeout: rifty clearTimeout2 node clearTimeout
timers.setInterval: rifty setInterval2 node setInterval
timers.clearInterval: rifty clearInterval2 node clearInterval
os.version: rifty version2 node getOSVersion
os.uptime: rifty uptime2 node wrappedFn
diagnostics_channel.channel: rifty channel2 node channel
global.setTimeout: rifty setTimeout2 node setTimeout
global.setInterval: rifty setInterval2 node setInterval
global.queueMicrotask: rifty queueMicrotask2 node queueMicrotask
global.atob: rifty atob2 node atob
global.btoa: rifty btoa2 node btoa
global.TextEncoder: rifty TextEncoder2 node TextEncoder
global.TextDecoder: rifty TextDecoder2 node TextDecoder
global.DOMException: rifty DOMException2 node DOMException
```

The other 74 are rifty implementation names where Node has its own (`os.homedir` Node `wrappedFn`, `fs.ReadStream` rifty `FileReadStream`, `util/types.isInt8Array` rifty `''`, `tls.Server` rifty `TlsThrow`).
