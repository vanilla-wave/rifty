---
area: runtime-js
status: draft
title: rifty's `fs.openAsBlob` reads the file eagerly, so a later overwrite of the file does not make the Blob unreadable as in Node
created: 2026-11-25
why: `fs.ts`'s comment «Eager read: observably identical to Node's lazy read for an in-memory VFS within one program» is false — Node's file-backed Blob rejects `NotReadableError` after the file changes and is not cloneable
sources: [PR-443-external-review]
code: [packages/runtime-js/src/builtins/fs.ts]
---

## Context

Node v24.16.0 (run 2026-11-25): `fs.writeFileSync(f, 'abc'); const b = await fs.openAsBlob(f);
fs.writeFileSync(f, 'xyz!'); await b.text()` → `NotReadableError: The blob could not be read`;
`structuredClone(b)` → `TypeError: Invalid state: File-backed Blobs are not cloneable`. rifty's
`openAsBlob` (`fs.ts:1080-1100`) copies the bytes at open into a plain `Blob`, so `text()` gives
`abc` (reported by the PR #443 external review; rifty side not re-run here). Every host whose
`Blob` is real; in the isolate guest it becomes reachable with goal `isolate-guest-web-api`'s
`Blob` unit, which declares it ⚠️ there (compat `isolate-host.md` row `Blob`, `File`). Owner runtime-js `fs`.

Also (measured 2026-11-25, isolate guest vs Node v24.16.0, `packages/isolate-host/tests/blob-file.test.ts`):
`fs.openAsBlob(f, { type: 'Text/X' })` → Node's `type` is `'Text/X'` (`createBlobFromFilePath`
keeps it as given), rifty's `'text/x'` (`new Blob(…, { type })` lower-cases it); on browser hosts
the native `Blob` lower-cases it the same way (not run there).

## Challenge

challenge: 2026-11-25 — not run (factual capture)
