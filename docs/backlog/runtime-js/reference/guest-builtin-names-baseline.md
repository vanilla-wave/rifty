# Baseline — builtin names the isolate guest prints (PR #425, 2026-11-23)

Observed at 61c69cab8 (isolate-host `runCode`, guest bundle built from that
tree) against live Node v24.16.0. Reproduce: the CLOSE reviewer's probes
(`/tmp/close425-probe/zz4.test.ts` shape: write `m.js`, `require('./m.js')`
in `-e`, compare stderr) and the names sweep below.

## Fatal report (RED for unit `runtime-js/guest-builtin-names`)

| program (`m.js`) | Node v24.16.0 | isolate |
|---|---|---|
| `r.on('data', function onData() { throw … })` on a `new Readable({ read() {} })` | `at Readable.onData (<root>/m.js:3:40)` | `at publishedConstructor.onData (<root>/m.js:3:40)` |
| `new Writable({ write(c, e, cb) { throw … } }).write('x')` | `at Writable.write [as _write] (<root>/m.js:2:51)` | `at publishedConstructor.write [as _write] (<root>/m.js:2:51)` |
| `throw new TextEncoder()` | `TextEncoder { Symbol(encoder): true }` | `TextEncoder2 {}` |
| `throw Object.assign(new Error('y'), { dec: new TextDecoder() })` | `dec: TextDecoder {` + Node's symbol state, one per line | `dec: TextDecoder2 {}` |

Cause: a constructor's source (SFI) name is what V8 and inspect print. The
streams' constructors are one generic `function publishedConstructor`
(`packages/io/src/streams/callable-constructor.ts:29`); the bundler renames a
class or function named like another binding (`TextEncoder2 = class`).

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
