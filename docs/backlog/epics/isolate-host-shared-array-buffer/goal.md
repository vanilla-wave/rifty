---
kind: epic
status: ready
title: Select SharedArrayBuffer access for a rifty guest
created: 2026-11-19
value: A service can withhold shared buffers from one model program and keep Node semantics for its neighbour.
tier: robust
---

## Outcome

Owner's words, replying to the manager's «SharedArrayBuffer гостю оставлен.»: «Я хочу настройку на это.»

Manager's interpretation: the caller chooses whether guest code gets SharedArrayBuffer. Preserve access by default. Side channels between tenants and timer resolution are outside this change.

## User scenario

A service evaluates two model programs with runCode in one warm worker. It denies shared buffers to the first program and permits them to the second. It alternates these policies across calls, including concurrent calls. A custom embedder makes the same choice before loading the bundle in a fresh context.

## Invariants

At 9b948d757 the public API and guest contract have no policy field. On Node 24.16.0, run the shared-array-buffer.test.ts carrier with ordinary assertions: with false, construction and wasm export both print `[object SharedArrayBuffer]`. The README embedder prints 4 in restricted and default mode.

1. I1. A restricted guest cannot obtain a shared buffer from the global, growable allocation, wasm memory (including module exports), a runtime object or its prototype chain. Manager’s 2026-11-19 amendment: the restricted global is absent as in disabled V8. Wasm operations requesting a shared backing buffer throw the named rifty gap. Ordinary ArrayBuffer, wasm and applicable Atomics operations retain their semantics.
2. I2. Restricted, explicit-allow and default calls coexist on one worker, across reuse and a solo retry. Allow and default retain the Node parity corpus.
3. I3. The packed guest in the README embedder supports this choice per fresh guest, defaulting to the existing surface.

## Challenge

challenge: 2026-11-19 — clear

## Decisions

- Robust tier covers concurrent placement and worker loss.
- rejected route: process-wide default as the only control — violates I2.
- ADR-0566 records the API. Goal closure awaits external review.
