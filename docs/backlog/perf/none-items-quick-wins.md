---
area: perf
subsystem: runtime-js
status: draft
title: NONE-items quick-wins batch (E) — internal byte-identical perf fixes, no ADR/Q
created: 2026-06-08
why: a batch of byte-identical internal micro-fixes that ship immediately with no ADR/Q; not yet implemented (ascii-mask needs a failing parity case first)
user_story: As a dev paying repeated overhead in `require('express')`, I want hoisted UTF8 codec singletons, EventEmitter single-listener fast path, and dir-dedup linker writes — but today these micro-wins (and the `& 0x7f` ascii mask) are unimplemented, so every call re-pays the cost.
sources: [perf-audit §4/§3, adr-plan E (#1/#2/#4/#6/#7/#9/#22a/#27/ascii-mask)]
---
## Context
Reversible, internal, byte-identical small wins (CLAUDE.md "always reversible" / NONE class). Ship immediately; no ADR/backlog item. Spans io/vfs/module-loader/npm-client/net/runtime-js. ascii-mask is a parity-driven correctness fix (not a design fork) and needs a FAILING parity case written first.
## Options / Next
- #1 codec singletons — hoist module-level UTF8_ENCODER/UTF8_DECODER (buffer-codec.ts:25,59 + net.ts:34/121, server.ts:148); decoder stays non-fatal; leave readable.ts:116 per-stream decoder.
- #2 EventEmitter single-listener fast path (event-emitter.ts:157) — args.length switch for len===1, MUST return true, keep arr.slice() for len>1.
- #4 compute findPackageScope once, pass pkg.type into detectKind (resolver.ts:639/640/658) — both fns module-private, byte-identical.
- #6 drop redundant outer normalizePath on resolvePath relative branch (fs.ts:41) — `return joinPath(getProcessCwd(), str)`; do NOT guard inside exported joinPath (45+ callers → IRREVERSIBLE). chdir+relative-readFileSync parity case.
- #7 Linker per-package dir-dedup (Set of distinct parents, mkdir each once) + Promise.all writes (linker.ts:42-47); multi-dir-package install test is the gate.
- #9 net micro-fixes: net.ts:120 single `new URL`; server.ts:145-153 pre-sized Uint8Array body; request.ts:80 lazy headers as WRITABLE data property (not a getter — Express/proxy reassigns req.headers={...}). Gate = Express req.headers reassign test. Plus route-preview.ts skip `new Headers(data.headers)` (CORP/COEP defaulting on the record, pass to new Response directly).
- pickBestVersion linear max-scan (semver.ts:282-286) via existing compare; byte-identical selection; optional (name|range) memo; guarded by semver.test.ts:61 + ^4→4.21.2.
- #22 fix(a) drop redundant page-side re-copy, push frame.data directly (preview-port.ts:385-387) — BroadcastChannel already structured-cloned; guarded by 5×64 KiB round-trip test.
- #27 nextTick drain shift()→head-cursor (process.ts:33-44) — keep the then-wrapper, no empty-queue elision (breaks nextTick-before-then ordering, event-loop.test.ts:29-36).
- ascii-mask: ascii decode `& 0x7f` 7-bit mask (buffer-codec.ts:72-74) — toString('ascii') diverges from Node for bytes ≥0x80; FAILING parity case FIRST; does not contradict ADR-0030.
## Reversibility
REVERSIBLE — all NONE class (internal, byte-identical, small). No ADR/backlog item. ascii-mask + non-UTF-8 parity gates owned by open-verification-gaps. No decision subagent.
