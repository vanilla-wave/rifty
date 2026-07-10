---
area: playground
status: draft
title: Structured NotImplemented and divergence capture at rifty boundaries
created: 2026-06-12
why: Runtime-js aggregates some structured feature hits, but real playground runs span owner/child/service paths and multiple NotImplementedError classes, so an uncaptured or untrusted boundary would make the compatibility inspector silently incomplete or misclassify user code.
user_story: As a developer running a real project, I want every surfaced rifty NotImplementedError or known divergence to retain its feature id and classification, but today capture is tied to only part of the runtime topology.
epic: honest-compatibility-in-the-ide
sources: [M11, ADR-0130, ADR-0142, fullstack-demo feedback 2026-06-12]
code: [packages/io/src/errors.ts, packages/vfs/src/errors.ts, packages/ts-language-service/src/service.ts, packages/runtime-js/src/telemetry/divergence-sink.ts, apps/playground/src]
---

## Context

Rifty's `NotImplementedError` variants carry a structured `feature` field (`module.method`) across io/vfs consumers and the TS language service per the no-silent-stubs rule. Runtime-js has a session sink and worker diagnostic event, but the playground also executes through owner/kernel/shell and TS service-worker paths. `instanceof` cannot cross packages/realms, while arbitrary `name` + `feature` is forgeable by user/dependency code: the throwing rifty producer must brand provenance before serialization, and only that typed envelope may classify a known rifty gap.

Audit owner, node/bin/dev-server child, runtime-controller, install, and TS service endpoint boundaries. Assign one occurrence id at the first authoritative boundary and forward it so repeated owner/child/page observations deduplicate instead of inflating counts. Count only errors that cross an observed failure boundary — constructor hooks would count handled control flow and create reverse coupling. Generic exceptions and third-party lookalikes remain unclassified; a regression test pins that distinction.

This item owns capture/aggregation only. `playground/compatibility-event-bridge` owns delivery to the page; `playground/compatibility-inspector` owns UI. No network collection or cross-user telemetry is implied.

## Reversibility

REVERSIBLE internal instrumentation. A new shared error brand or cross-package/public telemetry interface needs an ADR before `ready`.
