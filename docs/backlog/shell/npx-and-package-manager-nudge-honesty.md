---
area: shell
status: draft
title: Make the `npx` / `yarn` / `pnpm` not-found nudge truthful for the active install configuration
created: 2026-09-27
why: the shell answers `npx vite build` with exit 127 and "try: npm install …" — in no-COI agent commands that suggestion itself throws today, and after agent install lands it is true only when a registry is connected
sources: [docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md, docs/backlog/distribution/no-coi-agent-npm-install.md]
code: [packages/shell/src/shell.ts]
---

## Context

Finding (fidelity audit row 2). `shell.ts:225-231,851-856` special-cases
`npx`, `yarn`, `pnpm`, `bun` with a nudge toward `npm install`. Real Node:
`npx <bin>` runs an installed bin or fetches it. The nudge text must reflect
what the host actually offers (install available / no registry connected),
and `npx <installed-bin>` resolving to `node_modules/.bin` is the parity
half. Outside the no-COI agent host kit; the install half is
`distribution/no-coi-agent-npm-install`.

## Out of scope

- `npx` fetching an uninstalled package; `yarn`/`pnpm`/`bun` execution (loud).
