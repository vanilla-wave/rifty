---
area: runtime-js
status: draft
title: Isolate-host guest TextEncoder allocates 3 bytes per char, so large strings hit the memory limit
created: 2026-11-18
why: The guest shim's `TextEncoder.encode` sizes its buffer at 3× the string length before slicing, so an ASCII string near the heap limit dies where Node succeeds.
sources: [docs/public/compat/isolate-host.md]
code: [packages/isolate-host/src/guest/text-codec.ts]
---

## Context

`runCode("Buffer.from('x'.repeat(64 << 20))", { memoryLimitMb: 256 })` →
`{exitCode: null, termination: 'memory'}`; `node -e` with the same code
succeeds. `encode` allocates `s.length * 3` bytes and then copies out the
written prefix, so a 64 MiB ASCII string needs 192 MiB + the result + the
string. Found by the PR #405 cross-review (round 2). Fix direction: measure
the needed length first (or grow geometrically), or encode in chunks.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
