---
area: shell
status: draft
title: rifty wc prints the byte count before the char count when -c and -m are both selected
created: 2026-11-17
why: `wc -c -m` / `wc -m -c` columns come out bytes-then-chars, GNU prints chars-then-bytes, so a script reading wc columns gets the wrong count
sources: [docs/backlog/shell/byte-exact-command-output.md]
code: [packages/shell/src/commands/wc.ts, packages/shell/tests/wc.test.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode sweep (2026-11-17), not a BOM defect.
`wc.ts` builds columns lines, words, bytes, chars — file rows `formatRow`
(:56-59), stdin row duplicated (:109-112). GNU order is fixed regardless of flag
order: `wc --help` (coreutils 9.1, docker node:24) "always in the following
order: newline, word, character, byte, maximum line length".

Probe, input `h\xc3\xa9\n` (3 chars, 4 bytes):
- GNU coreutils 9.1, `LC_ALL=C.UTF-8`: `wc -c -m f` and `wc -m -c f` →
  `3 4 /tmp/f`; `printf … | wc -c -m` → `      3       4`.
- rifty @ c1dbce6e2 (wc builtin + MemoryFsSync, Node v24.16.0): `wc -c -m /f`
  and `wc -m -c /f` → `4 3 /f`; stdin → `4 3`.
- Sweep (real Shell): `wc -l -w -m -c /b.txt` rifty ` 2  4 23 20`, GNU C.UTF-8
  ` 2  4 21 23` (chars also BOM-skewed; sweep probe 2026-11-17, docker node:24).
Default C locale hides it (GNU chars = bytes: `4 4`).
`wc.test.ts:48` pins `-c` and `-m` only separately; no combined-order case.
Stdin column width is a separate item: `shell/wc-stdin-column-width`.
Fault: plain GNU output divergence, no boundary class; twin column assembly
(:56-59 vs :109-112) — fix both or share one.
Compat: no wc row (`shell.md` lands with PR #401).
Dedup: git grep docs/backlog, docs/process/traps.md, docs/adr/README.md
§Declined for wc/wc.ts/formatRow/column order — no match. Nearest:
`byte-exact-command-output` (wc -m/-w BOM count, same file),
`stdin-filter-modes-for-builtins` (wc stdin mode).

## Next

Owner shell; trigger: `byte-exact-command-output` pickup (edits wc.ts:35) or a
user wc-column report. RED first: `/u.txt` = `hé\n`, `wc -c -m` and `wc -m -c`
→ `3 4 /u.txt`; stdin `wc -m -c` → chars column first (width = adjacent issue).
