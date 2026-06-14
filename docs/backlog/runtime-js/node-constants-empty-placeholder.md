---
area: runtime-js
status: active
title: node:constants is an empty object — every key (O_RDONLY/signals/errno) silently reads undefined
created: 2026-06-13
why: node:constants is registered as a literal empty {} so require('node:constants').O_RDONLY and every fs/errno/signal key returns undefined silently — a direct violation of the no-placeholder rule and the lone non-loudProxy among misc-stubs; it even diverges from node:fs.constants.O_RDONLY===0 in the same repo.
user_story: As a dev whose code reads `require('node:constants').O_RDONLY` (or any errno/signal key), I want the real numeric value — but today `node:constants` is an empty `{}` so every key silently reads `undefined`.
sources: [CLAUDE.md no-silent-stubs]
code: [packages/runtime-js/src/builtins/misc-stubs.ts, packages/runtime-js/src/builtins/index.ts, packages/runtime-js/src/builtins/os.ts, packages/runtime-js/src/builtins/fs.ts]
---

## Context

node:constants is registered as `{} as Record<string,number>`. The real tables already exist in-repo: os.ts:97 has signals + errno; fs.ts:1168 has F_OK/R_OK/.../O_RDONLY/O_TRUNC/O_DIRECTORY/COPYFILE_EXCL. Node's node:constants = flattened union of os.constants.{signals,errno,priority,dlopen} + fs.constants + crypto.constants (crypto.constants does not yet exist here). loudProxy at misc-stubs.ts:8 is the honest pattern every other stub uses, but not constants. buffer-pending-statics.md covers Buffer.constants, a different surface.

## Options or Next

Preferred: populate constants by flattening the existing fs.constants + os.constants.signals + os.constants.errno into one object (single source of truth so the two surfaces never drift); omit crypto.constants until a real consumer hits them. Minimum viable: replace `{}` with loudProxy('constants') so unknown-key access throws NotImplementedError('constants.<key>') instead of returning undefined. Add a regression test asserting require('node:constants').O_RDONLY===require('node:fs').constants.O_RDONLY.

## Reversibility

REVERSIBLE — backlog item; additive pure-data population (or loudProxy swap) of one builtin export, no public API signature change.
