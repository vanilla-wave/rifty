---
area: runtime-js
status: draft
title: fs.createReadStream / fs.createWriteStream accept autoClose:false
created: 2026-11-24
why: rifty throws `NotImplementedError('fs.createReadStream.autoClose:false')` / `('fs.createWriteStream.autoClose:false')` at create; Node keeps the fd open past 'end'/'finish' until close()/destroy()
sources: [docs/backlog/runtime-js/fs-stream-close-method-missing.md, docs/public/compat/fs.md]
code: [packages/runtime-js/src/builtins/fs-streams.ts, tools/compat-matrix-generator/fs-matrix.js]
---

## Context

Discovered during `runtime-js/fs-stream-close-method-missing` (2026-11-24), which ships
`close()` for the default `autoClose: true` only. Loud today: `assertSupportedStreamOptions`
(`fs-streams.ts`) throws at create; compat fs.md ❌ "Stream unsupported options".

Node v24.16.0 (scratch script, `autoClose: false`, `closed`/`destroyed`/`fd` printed):

```
ws end only:             open | finish                        || closed=false destroyed=false fd=11
ws write; close(cb):     open | finish | close | cb closed=true destroyed=true fd=null
ws end; 'finish'; close(cb): open | finish                    || closed=false destroyed=false fd=12  (cb never called)
rs read to end:          open | end                           || closed=false destroyed=false fd=13
rs 'end'; close(cb):     open | end | cb() closed=false destroyed=true fd=null | close
```

So with `autoClose:false` WriteStream `close()` adds `on('finish', destroy)` before `end()`,
and after `'finish'` it never closes; ReadStream's callback fires before `'close'`.
Dedup: grep `autoClose` over `docs/backlog` — only the close item.

Owner: runtime-js (fs streams). Trigger: a package creating an fs stream with
`autoClose: false` (fd reuse), or the Readable conversion (`runtime-js/fs-streams-not-node-streams`).
