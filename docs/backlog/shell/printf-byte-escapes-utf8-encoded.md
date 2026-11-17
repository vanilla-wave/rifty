---
area: shell
status: draft
title: printf writes \xHH and \NNN escapes as UTF-8-encoded code points instead of raw bytes
created: 2026-11-17
why: rifty `printf '\xef\xbb\xbf' > f` writes c3 af c2 bb c2 bf where bash writes ef bb bf, so a printf byte escape >= 0x80 can't produce a raw byte (no BOM or binary file via printf)
sources: [ADR-0198, docs/backlog/shell/byte-exact-command-output.md]
code: [packages/shell/src/commands/printf.ts, packages/shell/src/shell.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17). Byte/char conflation,
not BOM stripping. `printf.ts:32` (`\xHH`) and `:39` (`\NNN`) append
`String.fromCharCode(byte)`; `:121` writes the string; `shell.ts:764` `emit`
UTF-8-encodes it, so byte 0x80..0xff becomes 2 bytes. The ADR-0198 byte plane is fine;
printf never hands it bytes.

Probe (rifty `Shell` + `MemoryFsSync`, `node --experimental-transform-types`,
Node v24.16.0; `printf … > /p.bin`, hex of file): `'\xef\xbb\xbf'` and
`'\357\273\277'` → `c3afc2bbc2bf`; `'\xff'` → `c3bf`; `'A\x42'` → `4142`.
Darwin bash 3.2.57 builtin `printf … | xxd -p`: `efbbbf`, `efbbbf`, `ff`.
Fault: corrupt-input (extra bytes) at the printf → shell byte-plane boundary.

Dedup: searched printf/`\x`/fromCharCode/byte in docs/backlog, traps.md,
adr README §Declined. `byte-exact-command-output` covers filter input decode
(head/tail/grep), not printf output; `terminal/reference/review-2026-06-07.md`
lists other printf gaps (`\a \b \f \v`, numerics), not this. No match.

## Next

Owner shell; trigger: a script/user making a binary or BOM file via printf.
Shell-side BOM REDs meanwhile seed bytes through the VFS. RED first:
`printf '\xef\xbb\xbf\xff' > f` → bytes `efbbbfff` (bash ref), extend
`binary-transparency.test.ts`.
