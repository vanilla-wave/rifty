---
area: runtime-js
status: draft
title: Node's builtin alias members exist in rifty as the same function objects
created: 2026-11-17
why: an alias-identity sweep (Node v24.16.0) finds Node aliases rifty lacks — silent `undefined` — or implements as a different behavior (`Buffer#toLocaleString`)
sources: [docs/process/rules/fault-classes.md §Boundary failure models (builtin prototype → guest subclass/patch)]
code: [packages/io/src/buffer-prototype.ts, packages/runtime-js/src/builtins/console.ts, packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/crypto.ts]
---

## Context

REV-12 discovery of the `on === addListener` alias unit (branch
`t3/w1-eventemitter-alias`), which fixed the one alias pair built as a
forwarding twin (`EventEmitter#on`/`off`). Parity-runner sweep: every own
function-valued key sharing one function object on each builtin module and its
exported prototypes, Node vs rifty (default CJS harness); spot checks:
`Buffer.from('hi').toLocaleString()` Node `"hi"`, rifty `"104,105"`;
`typeof buf.readUint8` `function` / `undefined`; `typeof fs.Dir.prototype.entries`
`function` / `undefined`; `typeof crypto.getDiffieHellman` `function` / `undefined`.

| Node alias (same object) | rifty |
|---|---|
| `Buffer#readUInt8 = readUint8` … all `[read\|write](U)Int*`/`BigUInt64*` lowercase forms | lowercase forms `undefined` |
| `Buffer#toLocaleString = toString` | `Uint8Array#toLocaleString` (`"104,105"`, Node: decoded text) |
| `Buffer#inspect = [util.inspect.custom]` | both `undefined` |
| `console.Console.prototype.dirxml = log`, `group = groupCollapsed` | `Console.prototype` has no methods (instances own them; Node has both) |
| `fs.Dir#entries = [Symbol.asyncIterator]` | `entries` absent |
| `crypto.createDiffieHellmanGroup = getDiffieHellman` | both absent |

Covered elsewhere: `path._makeLong` (`runtime-js/path-win32-namespace`),
`util.MIMEType` (`runtime-js/util-surface-completions`); `cluster`/`sys`
are loud stubs; `http`/`net` aliases live in `@riftydev/net` (not swept).

## Next

Owner runtime-js. Trigger: a consumer calling a lowercase `Buffer` accessor or
`buf.toLocaleString()`, or the next builtin-surface unit. Parity first: a
per-module identity case like `events/listener-alias-identity`.
