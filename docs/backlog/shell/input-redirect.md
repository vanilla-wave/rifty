---
area: shell
status: parked
title: Shell input redirect (`cmd < file`)
created: 2026-06-08
why: `<` tokenized but throws — no stdin-from-file wiring; explicit M12 item
sources: []
---
## Context
m10-tooling ❌. Tokenizer emits `<` as a standalone token; runSegment throws `NotImplementedError('shell.input-redirect', 'use bash via wasi for < input redirect — M12 work item')` (shell.ts:144). Loud, not silent. Workaround today: run bash via WASI.
## Options / Next
M12 work item. Next: extract trailing `< file` (mirror existing `>`/`>>` trailing-redirect extraction in runSegment), read file via FsSync, feed bytes as command stdin. Couples to pipes work (both need a stdin path). Decide buffered string vs io Readable — keep consistent with the pipes decision.
## Reversibility
REVERSIBLE — internal to packages/shell; reuses existing redirect-extraction + FsSync read. No new dep, no cross-package API.
