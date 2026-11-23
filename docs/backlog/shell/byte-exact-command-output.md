---
area: shell
status: draft
title: Byte-exact text filters (head -c / tail -c / stdin filters) over the ADR-0198 byte plane
created: 2026-06-25
why: The pipeline data plane is byte-transparent since ADR-0198 (Writer accepts bytes; capture/pipes/redirects byte-exact; cat is a byte pump), but text FILTERS still decode stdin to strings — `head -c 10 < img.png` re-encodes and corrupts.
user_story: As a developer running byte-counting commands such as `head -c` or `tail -c` over binary files in rifty, I want the emitted bytes to be exactly the input slice, but today these filters decode to a string first, so invalid-UTF-8 bytes become U+FFFD.
sources: [ADR-0198, Q-2026-06-25-shell-research, ADR-0093, docs/backlog/terminal/byte-pty-mode-umbrella.md]
code: [packages/shell/src/commands/head.ts, packages/shell/src/commands/tail.ts, packages/shell/src/commands/grep.ts, packages/shell/src/commands/wc.ts, packages/shell/src/commands/_shared.ts]
---

## Context

ADR-0198 (2026-07-05) delivered the plumbing: `Writer.write(string | Uint8Array)`,
byte-exact capture → pipe hand-off → `>`/`>>` flush, `cat` emitting raw bytes
(guard: packages/shell/tests/binary-transparency.test.ts). What remains is the
COMMAND layer: filters read stdin/files as decoded strings, so byte-slicing
modes (`-c`) and pass-through portions of line filters are still lossy for
non-UTF-8 input. GNU coreutils are byte-oriented even in line mode (lines are
byte runs split on 0x0A, not decoded text).

2026-11-17 observation (REV-12, UTF-8 BOM decode fix sweep): the same decode
also drops a leading UTF-8 BOM. `_shared.ts:27` `dec = new TextDecoder()`
(`ignoreBOM:false`, one-shot) feeds grep.ts:137 (file), :172 (stdin),
head.ts:168, tail.ts:190, wc.ts:35. Probe: rifty Shell + MemoryFsSync, Node
v24.16.0, file `EF BB BF` + `hello world\nline2 x\n`, stdout `> /out.bin` hex.
GNU = grep 3.8 / coreutils 9.1, docker node:24 (sweep):
- `grep -c ^hello` rifty `1`, GNU `0`; `grep hello` (file or `cat |`) rifty
  `68656c…`, GNU `efbbbf68656c…`
- `head -n1`, `tail -n2` lose `efbbbf` (GNU keeps); `head -c3` rifty empty, GNU `efbbbf`
- `wc -m` rifty 20, GNU C.UTF-8 21; BOM-only `EF BB BF 0A` `wc -w -m` rifty
  `0 1`, GNU C.UTF-8 `1 2`, C `0 4`
Fault: corrupt-input (lossy decode) at the filter byte→text boundary. Option 2's
per-line match decode must keep the BOM too, else `^` anchors still shift.
RED trap: packages/shell/tests/_ctx.ts:8 `out()` decodes with a default `TextDecoder` (strips
BOM) — assert raw bytes.

## Options or Next

1. `head -c` / `tail -c`: slice the raw bytes, write bytes — never decode.
2. Line modes (`head -n`, `tail -n`, `grep`): split on 0x0A at the byte level,
   decode per line ONLY for regex matching; emit the original byte runs.
3. Extend binary-transparency.test.ts with per-filter byte fixtures.
4. Coordinate with stdin-filter-modes-for-builtins (shared byte readAllStdin).
5. RED first: BOM file above through grep/head/tail/wc vs the GNU bytes/counts
   (frozen GNU fixture, cf. grep-find-frozen-gnu-fixtures).

## Reversibility

REVERSIBLE — command-internal changes over the already-landed ADR-0198 contract.
