---
area: playground
status: draft
title: Compatibility facts as source-aware diagnostic records
created: 2026-07-09
why: Preflight and the owner event bridge produce compatibility facts, but without one mapping owner they either disappear outside the inspector or enter Problems with duplicate identities and undefined resolution rules.
user_story: As a developer fixing a compatibility blocker, I want Problems to retain only actionable predicted or observed facts and clear them when their authoritative source changes, without turning every caveat or unknown into an error.
epic: actionable-ide-diagnostics
blocked_by: [playground/diagnostics-hub, playground/project-compatibility-preflight, playground/compatibility-event-bridge]
sources: [M11, docs/backlog/epics/honest-compatibility-in-the-ide.md]
code: [apps/playground/src/components/ProblemsPanel.tsx, apps/playground/src/glue/ts-diagnostics-sync.ts, packages/runtime-js/src/telemetry/divergence-sink.ts]
---

## Context

Own the mapping from preflight claims and observed owner-authoritative compatibility events into `DiagnosticRecord`: source identity, project/run or manifest-revision scope, severity, provenance/evidence, deduplication, and resolution. An observed rifty gap/divergence becomes an active record keyed by its producer occurrence/feature and resolves only when a later authoritative run/source revision says it no longer applies.

A predicted `known blocker` becomes a Problems record keyed by claim id plus manifest/lockfile revision. `known caveat`, `no known blocker`, and `unknown` remain informational in the compatibility inspector and never inflate Problems. A manifest/catalog/browser-capability change recomputes predicted records; silence, navigation, or a timer cannot resolve an observed record. This item does not classify raw exceptions or parse terminal output.

## Reversibility

REVERSIBLE app-internal source adapter and policy; compatibility fact semantics remain owned by its blocking epic.
