---
kind: epic
status: draft
title: Honest compatibility in the IDE
created: 2026-07-09
value: A developer can see what rifty knows, what it observed, and what remains unknown for the project in front of them, with every compatibility claim linked to evidence.
user_story: As a developer trying a real Node project, I want known browser ceilings, rifty gaps, package incompatibilities, and observed divergences explained in the IDE, but today truth is split between external Markdown, stderr, and a runtime event path the playground does not receive.
---

## Outcome

The IDE consumes a normalized catalog that also renders or validates every relevant claim in `docs/public/compat`, then combines those static claims with owner-authoritative events from the current run. It reports `known blockers`, `no known blocker`, or `unknown` — never a score or an unsupported promise that a project works.

## User scenario

A user opens an npm project. Before install, the IDE identifies only blockers supported by catalog evidence and marks uncovered areas unknown. During execution, a real `NotImplementedError`, known divergence, or structured native-package failure appears once with its feature/package, classification, exact run, and evidence link where one exists. A generic exception remains unclassified instead of being mislabeled as a compatibility gap.

## Items

- `toolchain-build/machine-readable-compat-claim-catalog` — one evidence-bearing source for generated matrices and hand-maintained ceilings.
- `playground/notimplemented-stub-telemetry` — structured capture at guest failure boundaries.
- `playground/compatibility-event-bridge` — owner-authoritative compatibility events reach the page.
- `playground/project-compatibility-preflight` — evidence-bounded static project fit report.
- `playground/compatibility-inspector` — one UI for preflight and observed compatibility facts.

## Draft gates

The catalog is blocked by `toolchain-build/compat-matrix-test-result-sink`, owned by `webcontainers-alternative-search-slot`, so generated green claims cannot rest on skipped tests. Structured install/native observations and compatibility→Problems lifecycle come from `actionable-ide-diagnostics` (`playground/structured-execution-diagnostics`, `playground/compatibility-diagnostics-adapter`); this epic must consume those sources rather than invent package failures or retention semantics. The owner→page event mechanism and any public catalog schema need ADRs before the affected children become `ready`.
