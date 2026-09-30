---
area: distribution
status: draft
title: Let the agent's shell run npm install through the existing no-COI installer, failing loudly when no registry is connected
created: 2026-09-27
why: the no-COI agent has no way to add a dependency — `npm install` throws NotImplementedError, `npx` points at it, and the prompt tells the model dependencies belong to the host — although the installer already runs in the same Worker
epic: no-coi-agent-host-kit
blocked_by: [distribution/sdk-sandbox-lifecycle]
sources: [ADR-0375, ADR-0376, ADR-0418, ADR-0424, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/workbench/src/glue/npm-shell-command.ts, packages/workbench/src/workers/no-coi-project-command.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/runtime-js/src/protocol.ts, packages/agent/src/prompt.ts, packages/agent/src/sandbox-host.ts]
---

## Context

Finding (fidelity audit rows 1, 2, 21). `no-coi-project-command.ts:182` wires
`createNpmScriptShellCommand`, whose install branch throws
`NotImplementedError('sandbox.project.npm-install', 'use toolchain.install')`
(`npm-shell-command.ts:287-291`); the COI shell wires `createNpmShellCommand`
with a real installer. `toolchain.install({ cwd, registryUrl })`
(`protocol.ts:90-93`) is host-only, takes no package list and re-resolves the
whole manifest; the installer itself runs in the same Worker
(`no-coi-toolchain-worker.ts:116-150`). `prompt.ts:26-28` injects "No sudo,
apt, brew … dependency policy belong to the host". `shell.ts:225-231` answers
`npx` with "try: npm install …", which then throws. No ADR records excluding
install from the agent's shell (ADR-0418 D4 lists bins, `node`, `npm run`).

User decision 2026-09-27 (goal Decisions): allowed; a sandbox with no
registry connected is a valid configuration in which the command fails
loudly.

Goal obligation: I9 — with `registryUrl` connected, `npm install [<pkg>…]`
in the agent's shell runs through the same installer as `toolchain.install`
(manifest, lockfile, `node_modules` change as npm would; joins the busy slot,
no queue — ADR-0376); without a registry the command fails with a typed
outcome naming the missing connection; the injected instructions describe
installs truthfully for the active configuration.

## Out of scope

- `npx`, `yarn`, `pnpm`, `bun` (loud 127 today; `shell/npx-and-package-manager-nudge-honesty` for the nudge text).
- postinstall scripts (`npm-client/postinstall-scripts`).
- Installing without a registry (no offline resolution beyond the existing replay cache).

## Decisions

- candidate carrier (open until pickup, map fog): the shell command reaches
  the Worker's existing install owner; `<pkg>` arguments edit the manifest
  before resolution the npm way; where the registry connection lives
  (sandbox-level vs per-call) is the public-API fork; the pickup ADR cites
  ADR-0418 D4 and ADR-0376 D2.
- rejected route: a rifty-specific "install" agent tool — violates the goal's
  "as on a developer machine" clause; the agent types the real command.
