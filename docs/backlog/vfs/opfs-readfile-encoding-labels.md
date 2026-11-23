---
area: vfs
status: draft
title: OpfsVfs.readFile(path, encoding) decodes latin1/utf16le like Node or refuses them
created: 2026-11-17
why: the public overload maps 'latin1' to windows-1252 and strips a UTF-16 FF FE BOM via TextDecoder labels
sources: [docs/adr/runtime-js/0069-readable-set-encoding.md]
code: [packages/vfs/src/opfs.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17), same drift this
PR fixed in `Readable#setEncoding`. `opfs.ts` `decodeBytes` (:28-31) runs
`new TextDecoder(label)` for `ReadFileEncoding = 'utf8'|'utf-8'|'utf16le'|'utf-16le'|'latin1'`;
`OpfsVfs` is exported (`index.ts:10`) and `readFile(path, encoding)` (:134)
uses it. WHATWG `latin1` is windows-1252 (Node v24.16.0: `new TextDecoder('latin1').decode(Uint8Array.of(0x80))`
→ `€`, `Buffer.from([0x80]).toString('latin1')` → `\u0080`) and every label
strips a leading BOM. Latent: no prod caller passes an encoding (git grep
`readFile(…, 'latin1'|'utf16le')` empty); the `Vfs` interface lacks the
overload. Fault: sibling-drift vs io's codec. Dedup: git grep opfs/decodeBytes
over docs/backlog — no match.

## Next

Owner vfs; trigger: a caller of the encoding overload. Question at pickup:
narrow `ReadFileEncoding` to utf8 or decode via io's codec. RED first: unit
`readFile(p, 'latin1')` of `0x80` → `\u0080`.
