---
area: runtime-js
status: draft
title: Node errors rifty throws lack Node's `[ERR_X]` label and error class
created: 2026-11-24
why: "`String(e)`, the stack's first line, `util.inspect` and fatal reports print `TypeError: …` where Node prints `TypeError [ERR_X]: …`; code matching `e.toString()` or log parsers on the label see a different error"
sources: [docs/public/compat/isolate-host.md, docs/backlog/distribution/isolate-host-navigator-node-shape.md]
code: [packages/runtime-js/src/builtins/process-warnings.ts, packages/isolate-guest/src/guest/navigator.ts]
---

## Context

Found by `distribution/isolate-host-navigator-node-shape` (parity of
`new Navigator()`). rifty builds Node errors as `Object.assign(new
TypeError(msg), { code })` (e.g. `process-warnings.ts` `invalid`,
`web-shim.ts` `argType`, `navigator.ts`). Measured 2026-11-24, `runCode`
vs `node -e`, Node v24.16.0:

```
try { new Navigator() } catch (e) { console.log(String(e), e.stack.split('\n')[0], Object.getPrototypeOf(e) === TypeError.prototype) }
  Node : TypeError [ERR_ILLEGAL_CONSTRUCTOR]: Illegal constructor ×2, false
  rifty: TypeError: Illegal constructor ×2, true
try { process.emitWarning(1) } catch (e) { console.log(String(e)) }
  Node : TypeError [ERR_INVALID_ARG_TYPE]: The "warning" argument must be …
  rifty: TypeError: The "warning" argument must be …
```

`name`, `message`, own enumerable `code` match. Uncaught, the fatal report
prints `TypeError: Illegal constructor … { code: 'ERR_ILLEGAL_CONSTRUCTOR' }`
(Node: the labelled header). Browser hosts share the runtime code (not
measured there). No mechanism exists: each site builds its own error.
Pinned: `packages/isolate-host/tests/navigator.test.ts` declared-gap row.
Compat isolate-host.md "Node errors rifty throws" ⚠️.

## Question

One shared Node-error constructor (Node's `makeNodeErrorWithCode`: class per
base, `toString` with the label, labelled stack header) for every rifty site,
or per-site? Needs the inventory of sites and the stack-header mechanism in
both realms (V8 `Error.captureStackTrace` header vs rifty's formatter).

## Next

Owner runtime-js. Trigger: a package or test matching the `[ERR_X]` label in
`String(e)`/`stack`, or the next unit that adds a Node error site.
