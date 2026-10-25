---
area: runtime-js
status: draft
title: Advanced IPC view Proxy prototypes can change successful-send bytes and branding
created: 2026-09-29
why: Descriptor traps resolving a view constructor execute after structured clone; Node reads the constructor before copying the view
sources: [docs/adr/runtime-js/0480-refuse-advanced-ipc-view-constructor-accessors.md, docs/backlog/runtime-js/reference/pr-353-repair-evidence.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/internal/node-ipc-advanced.ts]
---

## Context

PR #353 repair sibling sweep. A typed array can have a Proxy prototype while
remaining a genuine ArrayBuffer view. Node's constructor Get invokes `get`;
rifty's post-clone descriptor lookup invokes `getOwnPropertyDescriptor`.
Neither proves the constructor/bytes Node would observe. Accessor refusal
(ADR-0480) covers ordinary own/inherited getters, not Proxy traps.
Executed probe: repair evidence §Proxy prototype. The browser has no native
Proxy-brand predicate; refusing every custom prototype would also remove the
already proven typed-array subclass baseline. No replacement chosen.

Boundary: owned in-process graph projection; `observable-order`,
`provenance-lie`. Transport loss/duplication/reorder physically excluded here.
Dedup: ADR-0448 and its evidence cover a Proxy *message* refusal, not a Proxy
prototype on a clonable view; no existing finding found.

Owner: runtime-js advanced IPC codec. Trigger: a real fork IPC program uses
Proxy-prototype views, or a goal claims this shape. Explicit compat warning;
not part of the ordinary constructor-accessor repair or vitest pool frames.
