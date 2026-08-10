---
area: runtime-js
status: draft
title: node:util pure-JS surface completions
created: 2026-06-20
why: Batch of node:util methods absent from default export — all pure-JS (no platform dep), several reuse existing machinery (util.deprecate, os errno table); parseArgs the headline (modern CLIs drop minimist/yargs for it).
user_story: As a CLI author, I want util.parseArgs (+MIMEType, errno helpers…), but today those remaining methods are missing from util.ts → real Node CLIs throw / divergent
sources: [docs/research/node-parity-gaps-unbacklogged-2026-06-20.md §5]
code: [packages/runtime-js/src/builtins/util.ts, packages/runtime-js/src/builtins/assert.ts, packages/runtime-js/src/builtins/os.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

All pure-JS, no platform dep. `process.stdout.isTTY=false` (process.ts:102) → color-gating off by default, Node-faithful for non-TTY.

| Feature · since | Real path | Anchor / fidelity |
|---|---|---|
| **parseArgs** v18.3/v20 (HEADLINE) | port Node's plain-JS parser: strict errors, tokens, multiple, short, allowNegative, allowPositionals | new in util.ts · low |
| styleText v20.12/v22 + stripVTControlCharacters v16.11 | ✅ landed for package-tooling: ANSI SGR table, format validation, stream color gating, Node-shaped `validateStream` edge cases, `none` no-op, and ANSI stripping are covered in `tests/conformance/builtins/util.test.ts` | shipped |
| isDeepStrictEqual v9 | ✅ landed for package-tooling: strict Map/Set/typed-array-aware comparison is covered in `tests/conformance/builtins/util.test.ts` | shipped |
| getSystemErrorName/Map/Message v9.7/v16/v23.1 | negate os.ts errno table (positive-keyed) → neg-errno→[code,msg] + libuv msg strings | **med** — sign+msg byte-exact |
| MIMEType/MIMEParams v19.9 | hand-built WHATWG MIME parser | low |
| aborted v17.3 | Promise + signal.addEventListener('abort',…,{once}); WeakRef-to-resource optional | low |
| parseEnv v21.7 | ✅ landed for Vite 8: Node 24 byte-order, UTF-8, multiline-quoted, export-prefix, comment, malformed-input, and ordinary-result-object semantics are parity-pinned | shipped |
| getCallSites v22.9 | Error.prepareStackTrace→CallSite (V8, D-001); sourceMap/eval-origin = throw-if-requested subset | **med** |
| toUSVString v11 | lone-surrogate→U+FFFD regex | low |
| isArray/_extend v0.6 (deprecated) | Array.isArray / own-enum copy; warn via deprecate() (util.ts:184) | low |

**Excluded** (the silent-divergence BUGS — inspect options-misread + single-quote, util.format %c — are already fixed; that item is closed). This item still owns the inspect option-fidelity SURFACE: Node-default depth (2), colors, showHidden (non-enumerable + symbol keys), getters, sorted, breakLength, numericSeparator, maxArrayLength, maxStringLength (rifty truncates in-structure strings at 120 + `…`; Node's default is 10000), inspect.custom, defaultOptions. `formatWithOptions` is shipped for the existing `inspect` contract, including `depth`; it inherits these tracked option gaps and is not a claim that they are complete.

## Options or Next

Parity-first, per-feature promotable. Per feature: failing parity test (real Node oracle) → implement → matrix ❌→✅. Order: parseArgs (strict/tokens/multiple/short suites first), then errno trio (byte-exact msgs), getCallSites (subset edges throw NotImplementedError), MIMEType, deprecated tail. `styleText`, `stripVTControlCharacters`, `isDeepStrictEqual`, and `parseEnv` are no longer part of this remaining backlog surface.

## Reversibility

REVERSIBLE — recorded in this backlog item. Each landed method = additive public API on util default export.
