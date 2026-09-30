---
area: distribution
status: draft
title: Accept distinct file-tool and shell policy values in one createSandboxAgentHost
created: 2026-09-27
why: SandboxProjectOptions carries one readonlyPaths/allowedCommands policy for the whole project, so a host that wants a read-only shell with writes only through file tools must instantiate two agent hosts and splice their capabilities by hand
epic: no-coi-agent-host-kit
sources: [ADR-0418, ADR-0424, ADR-0426, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/agent/src/sandbox-host.ts, packages/agent/src/types.ts, packages/rifty/src/sandbox-project.ts, packages/runtime-js/src/protocol.ts, packages/workbench/src/workers/no-coi-project-command.ts]
---

## Context

I4 uses the existing SDK project policy. ADR-0484 partially supersedes
ADR-0426 D1's one-handle requirement after independent DEC-2 review.
The README's npm/node-only allowlist rejects nested project bins; keep per-stage
semantics and demonstrate unrestricted default plus explicit complete allowlist.

## User scenario

An embedder supplies one root and optionally distinct files/shell policy values.
File tools may edit while a read-only shell can inspect; another embedding can
choose the inverse. Unspecified policy stays unrestricted in the reference host.

## Acceptance

1. One agent session writes with file tools while shell redirection and Node fs
   writes receive the existing SDK readonly refusal; bytes remain correct. → I4
2. Inverse policy rejects file-tool writes while shell writes succeed; policy
   does not leak between sequential capability calls. → I4
3. Existing common project policy remains inherited; per-capability present
   fields replace common fields, explicit undefined clears and empty command
   allowlist denies all. No second root or policy engine. → I4 + ADR-0426
4. Reference README defaults unrestricted. Actual npm build executes its own bin;
   explicit allowlist checks nested bins and cannot bypass SDK enforcement. → I4 + scenario

## Fault matrix

| Axis × operation | Honest outcome | Proof |
| --- | --- | --- |
| sibling-drift × files/shell | one SDK enforces each effective policy | real host + Worker tests → I4 |
| corrupt-input × capability root | reject invalid new root, preserve common root | public host creation test → I4 |
| provenance-lie × policy notes | captured notes describe effective policy values | real session prompt/notes → I4 |

## Challenge

challenge: 2026-09-30 — clear; reuse accepted I4 premise. Independent DEC-2
agent recommends additive policies over public SDK handles, no policy engine.

## Out of scope

- Hostile-code filesystem jail; existing SDK root semantics remain.
- Workbench adapter policy extensions; only sandbox adapter has this contract.

## Decisions

- 2026-09-30 — ADR-0484: additive policies, same root, one SDK handle per capability; independent DEC-2 review `policy_decision`.
