---
area: runtime-js
status: draft
title: "`url.domainToASCII`, `url.domainToUnicode`, `url.urlToHttpOptions` and `url.format(URL, options)` behave as in Node"
created: 2026-11-24
why: rifty's `node:url` has no `domainToASCII`/`domainToUnicode`/`urlToHttpOptions` and its `format(URL, options)` ignores the options, on every host
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

2026-11-24 — `url.format(string)` (and the rest of the legacy parser) moved to
ADR-0574 (PR #444). Left here: the WHATWG-side members (Node: ada's host
parser, `bindingUrl.format`): `domainToASCII`, `domainToUnicode`, `urlToHttpOptions`, and
`format(URL, { fragment, unicode, search, auth })`.
Since PR #444 (ADR-0574 §5) each of them is a `NotImplementedError('url.<member>')`;
`format(URL, options)` only where an option changes Node's output (`url.format.options`).
