---
area: perf
subsystem: toolchain-build
status: draft
title: Child fs perf real single in-realm Worker lane
created: 2026-08-26
epic: child-fs-rpc-hot-path
why: the comparison anchor needs identical guest bytes executed with fs and loader in one real Worker, without SAB RPC or a child-side cache
user_story: As the child-fs measurement rig, I want both anchors executed in one real in-realm Worker, but today that topology exists only as throwaway spike code.
sources: [perf/child-fs-perf-lane split @ fb02b2c2f, spike 1261339acc1d1eb3f864a9a48ed50bf067fe0f02, ADR-0196]
code: [tests/browser-unit/fixtures/child-fs-in-realm-worker.ts]
---

## Question

Compile after the artifact core lands: use real Memory VFS, npm tarballs,
runtime-js loader, Vite runtime adapter, Express/http listen and one fresh Worker
per sample. Port only mechanisms whose forcing constraints still hold.
Assert the same canonical tree reports exactly 2180 transformed modules.
