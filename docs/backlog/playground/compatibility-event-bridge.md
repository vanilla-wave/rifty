---
area: playground
status: draft
title: Owner-authoritative compatibility event bridge to the playground page
created: 2026-06-14
why: Telemetry capture exists on runtime-js paths, but real playground runs travel through owner/kernel/shell and no owner-authoritative compatibility snapshot reaches the page, so an inspector would omit the workload users actually run.
user_story: As a developer running a real project, I want observed compatibility events from the actual owner/child execution path to reach the IDE, but today only spawnRuntime consumers can subscribe to the diagnostic event.
epic: honest-compatibility-in-the-ide
blocked_by: [playground/notimplemented-stub-telemetry]
sources: [M11, ADR-0142]
code: [packages/workbench/src/glue/realVite.ts, packages/workbench/src/glue/pty-protocol.ts, packages/runtime-js/src/host.ts, packages/runtime-js/src/worker-entry.ts, packages/runtime-js/src/telemetry/divergence-sink.ts]
---

## Context

The runtime-js controller path has sink, worker capture, loud stderr warning, and host `diagnostic` event. The playground runs guests through its persistent owner and supervised child paths instead; subscribing to a second `spawnRuntime` would produce a plausible empty lie.

Define an owner-authoritative compatibility snapshot/event feed with stable project/run identity, revision, feature id, classification, count, and original structured failure provenance. Delivery uses request/re-publish handshake discipline like `pty:preview`, so a listener mounted after a hit recovers truth. Stdout/stderr parsing and a second hidden runtime are forbidden.

This item transports captured NotImplemented/divergence facts. Structured install/native/unclassified failures remain typed and travel through `playground/structured-execution-diagnostics`; `playground/compatibility-inspector` composes both sources.

## Options or Next

- Add a playground-layer owner frame and page adapter; do not leak UI vocabulary into kernel/runtime packages.
- Reconcile owner respawn, project switch, duplicate delivery, and missed-before-listener cases.
- Reuse exported telemetry data types where they fit; extend only through an ADR-backed contract.

## Reversibility

New owner wire mechanism is a genuine design choice → ADR before `ready`. UI remains outside this item.
