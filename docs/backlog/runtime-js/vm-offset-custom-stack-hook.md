---
area: runtime-js
status: draft
title: VM script offsets survive custom Error.prepareStackTrace replacement
created: 2026-09-23
why: a guest replacing Error.prepareStackTrace after an offset VM script receives the encoded source URL and raw coordinates instead of Node's adjusted CallSites
sources: [ADR-0450, docs/backlog/runtime-js/reference/vm-offset-custom-stack-hook-evidence.md]
code: [packages/runtime-js/src/module-loader/source-maps.ts, packages/runtime-js/src/builtins/vm/index.ts]
---

## Context

`docs/backlog/runtime-js/reference/vm-offset-custom-stack-hook-evidence.md` runs one script against Node v24.16.0 and rifty: a delayed custom stack hook reports `/virtual/hook.js:11:` in Node and encoded `rifty-vm://...:1:7` in rifty. This follows from ADR-0450's persistent dispatcher being replaced by the guest hook. It is outside the exact Vitest run path, which reads ordinary string stacks. Runtime-js owns the gap; pick it up when a real consumer installs a custom stack hook around offset VM scripts. No carrier is chosen here.

## Final check

2026-09-23 — RDY-6 PASS, fresh read-only Codex reviewer at HEAD 7ca9012eb (draft SHA-256 `ac64e66c6295…`): probe rerun, no duplicate or missing user-owned choice. Review-record line only.
