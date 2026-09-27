---
area: distribution
status: draft
title: Promote the packed no-COI fixture into a connections-only reference host that runs the kit scenario in CI
created: 2026-09-27
why: no in-repo host composes @riftydev/sdk + @riftydev/agent for embedders; the closest fixtures are test-shaped and re-derive readiness, apply state, busy and output handling, so every consumer rewrites the same glue and nothing pins the host/rifty boundary
epic: no-coi-agent-host-kit
blocked_by: [distribution/sdk-typed-sandbox-outcomes, distribution/sdk-boot-and-snapshot-progress-events, distribution/agent-transcript-model, distribution/agent-per-capability-project-policy, distribution/agent-per-turn-settings, distribution/agent-text-only-content-transport]
sources: [ADR-0417, ADR-0420, ADR-0426, ADR-0436, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [tests/integration/fixtures/no-coi-packed-toolchain-consumer/src, tests/integration/workbench-packed-consumer.mjs, tests/integration/no-coi-snapshot-browser-proof.mjs, tools/agent-bench/src/no-coi-page.ts, packages/rifty/README.md]
---

## Context

Finding. `tests/integration/fixtures/no-coi-packed-toolchain-consumer/src`
(588 lines) is an esbuild bundle of the packed `@riftydev/sdk` with agent
scenarios over the scripted provider, driven by
`workbench-packed-consumer.mjs --surface-only`; `tools/agent-bench/src/
no-coi-page.ts` (70 lines) wires the composition the benchmark measures. No
`examples/` entry imports sdk/agent/workbench. Existing SDK-only fixtures poll
`runtime.isReady()`, keep apply-state strings, accumulate output by hand and
carry the only ANSI/CR normalizer in the repo inside a spec
(`tests/no-coi/no-coi-sandbox-build-loop.spec.ts:24-34`).

Goal obligation: I8 + scenario 1–8 — a readable host (`host.ts`) built from
packed tarballs runs support check → boot with namespace → snapshot into an
empty target (typed conflict otherwise) → one agent turn (scripted provider)
edits a file → `vite build` → dist read → close → second-tab occupied; its
source contains only connections (asset URLs, namespace, endpoint settings,
project root/policy, DOM targets, host-owned "applied" flag) and the declined
host glue as plain host code (line normalizer, download helper, one promise
chain); it wires the same `@riftydev/agent` composition as the bench lane.
`packages/rifty/README.md` links it as the embedding recipe. Closes the goal.

## Out of scope

- Publishing the host (`@riftydev/*`) or a test-fixture package — declined.
- A new `examples/` directory — carrier rejected (goal Decisions).
- Preview (`epics/no-coi-visual-debug`); the host runs `commands` mode only.

## Decisions

- "connections only" is the acceptance oracle: a grep/lint over `host.ts` for
  the forbidden mechanisms (readiness polling, apply-state strings, busy flag,
  content flattening, prompt/tool text) plus the CI run; both are named in
  Acceptance at pickup.
