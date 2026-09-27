---
area: distribution
status: draft
title: Accept distinct file-tool and shell policy in one createSandboxAgentHost
created: 2026-09-27
why: SandboxProjectOptions carries one readonlyPaths/allowedCommands policy for the whole project, so a host that wants a read-only shell with writes only through file tools must instantiate two agent hosts and splice their capabilities by hand
epic: no-coi-agent-host-kit
sources: [ADR-0418, ADR-0424, ADR-0426, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/agent/src/sandbox-host.ts, packages/agent/src/types.ts, packages/rifty/src/sandbox-project.ts, packages/runtime-js/src/protocol.ts, packages/workbench/src/workers/no-coi-project-command.ts]
---

## Context

Finding. `SandboxAgentHostOptions` (`packages/agent/src/types.ts:60-66`) takes
one `project: SandboxProjectOptions` (`{ root, readonlyPaths?,
allowedCommands? }`, `packages/runtime-js/src/protocol.ts:142-146`) and builds
both `files` and `shell` over one `sandbox.project(...)` handle
(`packages/agent/src/sandbox-host.ts`, 75 lines). Enforcement lives in the SDK
project policy (`no-coi-project-command.ts:59-62`; ADR-0426: "SDK
readonly/command policy stays authoritative"). Issue #345's host created two
hosts with different policies and spliced `files` from one with `shell` from
the other into a hand-written `AgentHost` (≈60 lines).

Goal obligation: I4 — one host, distinct `readonlyPaths` / `allowedCommands`
for the file tools and for the shell; enforcement stays in the SDK project
policy (two `sandbox.project()` handles over the same root is the obvious
carrier), no second policy engine.

## Out of scope

- A filesystem jail or path escape guarantees beyond the existing root-as-path-origin (ADR-0418 D2).
- Workbench agent host (`createWorkbenchAgentHost`) parity — only if the same shape applies for free.

## Decisions

- option shape (`project: { root, files?: policy, shell?: policy }` vs two
  project options) at pickup; public API → ADR at pickup.
