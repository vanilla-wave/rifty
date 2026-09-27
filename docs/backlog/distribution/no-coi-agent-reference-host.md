---
area: distribution
status: draft
title: Refactor the packed lane's Vite consumer into a connections-only reference host that runs the kit scenario in CI
created: 2026-09-27
why: no in-repo host composes @riftydev/sdk + @riftydev/agent for embedders to copy; the packed proofs that already run sdk + agent + scripted provider are test-shaped and re-derive readiness, apply state, busy and output handling, so every consumer rewrites the same glue and nothing pins the host/rifty boundary
epic: no-coi-agent-host-kit
blocked_by: [distribution/sdk-typed-sandbox-outcomes, distribution/sdk-boot-and-snapshot-progress-events, distribution/agent-transcript-model, distribution/agent-per-capability-project-policy, distribution/agent-per-turn-settings, distribution/agent-text-only-content-transport]
sources: [ADR-0417, ADR-0420, ADR-0426, ADR-0436, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [tests/integration/fixtures/workbench-vite-consumer/src/no-coi-project-proof.ts, tests/integration/fixtures/workbench-vite-consumer/src/sandbox-agent-proof.ts, tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts, tests/integration/workbench-packed-consumer.mjs, tests/integration/no-coi-agent-browser-proof.mjs, tools/agent-bench/src/no-coi-page.ts, packages/rifty/README.md]
---

## Context

Finding. The default packed-consumer lane (`workbench-packed-consumer.mjs`,
closure sdk + workbench + agent, `:193`) builds the Vite consumer app
`tests/integration/fixtures/workbench-vite-consumer` and runs
`provePackedAgent` (`:1253` → `no-coi-agent-browser-proof.mjs`) over
`src/sandbox-agent-proof.ts` (policy + scripted `fetch`) and
`src/no-coi-project-proof.ts` (namespace boot → `applySnapshot` → `open` →
`runBin vite build` → dist read). Both are proof modules: they poll
readiness, keep `applyState` strings, accumulate output by hand and carry no
readable host. The surface-only fixture
(`no-coi-packed-toolchain-consumer`) excludes `@riftydev/agent` from its
closure and is not a candidate. `tools/agent-bench/src/no-coi-page.ts` wires
the same composition for the benchmark. No `examples/` entry imports
sdk/agent/workbench. The only ANSI/CR normalizer in the repo sits inside a
spec (`tests/no-coi/no-coi-sandbox-build-loop.spec.ts:24-34`).

Goal obligation: I8 + scenario 1–8 — a readable `host.ts` in the Vite
consumer (the existing-app persona) runs support check → boot with namespace
→ snapshot into an empty target (typed conflict otherwise) → sources written
after the apply → one agent turn (scripted provider) edits a file → `vite
build` → dist read → close → second-tab occupied; its source contains only
connections (asset URLs, namespace, endpoint settings, project root and policy
values, DOM targets, the host-owned applied `snapshotId` with `force` on a
new id) plus the declined host glue as plain host code (line normalizer,
download helper, one promise chain). The existing proof drivers keep
asserting rifty behaviour over that host. `packages/rifty/README.md` links it
as the embedding recipe. Closes the goal.

Open user question (goal Decisions, critic-2 P1): whether
`tools/agent-bench`'s no-COI lane must boot this host's composition module so
the measured configuration is the kit's reference configuration; answer (a)
adds that wiring here.

## Out of scope

- Publishing the host (`@riftydev/*`) or a test-fixture package — declined.
- A new `examples/` directory; the surface-only fixture — carriers rejected.
- Preview (`epics/no-coi-visual-debug`); the host runs `commands` mode only.

## Decisions

- acceptance closes on the CI run of the packed lane over `host.ts`; a
  source ratchet over `host.ts` for the forbidden mechanisms (readiness
  polling, apply-state strings, busy flag, content flattening, prompt/tool
  text) is a guard, never the acceptance oracle (AGENTS.md DoD).
