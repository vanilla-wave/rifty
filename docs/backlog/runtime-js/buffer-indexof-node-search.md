---
area: runtime-js
status: draft
title: "`buf.indexOf`/`lastIndexOf`/`includes` search utf16le by bytes and coerce `byteOffset` unlike Node"
created: 2026-11-25
why: Node searches a utf16le needle by aligned 2-byte units and resolves `byteOffset` through `IndexOfOffset`; rifty scans bytes from a `??`-defaulted offset, so a match at an odd offset or a `null` offset gives a different index
sources: [docs/backlog/runtime-js/buffer-encoding-names.md]
code: [packages/io/src/buffer-prototype.ts]
---

## Context

Side finding of unit `runtime-js/buffer-encoding-names` (2026-11-25, Node v24.16.0, rifty in-process
`@riftydev/io` `Buffer`, branch `t3/buffer-encoding-names`):

| call | Node | rifty |
|---|---|---|
| `Buffer.from('xAAx','latin1').indexOf(Buffer.from('AA'), 0, 'ucs2')` | `-1` | `1` |
| `Buffer.from('xxAé').indexOf(Buffer.from('A'), 0, 'utf16le')` | `-1` (needle < 2 bytes) | `2` |
| `Buffer.from('xAAx').lastIndexOf('A', null)` | `-1` | `2` |

Node v24.16.0 `src/node_buffer.cc` `IndexOfString`/`IndexOfBuffer`: utf16le haystack length `&~1`,
search over `uint16_t` units from `offset / 2`, result `* 2`; needle < 2 bytes → `-1`. `IndexOfOffset`
and `lib/buffer.js` `bidirectionalIndexOf` (`+byteOffset`, NaN → whole buffer, clamp to int32) set the
start. rifty: `findIndex`/`findLastIndex` byte scan, `byteOffset ?? 0`. Encoding names are already
Node's (that unit). Compat `buffer.md` indexOf rows ⚠️.

## Next

Owner runtime-js. Parity case first (utf16le aligned/unaligned matches, odd haystack, every
`byteOffset` coercion: `null`, `'x'`, `{}`, negative, past end, ±2^31); the fix shape is open (port of the two Node functions is one option).
Trigger: a package searching utf16le data, or the next Buffer sweep.
