---
area: runtime-js
status: draft
title: VM returns lose exotic brands and Error metadata
created: 2026-09-23
why: QuickJS return marshalling exposes ordinary objects instead of native exotic backing slots
sources: [docs/backlog/runtime-js/reference/advanced-ipc-proxy-provenance-evidence.md, docs/backlog/runtime-js/reference/worker-fatal-terminal-evidence.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/vm/membrane.ts]
---

## Context

Explicit QuickJS `runInNewContext` returns ordinary-object mirrors for
ArrayBuffer, DataView and boxed Boolean/Number/String. Native Node24.16.0
retains their brands. The loss precedes advanced IPC; its codec now retains
real intrinsic backings across realm/prototype boundaries. Same VM omissions
exist on baseline ec65eec40, confirmed independently.

Owner: runtime-js/vm/membrane. Trigger: a scenario returning these values from
a VM context. Compat ❌ explicit; exact native/rifty commands in evidence.
No speculative implementation prescribed. Fault class: sibling-drift across
in-process exotic projection; no transport faults. Dedup across VM/QuickJS
backlog, epic maps, traps and declined index found no existing owner.

Worker-failure sweep also measured loss before projection: guest TypeError own
code, requireStack and custom data disappear at VM return; its QuickJS stack
format lacks the native message header. Native and rifty were inspected inside
the child before throwing, so terminal serialization is not the loss owner.
The Worker projector preserves metadata actually present on its host input.
