---
area: shell
status: draft
title: wc pads pipe-stdin columns to width 7 like GNU
created: 2026-11-17
why: with two or more counts on pipe stdin GNU pads each column to width 7; rifty pads to the widest number's digits
sources: [docs/backlog/shell/wc-chars-bytes-column-order.md]
code: [packages/shell/src/commands/wc.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17), split from
`wc-chars-bytes-column-order`. GNU coreutils 9.1 (docker node:24):
`printf 'a\n' | wc -l -w` → `      1       1`; `wc -l -w < file` → `1 1`.
rifty: stdin row width = digits of the max count (`wc.ts:113`), so the pipe
form prints `1 1`. Fault: plain GNU output divergence. Compat: no wc row
(`shell.md` lands with PR #401). Dedup: git grep wc over docs/backlog — only
the column-order sibling.

## Next

Owner shell; trigger: a script parsing `wc` pipe output by column. RED first:
the two probe rows above.
