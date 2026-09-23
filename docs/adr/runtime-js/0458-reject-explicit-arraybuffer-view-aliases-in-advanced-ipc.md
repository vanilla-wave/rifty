# ADR 0458: Reject explicit ArrayBuffer view aliases in advanced IPC

Status: Accepted
Date: 2026-09

> TL;DR: Advanced fork IPC rejects an explicit ArrayBuffer plus a view over it before native structured clone can preserve an alias Node breaks.

## Context

ADR-0448 admitted standard structured-clone graphs; ADR-0454 kept
ArrayBuffer-backed views supported. A fresh physical Node/Rifty probe found
that `fork(...,{serialization:'advanced'})` sends an explicit ArrayBuffer and
its Uint8Array view as separate backing stores in Node, while rifty's native
structured clone retains the alias. A write through the received backing
changes the view in rifty but not Node. Executed oracle/RED and the exact
Vitest IPC census: `docs/backlog/runtime-js/reference/advanced-ipc-arraybuffer-alias-evidence.md`.

## Decision

At the existing serializer preflight, track explicit ArrayBuffer values and
backings of admitted views across the graph. If both refer to one buffer,
throw `NotImplementedError('child_process.serialization.advanced.arraybuffer-view-alias')`
before posting, independent of graph order or Map/Set nesting. Standalone
ArrayBuffer-backed views still carry the accepted type/bytes. This narrows
ADR-0448's broad graph claim and ADR-0454's ArrayBuffer-backed view claim;
their channel, JSON default and ordinary view support remain active.

Candidates: keep native structured-clone passthrough (rejected by physical
mutating-alias RED); copy a view into a fresh buffer (still guesses Node's
shape-dependent byteOffset/backing length, rejected by Node wire probes);
reject only the graph that changes data. Vitest default forks did not send
this graph in 144 measured messages, so its I4 path stays admitted.

## Consequences

- No alias can silently change the received data under a claimed advanced
  fork IPC success.
- Explicit ArrayBuffer/view alias graphs are a documented compat ❌; exact V8
  wire support requires a new differential contract if a real caller needs it.
