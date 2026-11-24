---
area: runtime-js
status: draft
title: rifty's util.format %d/%i/%f/%j/%o/%O and a lone '%%' differ from Node's
created: 2026-11-24
why: printf-style logging and Node-shaped messages print other numbers/JSON/inspect text than Node, or throw where Node prints NaN — silent, on every host (console.log shares format).
sources: ["probe 2026-11-24, unit runtime-js/util-format-percent-s"]
code: [packages/runtime-js/src/builtins/util.ts]
---

## Context

Probe 2026-11-24, live `node -e` v24.16.0 vs rifty `origin/main` b6d37fc01 (parity-runner
in-process and isolate `runCode`, same text), `util.format(fmt, v)`:

| call | Node | rifty |
|---|---|---|
| `('%d', -0)` | `-0` | `0` |
| `('%d', 5n)`, `('%i', 5n)` | `5n` | `5` |
| `('%d', Symbol())`, `('%f', Symbol())` | `NaN` | throws `TypeError: Cannot convert a Symbol value to a number` |
| `('%i', 5.7)` | `5` | `5.7` |
| `('%i', '42abc')` | `42` | `NaN` |
| `('%f', '1.5abc')` | `1.5` | `NaN` |
| `('%j', { toJSON() { throw e } })` | throws `e` | `[Circular]` |
| `('%j', 1n)` | throws `TypeError: Do not know how to serialize a BigInt` | `[Circular]` |
| `('%o', { a: [1] })` | `{ a: [ 1, [length]: 1 ] }` (showHidden, showProxy, depth 4) | `{ a: [ 1 ] }` |
| `('%O', { a: { b: { c: { d: 1 } } } })` | `{ a: { b: { c: [Object] } } }` (inspect default depth 2) | `{ a: { b: { c: { d: 1 } } } }` |
| `('%%')` (one argument) | `%%` (returned as is) | `%` |

Node (`lib/internal/util/inspect.js` `formatWithOptionsInternal`): `%d` bigint → `<n>n`,
symbol → `NaN`, else `formatNumber(Number(v))`; `%i` `NumberParseInt`; `%f`
`NumberParseFloat`; `%j` `tryStringify` (only the circular-structure TypeError becomes
`[Circular]`); `%o` `{ showHidden: true, showProxy: true, depth: 4 }`; a single string
argument is returned unformatted. The isolate's `console.log('%%')` prints `%` (Node
`%%`). `%O` depth and `%o` showHidden also hinge on inspect options
(`runtime-js/util-surface-completions`).

## Challenge

challenge: 2026-11-24 — finding capture; no premise critic (README §Challenge)
