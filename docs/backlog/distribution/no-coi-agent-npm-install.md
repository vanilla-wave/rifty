---
area: distribution
status: ready
title: Let the agent's shell run npm install through the existing no-COI installer, failing loudly when no registry is connected
created: 2026-09-27
why: the no-COI agent has no way to add a dependency — `npm install` throws NotImplementedError, `npx` points at it, and the prompt tells the model dependencies belong to the host — although the installer already runs in the same Worker
epic: no-coi-agent-host-kit
sources: [ADR-0375, ADR-0376, ADR-0418, ADR-0424, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/workbench/src/glue/npm-shell-command.ts, packages/workbench/src/workers/no-coi-project-command.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/runtime-js/src/protocol.ts, packages/agent/src/prompt.ts, packages/agent/src/sandbox-host.ts]
---

## Context

Kit I9 adds shell installation through the existing no-COI Worker owner.
ADR-0487 fixes registry connection and shared npm argument semantics. Actual
COI shell+installer already diverges from native npm on saved ranges/sections;
that shared cause is repaired here, not copied into the new route.

## User scenario

After opening a project with its package.json, the agent types npm install to
add or install dependencies, then runs the program. The host can configure a
registry or leave it absent; prompt and command receipt describe that choice.
Overlapping host operations still reject busy; Stop, readonly policy and native
persistence failures retain honest effects and installation claims.

## Acceptance

1. Captured optional toolchain.registryUrl and readonly registryConnected expose
   configuration; mutation after createSandbox and restart cannot change it.
   Per-call host installation does not establish a connection. → I9
2. Real agent shell npm install [registry-semver/tag specs] uses the same real
   installer/stamp/activation owner as host install; installed module executes
   and remains usable after restart. → I9/scenario6
3. Native npm reference governs package.json and lock root dependency maps and
   installed versions: bare/exact/caret/tilde, save-exact/dev, moving prod→dev,
   existing dev/tilde bare names and no-args. Shared COI glue uses the same fix.
   Existing nonregistry specs/unsupported flags remain loud. → I9
4. No registry fails with SDK-discriminable registry-missing and clear message,
   no install network/mutation. Shell recovery operators retain actual success;
   configured/unconfigured prompt notes are truthful and contain no URL. → I9
5. Held real install rejects command/fs/install overlap, Stop carries abort to
   the real registry operation and settles before next command. → I9/ADR-0376
6. Readonly install targets refuse before owner claim mutation; registry failure
   restores manifest; native quota never promotes a trusted claim, reports failed
   persistence and explicit retry recovers. → I9/I4 baseline

## Fault matrix

| Axis × operation | Honest outcome | Proof |
| --- | --- | --- |
| sibling-drift × npm argument save | one shaping owner, actual npm state | shared COI + real Chromium parity → I9 |
| provenance-lie × missing registry | typed failure before install effects/fetch | absent configuration, host override control → I9 |
| concurrent-same-key × install | existing busy rejection, no queue | held HTTP + host command/fs/install → I9 |
| torn-state × aborted/failed install | settle before reuse, restore manifest, no false trust | Stop/network/quota + explicit retry → I9 |
| observable-order × readonly install | policy before privileged claim writes | readonly node_modules/native request count → I4/I9 |

## Challenge

challenge: 2026-09-30 — clear; I9's checked ordinary-shell premise reused.
Existing install owner and policy wrapper are sufficient. Actual native npm
probes reject copying old raw-range save behavior; no new coordination needed.

## Out of scope

- npx/yarn/pnpm/bun, postinstall scripts and nonregistry specs: existing loud gaps.
- Registry-free/offline installation; absent registry is an explicit valid mode.
- Generic npm CLI/lock serialization conformance beyond the existing installer;
  this unit proves requested dependency changes, not byte-identical npm logs/locks.

## Decisions

- 2026-09-30 — ADR-0487; native npm11.17/Node24.16 oracle against genuine ms archives. Shared save defect repaired at its owner; no no-COI fork.
