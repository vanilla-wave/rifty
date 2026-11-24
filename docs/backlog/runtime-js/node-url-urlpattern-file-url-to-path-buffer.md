---
area: runtime-js
status: draft
title: "`url.URLPattern` and `url.fileURLToPathBuffer` exist as in Node"
created: 2026-11-24
why: rifty's `node:url` has neither member on any host (`typeof url.URLPattern` → `'undefined'`), Node v24.16.0 has both
sources: [docs/adr/runtime-js/0574-generate-legacy-node-url-and-node-querystring-from-pinned-node-sources.md]
code: [packages/runtime-js/src/builtins/url.ts]
---

## Context

Found by the legacy `node:url` port (ADR-0574, 2026-11-24). Node v24.16.0:
`node -e "const u=require('url'); console.log(typeof u.URLPattern, typeof u.fileURLToPathBuffer, Object.keys(u).join())"`
→ `function function Url,parse,resolve,resolveObject,format,URL,URLPattern,URLSearchParams,domainToASCII,domainToUnicode,pathToFileURL,fileURLToPath,fileURLToPathBuffer,urlToHttpOptions`.
rifty's `url.ts` exports the same keys without `URLPattern` and `fileURLToPathBuffer` (silent
absence, not a named gap); compat modules.md `node:url` row names it. `URLPattern` is a
Chromium global (not in the isolate guest); `fileURLToPathBuffer` returns a `Buffer` path.

## Next

Owner runtime-js `node:url`. Trigger: a package reading either member. Question first: real
members (host `URLPattern`, a Buffer over `fileURLToPath`) or named-loud members (ADR-0443).
