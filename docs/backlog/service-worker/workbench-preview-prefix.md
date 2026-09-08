---
area: service-worker
status: ready
title: Serve Workbench preview inside a host-selected service-worker scope
created: 2026-09-07
why: Fixed root /preview URLs prevent iframe preview under a narrow embedding scope.
user_story: As the Tracker plugin-sandbox embedder, I want to serve workbench preview inside a host-selected service-worker scope, but today fixed root /preview URLs prevent iframe preview under a narrow embedding scope.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md, docs/backlog/service-worker/reference/workbench-preview-prefix-evidence.md, ADR-0405, ADR-0036, ADR-0040]
code: [packages/io/src/preview-protocol.ts, packages/service-worker/src/preview-bridge.ts, packages/workbench/src/workbench/internal/workbench-options.ts, packages/workbench/src/workers/preview-registry.ts]
---

## Context

`parsePreviewPath` matches only `/preview/<port>`. A `/sandbox/` page
with SW scope `/sandbox/` cannot intercept root `/preview` routes.
Evidence: `reference/workbench-preview-prefix-evidence.md`. Packed-host
composition of the whole scenario stays I7.

## User scenario

The embedder opens Workbench under `/sandbox/` with
`deployment.serviceWorker.scope: '/sandbox/'` and
`deployment.previewPrefix: '/sandbox/preview'`. Iframe navigation,
preview assets, root-relative guest requests and HMR resolve under
`/sandbox/preview/<port>/`. Guest project source URLs are unchanged.
Omitted `previewPrefix` still uses `/preview/<port>/`. An invalid prefix
or a prefix outside the SW scope fails before SW register. An unrelated
host route outside the SW scope is not intercepted.

## Acceptance

1. Omitted `deployment.previewPrefix` keeps today's `/preview/<port>/` parse, registry URLs, and SW match. `packages/io/src/preview-prefix.contract.test.ts` omitted case plus existing preview-protocol tests. → I5 → ADR-0405
2. `deployment.previewPrefix: '/sandbox/preview'` is valid Workbench admission when SW scope contains it (scope `/sandbox/` or `/`). `workbench-preview-prefix.contract.test.ts` admission case. → I5 → ADR-0405
3. Invalid prefix spelling (`''`, `'preview'`, `'/sandbox/preview/'`, `'//x'`, `'/a/../b'`, `'/a//b'`, `'\\x'`) throws `TypeError` / `deployment.previewPrefix` before SW register. Same workbench file plus `workbench-preview-prefix.fault.test.ts`. → I5 → ADR-0405
4. Prefix outside SW scope (`scope: '/sandbox/'`, `previewPrefix: '/preview'`) throws `TypeError` / `deployment.previewPrefix` before SW register. Same fault file. → I5 → scenario → ADR-0405
5. With prefix `/sandbox/preview`, `parsePreviewPath` / `matchPreviewUrl` / preview-registry emit and match `/sandbox/preview/<port>/` (and rest paths); `/preview/<port>/` and `/api/preview/<port>/` are not that prefix. `preview-prefix.contract.test.ts` (io + SW + registry). → I5 → ADR-0405
6. Real Chromium: page under `/sandbox/` , SW scope `/sandbox/`, prefix `/sandbox/preview` — iframe navigation, a preview asset, and HMR use the prefixed URL; an unrelated origin path outside the scope is not a preview route. `tests/browser-unit/workbench-preview-prefix.spec.ts`. → I5 → scenario

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| corrupt-input × invalid prefix | `TypeError` naming `deployment.previewPrefix` before SW register | `workbench-preview-prefix.fault.test.ts` invalid case | → I5 → ADR-0405 |
| corrupt-input × prefix outside SW scope | same loud throw before register; `register` not called | same fault file out-of-scope case | → I5 → ADR-0405 |
| sibling-drift × prefix | io parse, SW match, and registry URL share one prefix | `preview-prefix.contract.test.ts` trio | → I5 → ADR-0405 |

## Out of scope

Rewriting guest project source URLs. Rebuilding the copied SW per host.
Packed `/sandbox/` composition of the whole goal scenario (I7). Changing
owner-binding / anti-hijack rules except the addressing prefix.
Operation budgets (I7). Hostile-code isolation. Multiple concurrent
Workbench owners.

## Decisions

- 2026-09-09 — ADR-0405: optional `deployment.previewPrefix`; omitted = `/preview`; one io authority; SW ready may carry the prefix; `SW_ROUTING_VERSION` 6→7; no guest rewrite.
- 2026-09-07 — finding draft; observable scope is settled by goal I5; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-09 — clear
