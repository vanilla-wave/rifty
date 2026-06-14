---
area: playground
status: active
title: Proper binary-file content-type detection in editor open path (replace NUL-byte sniff)
created: 2026-06-08
why: Binary detection is a first-8KB NUL-byte heuristic with known false positives (UTF-16) and misses (NUL-free binaries); carries a live TODO(ADR) marker
user_story: As a developer opening a VFS file in the Monaco editor, I want UTF-16 text shown and NUL-free binaries flagged correctly, but today the first-8KB NUL-byte sniff false-flags UTF-16 as binary and lets NUL-free binaries garble the editor.
sources: [ADR-0075]
code: [apps/playground/src/glue/fs-ops.ts:96]
---
## Context
Opening an arbitrary VFS file in Monaco would garble binaries. Provisional heuristic: if a NUL byte appears in the first 8 KB, open a read-only "binary file" placeholder instead of decoding. Known-imperfect — UTF-16 text false-positives; NUL-free binaries slip through. Live `// TODO(ADR)` at the binary sniff in the open-file path.
## Options / Next
Provisional: NUL-byte sniff (real impl, not a stub). Next: replace with a proper content-type detector (magic-byte / encoding sniffing). Then promote to ADR via `pnpm adr:new playground` (manual) (clears marker).
## Reversibility
Reversible — localized to the open-file path in `glue/fs-ops.ts`; no public-API/cross-package change. Provisional marker in code.
