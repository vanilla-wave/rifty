# ADR 0293: Tab-independent workspace admission UX

Status: Accepted
Date: 2026-07

> TL;DR: Playground reuses the Workbench's stable origin storage and exclusive
> Web Lock; cross-page contention becomes one typed outcome and a standalone
> “open in another tab” notice before terminal persistence or App mount.

## Context

The Workbench extraction already removed page-session identity from current
storage. One owner-private OPFS catalog at `/.rifty/workbench/playground` and
project trees under `/.rifty/workbench/v1` survive independent page lifetimes.
`openWorkbench()` also owns the exclusive origin Web Lock
`rifty:workbench:v1`, acquired before service-worker proof and owner start and
held until `Workbench.close()` or document destruction.

The first-party Playground still opens that Workbench from `App.onMount()`.
Before it learns that another page owns the lock, `main.tsx` constructs terminal
persistence and mounts the whole App. The rejected contender is a generic
`Error`, so the App can only show “Workbench open failed” in a toast. The
storage is safe, but the user's new tab looks broken and does not direct them to
the live editor. There is also no app-level proof that a Saved edit reopens in
an independent tab rather than only through `page.reload()`.

Adding a page-level lock would create two admission authorities over the same
name: the outer claim would make the page's own `openWorkbench()` lose. Adding
a second workspace id/path would likewise fork the already-stable catalog.

## Decision

1. **The Workbench remains the only admission and storage authority.** No new
   lock, workspace id, storage root, heartbeat, `BroadcastChannel`, or
   `localStorage` selector is introduced. Current owner-private catalog/project
   roots are reused without caller-visible identity.
2. **Origin contention is typed at its source.** Only an exclusive Web Locks
   callback receiving `null` throws public `WorkbenchOriginOccupiedError`.
   Same-page duplicate open, missing capabilities, a synchronous/rejected lock
   request, service-worker proof failure, and owner boot failure remain their
   original fatal errors. Consumers never classify error text.
3. **The first-party host translates, the generic Workbench rejects.** The
   Playground host maps only `WorkbenchOriginOccupiedError` to the closed
   `opened | occupied` outcome used by its entry coordinator. Other failures
   propagate unchanged to that coordinator, which paints them (decision 9).
   `@riftydev/workbench` does not own UI.
4. **Admission precedes mutable page surfaces.** Normal entry order is the
   existing COI/runtime install -> non-authoritative boot probe ->
   `openPlaygroundWorkbench()` -> terminal persistence -> App. An occupied page
   replaces the cold-boot skeleton with a standalone `role=alert` notice and
   constructs neither terminal persistence nor App. The Workbench's lock-null
   path already starts no owner, project runtime, or writable Workbench store.
5. **Ownership transfers exactly once.** Before App mount, the one-shot
   first-party page-entry adapter owns the opened Workbench and closes it if
   terminal construction or mount fails. After successful mount, App runtime
   owns and closes it. Cleanup failures aggregate with the triggering failure
   rather than hiding either. The adapter returns no lifecycle controller,
   survives no successful mount, and owns no ProjectSession/run state; it is
   not the orchestration core retired by ADR-0292.
6. **The lease follows the Workbench, not a ProjectSession.** Project close,
   reset, save, or switch never releases it. A contender never auto-promotes;
   after the owner tab closes, explicit Reload is the only retry.
7. **This adds no migration dependency.** Fresh-tab acceptance starts with
   empty `sessionStorage` and uses current Workbench storage. Existing selected
   legacy adoption remains governed by ADR-0278/0282; preserving any additional
   historical `/workspace` or session-scoped tree is not required here.
8. **Multi-tab editing is not a product goal.** Concurrent editing, read-only
   view, takeover, handoff, fork, cross-tab terminal/runtime control, and
   automatic retry are not exposed. A second live page is refused visibly.
9. **Every fatal page-entry outcome is painted by the same coordinator.** Any
   failure of the entry transaction — boot probe, non-contention admission
   failure, terminal persistence, App mount — replaces the cold-boot skeleton
   with a standalone failure notice (causes + explicit Reload) after the
   admitted Workbench, if any, is closed; the original error still propagates.
   The skeleton is never a terminal state. The COI guard keeps its earlier
   bespoke banner: it fires before this coordinator exists. ADR-0285's health
   authority remains the recovery surface once an App exists; before one does,
   explicit Reload is the only retry (decision 6).

This corrects ADR-0263's generic “contention rejects” clause only: origin
contention now has a stable public error prototype; its one-lock/one-Workbench
lifetime and every other ADR-0263 decision stand.

This does not correct ADR-0292. Admission handoff is finite first-party page
composition; executable lifecycle and teardown semantics remain in Workbench.

## Reference contract

[W3C Web Locks Working Draft 2025-09-24](https://www.w3.org/TR/2025/WD-web-locks-20250924/)
is the lifecycle oracle: `ifAvailable` supplies `null` when the claim cannot be
granted; a granted lock is held until the callback-returned promise settles;
document termination releases its locks. Browser acceptance is pinned to the
repository's Playwright/Chromium lockfile.

## Consequences

- A fresh independent tab reopens the same Saved Scratch/Project and exact
  bytes without a workspace selector, import, or Git commit.
- A live contender gets one directed recovery surface and starts no Workbench
  owner; after the other page closes, Reload opens the durable project.
- Cold boot keeps the existing HTML skeleton until Workbench admission and
  owner boot finish; this avoids flashing an editable-looking App before the
  origin claim is known.
- A fatal admission failure (SW proof, owner boot, storage/permission, absent
  capability) is refused as visibly as contention: a failure notice with the
  causes, never a spinner that outlives the error.
- Memory fallback remains visibly ephemeral. Cross-document durability is
  claimed only when the admitted Workbench reports durable OPFS storage.
- A future multi-tab/read-only/takeover design must supersede this ADR and the
  single-Workbench limit; it cannot add a second writer or coordination owner.
