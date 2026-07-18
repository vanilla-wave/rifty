---
area: playground
status: ready
title: Tab-independent workspace reopen and occupied-tab UX
created: 2026-07-18
why: Workbench already has stable origin storage and a single-page Web Lock, but a fresh competing Playground tab shows a generic boot-failure toast and independent-tab continuity has no app-level acceptance proof.
user_story: As a developer editing a local Node project in rifty, I want a new tab to reopen my Saved files after the prior tab closes, while a simultaneous tab tells me where the active editor is instead of looking broken.
blocked_by: []
sources: [ADR-0263, ADR-0278, ADR-0281, ADR-0293]
code: [apps/playground/src/main.tsx, apps/playground/src/adapters/playground-app.tsx, apps/playground/src/adapters/playground-workbench-host.ts, apps/playground/src/workbench/open-workbench.ts, apps/playground/src/workbench/errors.ts]
---

## Context

Current Workbench storage is already tab-independent: one owner-private catalog
and project store serve every document on the origin. Its exclusive
`rifty:workbench:v1` Web Lock also prevents two physical owners. The remaining
product gap is above that deep module: `main.tsx` creates terminal persistence
and mounts App before `App.onMount()` discovers contention, then reduces the
ordinary lock-null outcome to a generic error toast.

The old discovery item described two uncoordinated owners. ADR-0263 closed that
corruption path, so this ready item replaces the stale diagnosis with the
remaining user-visible contract. No second lock or storage namespace is needed.

## User scenario

A developer opens the Project files Starter, replaces `/src/main.js` with a
unique program, and waits for the visible `Saved` durability acknowledgement.
While that page is live, a newly created independent Chromium tab shows that
the workspace is open elsewhere and starts no Workbench owner. They return to
the original tab, close it, then explicitly Reload the waiting tab. The same
active Scratch and byte-exact `/src/main.js` reopen; no workspace selector,
import, Save-as-Project, or Git commit is involved.

## Acceptance

- Public `WorkbenchOriginOccupiedError` identifies only
  `{ ifAvailable: true }` callback-null origin contention. Same-page duplicate
  open and every capability/request/SW/owner failure remain fatal and retain
  their original cause.
- First-party host translates only that typed error to `occupied`; no message
  matching or second admission authority exists.
- Entry order is boot probe -> Workbench open -> terminal persistence -> App.
  A contender mounts only the standalone occupied notice and constructs no
  terminal persistence, App, Workbench owner, project runtime, or dev server.
- If terminal construction or App mount fails after admission, the coordinator
  closes the Workbench; trigger and cleanup failures are both observable.
- Real Chromium: page A edits `/src/main.js`, waits for visible `Saved`, and
  page B with empty session workspace metadata shows exact directed copy,
  `role=alert`, Reload, no `.rf-app`, no terminal, and zero page Workers.
- Closing A does not auto-promote B. Explicit Reload reopens the same active
  Scratch and exact public project bytes in B.
- Existing two-page browser-unit proof still shows one origin lock, zero owner
  construction on the loser, crash release, and successful retry.
- Project switches retain the Workbench claim; only Workbench close or document
  destruction releases it.
- Existing reload, project switch, terminal, preview, SCM, archive, browser-unit,
  production E2E, and full `pnpm pr:check` lanes remain green.

## Reference contract

- Oracle: W3C Web Locks Working Draft 2025-09-24 and repository-pinned Chromium.
- Mechanism: existing Workbench `rifty:workbench:v1` exclusive
  `{ ifAvailable: true }` request held for the Workbench lifetime.

## Parity cases

- No Node oracle applies to browser-tab admission or origin-private storage.
- Web Locks callback `null` maps to the typed occupied outcome; a granted
  callback remains held until Workbench close/document termination.
- Lock request throw/rejection is not contention and propagates unchanged.
- Saved bytes read through a newly admitted Playground session equal the bytes
  written through the prior independent page.

## Fault matrix

| axis | operation / injected fault | required honest outcome | proof |
|---|---|---|---|
| `concurrent-same-key` | live A then B opens same origin | one Workbench owner; B visibly occupied with zero Worker | browser-unit two-page lock + Playground Chromium E2E |
| `provenance-lie` | Saved edit, owner page closes, waiting page reloads | same active Scratch and exact public file bytes; no seeded substitute | Playground Chromium E2E |
| `observable-order` | occupied outcome | no terminal persistence or App mount after Workbench refusal | entry coordinator contract test |
| `false-fallback` | lock request/SW/owner failure | original fatal error; never occupied UI | Workbench + host contract tests |
| `torn-state` | terminal/mount failure after acquired Workbench | Workbench closes; aggregate preserves cleanup failure | entry coordinator fault contract |
| `quota-perm-fail` | Workbench reports memory fallback | existing EPHEMERAL UI; no cross-document durability claim | degraded-storage + Workbench storage contracts |

The sole shared-state writer is the admitted physical Workbench owner. Editor,
Files, Documents, shell, npm, SCM, archive, and runtime children already route
through that owner; this item adds no writer and no coordination mechanism.

## Out of scope

- Concurrent editing of the same or different Projects in multiple tabs.
- Read-only second-tab view, takeover, handoff, fork, force-unlock, background
  retry, or automatic promotion.
- Cross-tab terminal, dev-server, preview, or runtime control.
- Migration, import, listing, or deletion of additional historical
  `/workspace` or session-scoped trees.
- Durable close-to-new-document continuity in the memory backend.
- Cross-profile, cross-browser, cross-device, or cloud synchronization.

No API is exposed for these behaviors. A second live origin is refused through
the typed occupied outcome; unsupported browser capabilities remain loud at
`openWorkbench()` and compatibility-unclaimed.

## Decisions

- ADR-0293 fixes typed origin contention, first-party translation, entry order,
  ownership transfer, notice/reload UX, and deliberate absence of multi-tab
  editing.
- ADR-0263 remains the one-lock, one-Workbench storage/lifecycle authority.
- ADR-0278/0282 own existing selected legacy adoption; this capability neither
  depends on nor expands it.
- ADR-0281's visible `Saved` acknowledgement is the close/reopen durability
  boundary used by acceptance.
