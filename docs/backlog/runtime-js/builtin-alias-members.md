---
area: runtime-js
status: draft
title: Node's builtin alias members exist in rifty as the same function objects
created: 2026-11-17
why: an alias-identity sweep (Node v24.16.0) finds Node aliases rifty lacks — silent `undefined` — or implements as a different behavior (`Buffer#toLocaleString`)
sources: [PR #400 alias-identity sweep]
code: [packages/io/src/buffer-prototype.ts, packages/runtime-js/src/builtins/console.ts, packages/runtime-js/src/builtins/fs.ts, packages/net/src/net.ts, packages/net/src/http/response.ts]
---

## Context

REV-12 discovery of the `on === addListener` alias unit (branch
`t3/w1-eventemitter-alias`), which fixed the one alias pair built as a
forwarding twin (`EventEmitter#on`/`off`). Parity-runner sweep: every own
function-valued key sharing one function object on each builtin module and its
exported prototypes, Node vs rifty (default CJS harness, `require()`d
modules — bare `Buffer` there is the host's). Spot checks with
`const { Buffer } = require('node:buffer')`: `Buffer.from('hi').toLocaleString()`
Node `"hi"`, rifty `"104,105"`; `typeof Buffer.from('hi').readUint8`
`function` / `undefined`; `typeof require('node:fs').Dir.prototype.entries`
`function` / `undefined`.

| Node alias (same object) | rifty |
|---|---|
| `Buffer#readUInt8 = readUint8` … all `[read\|write](U)Int*`/`BigUInt64*` lowercase forms | lowercase forms `undefined` |
| `Buffer#toLocaleString = toString` | `Uint8Array#toLocaleString` (`"104,105"`, Node: decoded text) |
| `Buffer#inspect = [util.inspect.custom]` | both `undefined` |
| `console.Console.prototype.dirxml = log`, `group = groupCollapsed` | `Console.prototype` has no methods (instances own them; Node has both) |
| `fs.Dir#entries = [Symbol.asyncIterator]` | `entries` absent |
| `net.Stream = Socket` (`@riftydev/net`) | `Stream` absent |
| `http.ServerResponse#writeHeader = writeHead` (`@riftydev/net`) | `writeHeader` absent |

Covered elsewhere: `path._makeLong` (`runtime-js/path-win32-namespace`),
`util.MIMEType` (`runtime-js/util-surface-completions`); `cluster`/`sys`
are loud stubs, `domain` a loud module miss. `@riftydev/net` rows: reviewer
sweep in the `http` harness plus `git grep writeHeader packages/net/src`
(empty). Not an alias gap: the whole crypto
Diffie-Hellman/ECDH family (`createDiffieHellman`, `getDiffieHellman`,
`createECDH`, …) reads `undefined` — noted on `runtime-js/crypto-sync-subset-expansion`.

## Next

Owner runtime-js. Trigger: a consumer calling a lowercase `Buffer` accessor,
`buf.toLocaleString()`, `Console.prototype` methods or `dir.entries()`, or the
next builtin-surface unit. Parity first: a
per-module identity case like `events/listener-alias-identity`.
