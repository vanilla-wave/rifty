---
area: runtime-js
status: draft
title: "`url.format(string)`, `url.domainToASCII`, `url.domainToUnicode` and `url.urlToHttpOptions` behave as in Node"
created: 2026-11-24
why: rifty's `node:url` throws `o.search.startsWith is not a function` for `url.format('http://a.com/b?c=d')` and has no `domainToASCII`/`domainToUnicode`/`urlToHttpOptions`, on every host
sources: [PR-440, PR-440-review-round-3]
code: [packages/runtime-js/src/builtins/url.ts]
---

## Context

Found by the PR #440 review, round 3 (2026-11-24), outside its unit. Node v24.16.0:
`url.format('http://a.com/b?c=d')` → `'http://a.com/b?c=d'` (with `DEP0169` on stderr, it parses
the string); `typeof url.domainToASCII`, `domainToUnicode`, `urlToHttpOptions` → `function`.
rifty (`builtins/url.ts` imported in a node-env vitest run, the code every host ships; the isolate
guest the same in `sandbox.exec`): `TypeError: o.search.startsWith is not a function`; the three
are `undefined`. Owner: runtime-js `node:url`. Trigger: a package calling one. No compat row yet.
