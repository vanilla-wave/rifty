---
area: runtime-js
status: parked
title: node:util pure-JS surface completions
created: 2026-06-20
why: Batch of node:util methods absent from default export — all pure-JS (no platform dep), several reuse existing machinery (assert deepEqualImpl, util.deprecate, os errno table); parseArgs the headline (modern CLIs drop minimist/yargs for it).
user_story: As a CLI author, I want util.parseArgs (+styleText, isDeepStrictEqual, MIMEType…), but today they're missing from util.ts → real Node CLIs throw / divergent
sources: [docs/research/node-parity-gaps-unbacklogged-2026-06-20.md §5]
code: [packages/runtime-js/src/builtins/util.ts, packages/runtime-js/src/builtins/assert.ts, packages/runtime-js/src/builtins/os.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

All pure-JS, no platform dep. `process.stdout.isTTY=false` (process.ts:102) → color-gating off by default, Node-faithful for non-TTY.

| Feature · since | Real path | Anchor / fidelity |
|---|---|---|
| **parseArgs** v18.3/v20 (HEADLINE) | port Node's plain-JS parser: strict errors, tokens, multiple, short, allowNegative, allowPositionals | new in util.ts · low |
| styleText v20.12/v22 + stripVTControlCharacters v16.11 | ANSI SGR table + Node's exact ansi-regex; validateOneOf on bad format | low |
| isDeepStrictEqual v9 | re-export assert.ts deepEqualImpl (assert.ts:69) strict=true→bool; verify typed-array/boxed/Map/Set | low |
| getSystemErrorName/Map/Message v9.7/v16/v23.1 | negate os.ts errno table (positive-keyed) → neg-errno→[code,msg] + libuv msg strings | **med** — sign+msg byte-exact |
| MIMEType/MIMEParams v19.9 | hand-built WHATWG MIME parser | low |
| aborted v17.3 | Promise + signal.addEventListener('abort',…,{once}); WeakRef-to-resource optional | low |
| parseEnv v21.7 | dotenv line parser — Node's quirks (multiline-quoted, export-prefix, #), NOT npm dotenv | **med** |
| getCallSites v22.9 | Error.prepareStackTrace→CallSite (V8, D-001); sourceMap/eval-origin = throw-if-requested subset | **med** |
| toUSVString v11 | lone-surrogate→U+FFFD regex | low |
| isArray/_extend v0.6 (deprecated) | Array.isArray / own-enum copy; warn via deprecate() (util.ts:184) | low |

**Excluded** (the silent-divergence BUGS — inspect options-misread + single-quote, util.format %c — are already fixed; that item is closed). This item still owns the inspect option-fidelity SURFACE: Node-default depth (2), colors, getters, sorted, breakLength, numericSeparator, maxArrayLength, inspect.custom, defaultOptions. **formatWithOptions** stays blocked on inspect-options (would silently drop opts → lying stub) — land with them.

## Options or Next

Parity-first, per-feature promotable. Per feature: failing parity test (real Node oracle) → implement → matrix ❌→✅. Order: parseArgs (strict/tokens/multiple/short suites first), then near-free isDeepStrictEqual + styleText/strip, then errno trio (byte-exact msgs), parseEnv, getCallSites (subset edges throw NotImplementedError), MIMEType, deprecated tail.

## Reversibility

REVERSIBLE — recorded in this backlog item. Each landed method = additive public API on util default export.
