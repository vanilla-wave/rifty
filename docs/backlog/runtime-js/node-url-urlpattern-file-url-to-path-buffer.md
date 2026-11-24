---
area: runtime-js
status: draft
title: "`url.URLPattern` and `url.fileURLToPathBuffer` exist as in Node"
created: 2026-11-24
why: rifty's `node:url` has neither member on any host (`typeof url.URLPattern` → `'undefined'`; `import { URLPattern } from 'node:url'` a link-time SyntaxError), Node v24.16.0 has both
sources: [docs/adr/runtime-js/0574-generate-legacy-node-url-and-node-querystring-from-pinned-node-sources.md, docs/adr/runtime-js/0443-named-loud-builtin-members-for-linked-unsuppliable-edges.md, docs/adr/runtime-js/0464-named-loud-members-for-charted-unclaimed-mode-ceilings.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/url.ts, packages/runtime-js/src/builtins/url-legacy/bindings.ts]
---

## Context

Found by the legacy `node:url` port (ADR-0574, 2026-11-24). Node v24.16.0:
`node -e "const u=require('url'); console.log(typeof u.URLPattern, typeof u.fileURLToPathBuffer, Object.keys(u).join())"`
→ `function function Url,parse,resolve,resolveObject,format,URL,URLPattern,URLSearchParams,domainToASCII,domainToUnicode,pathToFileURL,fileURLToPath,fileURLToPathBuffer,urlToHttpOptions`.
rifty's `url.ts` exports the same keys without these two (named in compat modules.md's `node:url`
row and a `url.ts` comment; at runtime a silent `undefined`). The generated `lib/url.js` exports
them; `bindings.ts` binds `url_pattern` to `{}` and `url.ts` drops them. Node differs from a thin
wrapper: `url.fileURLToPathBuffer('file:///a%FF')` → `<Buffer 2f 61 ff>` while `fileURLToPath`
throws `URIError: URI malformed` on it. In the isolate guest the global `URLPattern` is the named
gap `isolate-host.URLPattern` (isolate-host.md); Chromium's `URLPattern` vs Node's (ada) is not
measured.

## Question

Real members, or named-loud members (ADR-0443, with ADR-0464's correction for a member a ❌
mode reaches first)? Trigger: a package reading either member.
