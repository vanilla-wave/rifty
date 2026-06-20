---
area: runtime-js
status: parked
title: node:assert/console/os completions
created: 2026-06-20
why: test-staple assert matchers reuse existing AssertionError/deepEqualImpl/matchesExpected; os constants are fictional-ABI-consistent strings; none in any catch-all (lists only os.setPriority)
user_story: As a dev running a Node test suite / build tool in rifty, I want assert.match/ifError/rejects + assert.throws(fn,{code}) + os.machine/devNull/version, but today they're absent and the test crashes ReferenceError
sources: [research/node-parity-gaps-unbacklogged-2026-06-20.md §9, docs/adr/runtime-js/0026-*]
code: [packages/runtime-js/src/builtins/assert.ts, packages/runtime-js/src/builtins/console.ts, packages/runtime-js/src/builtins/os.ts]
---

## Context

Verified absent in code + absent from all backlog/catch-alls. Reuses existing `AssertionError` (assert.ts:6), `deepEqualImpl` (assert.ts:69), `matchesExpected` (assert.ts:146); os arch/type (os.ts:32/36, ADR-0026).

| feature · since | real path | effort/fidelity |
|---|---|---|
| assert.match / doesNotMatch · v13.6 | `RegExp.test` over string arg, AssertionError op='match'; ERR_INVALID_ARG_TYPE non-string | S/low |
| assert.ifError · v0.1 | throw value when !=null, **preserve `original.stack`** | S/low |
| assert.rejects / doesNotReject · v10 | await promise/fn, reuse matchesExpected, throw on resolve | M/low |
| assert.throws object/Error-instance expected · v0.1 form | extend matchesExpected (RegExp+fn only today) → deep-key-subset compare validation obj / Error msg+name+own-props | M/**med** |
| assert.partialDeepStrictEqual · v23.4 exp | recursive subset over deepEqualImpl | M/**med** |
| console.dirxml · v8.3 | non-DOM → exact alias to existing `log` (console.ts:165) | S/low |
| os.machine · v18.9 | const `'wasm'` (consistent arch(), ADR-0026) | S/low |
| os.devNull · v16.3 | const `'/dev/null'` (type()='Linux', no VFS routing) | S/low |
| os.version · v13.11 | fixed kernel string consistent w/ release()/type() | S/low |

DEPRIORITIZED: assert.CallTracker (DEP0173), assert.snapshot (v22.3 exp, test-runner-coupled).

## Options or Next

Parity-first, per-feature promotable: write failing parity test vs real Node, then implement. Land the S/low row pairs together (match+doesNotMatch, rejects+doesNotReject). Pin assert.throws-object + partialDeepStrictEqual subset semantics (RegExp-inside-object, missing-key, Map/Set subset) against parity-runner before coding — fiddly. os constants are REVERSIBLE → CHANGELOG line each.

## Reversibility

REVERSIBLE — recorded in this backlog item.
