---
area: runtime-js
status: draft
title: CJS loader lifecycle must not be writable through the guest module object
created: 2026-07-27
why: the registry record is the object guest code receives as `module`, so a guest write to the loader-private `state` field changes what the next `require()` does
user_story: As a Node program that assigns to an unknown property on its own `module` object, I want the loader's behaviour to stay unchanged like it does in Node, but today writing `module.state` makes the next `require()` re-execute the module and duplicate its side effects.
sources: [ADR-0325, Node-v24.16.0-probe]
code: [packages/runtime-js/src/module-loader/registry.ts, packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

ADR-0325 makes one `ModuleRegistry` record the sole CJS metadata owner AND the
object guest code receives as `module`. Loader bookkeeping (`kind`, `state`,
`slots`, `error`) is now non-enumerable, so `Object.keys(module)` matches Node —
but the fields remain writable. `executeCjs` reads `existing.state` for the
cache decision: `'loaded' | 'loading'` returns the cache, anything else
re-initialises and re-executes the module body.

So `module.state = 'errored'` (or any other value) from guest code makes the
next `require()` of that id run the module again — duplicated side effects,
two instances of what should be one singleton. Node has no such property; a
write there is inert.

Found while fixing the enumeration gap (PR #201 review). Deliberate mutation of
an undocumented field, so ordinary programs do not hit it — recorded rather
than silently fixed, because the honest repair moves loader lifecycle off the
guest-reachable object and touches ~57 call sites in the module loader.

## Fork to settle

Whether the loader keeps one object and makes lifecycle unreachable (symbol or
closure-held accessors), or splits the internal record from the guest module
object while keeping ADR-0325's single-owner rule for Node-visible metadata.
Both must preserve record identity, cycle visibility, and failed-load unlink.
