---
area: kernel
status: parked
title: Host-operator resource enforcement policy
created: 2026-06-12
why: hard resource controls need a kernel public-behavior design, separate from the shipped trust-model documentation
user_story: As a dev fanning out many child processes/Workers (test-runner, build), I want a cap that queues or throttles excess spawns plus a wall-clock watchdog to kill runaways, but today `ProcessManager` enforces no concurrency cap, queue, timeout, or memory/egress policy.
sources: [docs/public/trust-model.md, docs/research/open-webcontainers-alternative-2026-06.md, ADR-0011, ADR-0045]
code: [packages/kernel/src/spawn-worker.ts, packages/kernel/src/process-manager.ts]
---

## Context

The public trust model now documents the current boundary: cooperative browser-local execution,
cross-origin isolation as a SharedArrayBuffer prerequisite, and no VM-grade hostile-code
containment. Future host-operator policy work still needs to decide how Worker-backed processes are
created and governed. `ProcessManager` owns lifecycle state and Worker handles expose
kill/terminate paths, but there is no enforced cap, queue, wall-clock watchdog, memory accounting,
or fetch/egress policy.

## Options or Next

- Design a host-operator policy surface for concurrent Worker/process caps.
- Decide whether excess spawns reject, queue, or throttle, including test-runner fan-out behavior.
- Add wall-clock watchdog cleanup and a clear kill-switch path around Worker-backed processes.
- Record what memory signals are actually available in target browsers before claiming accounting.
- Define fetch/egress policy separately from preview routing and service-worker ownership.

## Reversibility

IRREVERSIBLE when taken up - changes kernel public behavior and likely host configuration. Requires
a new ADR before implementation.
