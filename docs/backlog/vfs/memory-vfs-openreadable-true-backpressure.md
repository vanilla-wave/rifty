---
area: vfs
status: active
title: True backpressured MemoryVfs.openReadable (await drain) + 50 MiB heap-delta benchmark
created: 2026-06-13
why: MemoryVfs.openReadable pull() enqueues each chunk without awaiting any drain, so the TL;DR 'true backpressured streaming' overstates the memory backend; the heap-delta benchmark is also unbuilt.
user_story: As a dev piping a large MemoryVfs file through a slow consumer expecting real flow control, I want `openReadable` to pause until the sink drains, but today `pull()` enqueues every chunk eagerly so memory balloons instead of backpressuring
sources: [ADR-0020]
code: [packages/vfs/src/memory.ts, packages/vfs/src/opfs.ts]
---

## Context

MemoryVfs.openReadable's pull() synchronously controller.enqueue(...) with no await on writer.ready/drain — a slow consumer can only pause within the ReadableStream's internal queue, not via real flow control. ADR-0020 names the follow-up verbatim ('reader currently pulls eagerly; follow-up wraps the read loop in await writer.ready'). Scope is the MEMORY backend only: OpfsVfs.openReadable returns slice.stream() (real File.stream() backpressure). Second half is the missing 50 MiB heap-delta regression benchmark (ADR-0020) — none exists in packages/ or tools/. Today only a structural conformance test (>=4 data events on a 256 KiB file) guards regressions. No vfs backlog item covers openReadable/streaming-read.

## Options or Next

1) Wrap the MemoryVfs read loop so production awaits the consumer's drain/ready signal, matching real-Node pause/resume on a slow sink. 2) Add the 50 MiB heap-delta benchmark gated via a diagnostic baseline (not CI assert, like perf/reference benches). Write a parity/backpressure case first per the regression-test rule before any read-loop change.

## Reversibility

REVERSIBLE — backlog item; behavior-preserving for fast consumers, internal scheduling of MemoryVfs.openReadable, no public signature change.
