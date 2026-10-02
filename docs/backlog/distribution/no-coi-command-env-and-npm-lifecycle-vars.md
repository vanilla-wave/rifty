---
area: distribution
status: draft
title: Give no-COI project commands a real environment — host env passthrough and npm lifecycle variables for `npm run`
created: 2026-09-27
why: every `project.run` command sees `process.env = {}` and `npm run` injects no `npm_lifecycle_event`/`npm_package_*`/`npm_config_*`, so tooling that reads NODE_ENV, CI, HOME or npm's variables diverges from Node silently
sources: [ADR-0418, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/rifty/src/sandbox-project.ts, packages/agent/src/sandbox-host.ts, packages/workbench/src/workers/no-coi-project-command.ts, packages/workbench/src/glue/npm-shell-command.ts]
---

## Context

Finding (fidelity audit rows 4, 5). `sandbox-project.ts:119` passes
`env: options.env ?? {}`; the agent adapter (`sandbox-host.ts:66`) exposes no
env at all ("fresh environment"); `npm-shell-command.ts:510`
`runPackageScript` runs nested scripts without npm's lifecycle variables.
ADR-0418 D2 recorded the empty default for the SDK; the npm-variable gap and
the adapter's missing option are unrecorded. Real Node: the user's
environment plus npm's `npm_*` injection. Oracle: real `npm run` under Node 24
(`npm_lifecycle_event`, `npm_package_name`, `npm_package_version`,
`npm_config_*`, PATH prefixed with `node_modules/.bin`). Outside the
no-COI agent host kit; commands fidelity.

## Out of scope

- Secrets policy for hosts (which env a page may expose is the host's).
