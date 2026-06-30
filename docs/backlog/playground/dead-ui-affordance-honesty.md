---
area: playground
status: ready
title: UI affordance honesty — wire the dead "Export soon" chip, de-lie the Share toast
created: 2026-06-30
why: the status bar shows a disabled "Export soon" chip while a working whole-workspace export already ships in the palette, and the Share button copies a bare `location.href` while toasting success — a self-evident lie a curious user clicks, cheap credibility loss right next to the runtime they're evaluating.
user_story: As a curious user, I want the visible Export/Share controls to do what they imply, but today Export is a dead `<span>` and Share copies a URL that encodes none of my edits.
epic: frictionless-first-poke
blocked_by: []
sources: [docs/backlog/epics/frictionless-first-poke.md]
code: [apps/playground/src/components/StatusBar.tsx, apps/playground/src/App.tsx]
---

## Context

`StatusBar.tsx:69-71` renders a disabled `<span> Export <pill>soon</pill>` with no `onClick` — but whole-workspace export already works in the palette (`downloadWorkspaceArchive`, `App.tsx:300`, palette item `:2117`, gated by `workspaceArchiveBlocked()`). Separately, `share()` (`App.tsx:289-294`) copies only `globalThis.location.href` and toasts `Link copied`, implying it shares the user's edits — it does not (no workspace encoding; real share-by-link is the M13 item).

## Acceptance

- The status-bar "Export" chip becomes a real button wired to `downloadWorkspaceArchive` (drop the "soon" pill), disabled only when `workspaceArchiveBlocked()` is true (dev server running), with a title explaining the disabled state — i.e. it mirrors the already-shipped palette command, never a dead teaser.
- The Share success toast no longer implies edits travel: its copy contains no "your project / your edits" claim (e.g. `Link copied — opens this playground`), OR Share is pointed at the working archive download. No toast asserts a capability that doesn't exist.

## Parity cases

None — UI honesty (the Fidelity rule: no affordance that lies). Verification = unit/e2e: the Export chip click triggers the archive download; the Share toast copy contains no edit-sharing claim.

## Out of scope

- Real share-by-link / encoded-workspace URL — owned by the M13 share item + `playground/launch-deeplink-real-npm` (this item only removes the lie).
- Single-file (vs whole-workspace) download — owned by `playground/explorer-file-download` (`scm-file-manager`).

## Decisions

- Wire (not remove) the Export chip — the feature already exists, so the visible control should work.
- REVERSIBLE (playground UX, no public API) → CHANGELOG in apps/playground; no ADR.
