---
area: toolchain-build
status: draft
title: TS language service VFS host decodes UTF-16 BOM sources as UTF-8
created: 2026-11-17
why: rifty LS reports TS1490 "File appears to be binary." on a UTF-16-with-BOM .ts file where real TS type-checks it
sources: [ADR-0166, docs/backlog/playground/binary-file-content-type-detection.md]
code: [packages/ts-language-service/src/vfs-ts-host.ts, packages/ts-language-service/src/host.ts, packages/ts-language-service/src/parity.test.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17).
`vfs-ts-host.ts:11` `new TextDecoder('utf-8')` feeds `readFileUtf8` (:15-19),
the package's only VFS text decode for LS snapshot/readFile, module resolution and tsconfig
(`host.ts:108/166/181`, `tsconfig.ts:22/52`, `lib-dts.ts:244`). TS 5.9.3
`sys.readFile` (typescript.js:8525-8549) sniffs `FE FF` (:8533, byte-swap) and
`FF FE` (:8542) → utf16le, `EF BB BF` (:8545) → strip; else utf8. UTF-8 BOM
strip already matches (TextDecoder default) — keep it.

Probe (Node v24.16.0, typescript 5.9.3, `/tmp/tsls-utf16-*`): `a.ts` =
`FF FE` + utf16le `const x: number = "s";\n`, strict.
Gold `ts.createLanguageService` over `ts.sys.readFile` → syntactic `[]`,
semantic `TS2322 Type 'string' is not assignable to type 'number'.`
rifty `createTsLanguageService` (Memory VFS, workspace TS) → syntactic
`TS1490 File appears to be binary.` at 0:0, semantic `[]`.
Fault: corrupt-input (wrong-codec decode) at the LS host read boundary.

Dedup: `git grep -i 'utf-?16|utf16le|readFileUtf8|vfs-ts-host|BOM'` over
docs/backlog, traps.md, adr/README.md → no LS item; adjacent only
`playground/binary-file-content-type-detection` (Monaco open path NUL sniff,
different code).

## Next

Owner toolchain-build (ts-language-service); trigger: an LS claim over a
project with UTF-16 sources. RED first: `parity.test.ts` fixture with the
`FF FE` file above (plus `FE FF` twin), gold vs rifty diagnostics.
