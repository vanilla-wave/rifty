---
kind: epic
status: ready
title: Open and build self-hosted no-COI projects without host patches or installation-status gates
created: 2026-09-10
value: an existing application can use CI-baked dependencies, scoped persistent storage and ordinary saved files through the published SDK
user_story: As an embedded browser IDE owner, I want a self-hosted project to build and reopen without registry access, private cache plumbing or installation-status admission.
tier: robust
---

## Outcome

Deliver integration issues #327–329 through the published no-COI SDK and copied
worker. Host selects storage and startup budget, explicitly applies the existing
producer artifact, and opens actual saved files. No global overrides, patched
dist, host-side cache/claim protocol or saved installation-status gate.

## User scenario

1. In CI, use published produceDependencySnapshot with a pinned real Vite 7
   project manifest/npm lock. Serve its archive and published worker assets from
   the application's origin. Host seeds application source through existing FS.
2. Boot SDK without COI, with a selected OPFS namespace, required persistence
   and a suitable startup budget. Explicitly apply the artifact; real Vite build
   succeeds with zero browser registry/Eddy requests and no placeholder URL.
3. Edit source and dependency files, reload, then open/build the saved project.
   Open does not reinstall, rewrite dependencies, fetch an unused new artifact
   or consult installation completion. Missing dependencies fail at actual use.
4. Explicitly apply an update. Default payload conflict rejects without mutation;
   force replaces conflicting targets and preserves paths outside those targets.
5. Close the tab during application, or encounter a storage failure. On reopen,
   readable files and independent Node commands remain available. A missing
   dependency/adapter gives its concrete use error. Host may explicitly apply
   again; no mandatory recovery step, automatic retry or rollback promise.

## Invariants

Baseline `2c7f9bbf4`: all rows false on current source. I1/I2 lack public boot
options; I3/I5/I6 lack an SDK artifact consumer; I4 has the explicit stamp gate
and eager adapter activation in openInstallation. Evidence and exact raw user
answer: docs/backlog/distribution/reference/no-coi-project-open-refine.md.

1. **I1 — Scoped storage.** Public SDK namespace selection reaches the authoritative
   worker before preload; reads/preload/writes stay under that native root. New
   selections start empty, existing selections retain files, unrelated origin
   files remain untouched. Required OPFS failure rejects and tears down; preferred
   fallback is observable. Invalid namespace rejects before effects.
2. **I2 — Effective startup budget.** Public validated budget controls worker
   startup/hydration through the existing timer owner, including restart; defaults
   and covered phases are explicit. No shorter same-path timer defeats it. Below
   budget succeeds; timeout/close settles pending startup and tears down without
   orphan workers or late revival. Invalid/nonfinite/overflow values reject before
   worker/storage effects.
3. **I3 — Public snapshot-only application.** Packed producer → packed SDK/copied
   worker applies the existing archive and builds real Vite without browser
   registry/Eddy requests, dummy registry URL or host interpretation of private
   control/cache namespaces. Missing/corrupt/incompatible/oversized required input
   fails visibly; no hidden network-install fallback or new installation ledger.
4. **I4 — Ordinary saved access.** Readable saved state opens without installation
   completion checks, implicit acquisition or rewriting source/dependency files.
   Missing/pending/legacy proof and missing/corrupt lock do not deny files or
   independent Node commands. Only valid facts grant real adapter capabilities;
   missing/corrupt/incompatible dependencies/adapters fail at use. No fake adapter.
5. **I5 — Explicit conflict policy.** First application, saved open and explicit
   update have documented distinct behavior. No install-status inference chooses
   an application. Repeated/same-ID apply uses full source validation and generic
   conflict preflight: default error; force overwrites conflicting payload targets,
   including replaced-directory descendants, preserving every other path. Force
   cannot bypass integrity, runtime compatibility or persistence failures.
6. **I6 — Operation honesty after failure.** Application success follows its actual
   write/persistence settlement. Failure rejects; interruption cannot produce a
   false successful operation. Partial dependency files after reload do not impose
   an incomplete-install status or block ordinary access. Existing VFS recovery
   remains; source paths outside overwrite targets survive. No automatic install,
   obligatory retry or new rollback guarantee.

## Challenge

challenge: 2026-09-10 — clear

Revised independent `/root/sdk_open_decision` verdict, verbatim:

> challenge: 2026-09-10 — revised premise supported. User rejects persisted installation-status admission, including explicit-install-required after interrupted materialization. Ordinary saved access and independent commands remain available; dependency/adapter failures belong at use. Explicit validated snapshot application with optional conflict overwrite needs no completion ledger, automatic retry or rollback guarantee. No unresolved user-owned fork found. Preserve real input integrity, validated adapter facts and existing storage recovery; do not infer removal of unrelated Workbench transaction policy.

## Decisions

- 2026-09-10 — user selected refine of the first proposed group (#327–329); second-group #325/#326 remain independent drafts.
- 2026-09-10 — user: «Среда не должна знать статус установки … Если не получается поставить вываливается ошибка … флаг форса … перетри все что будет мешать»; source/meaning in refine evidence; ADR-0417.
- tier: robust — reachable input/storage/worker faults have honest outcomes; named interruption/reopen proof, without a new all-or-nothing crash transaction.
- Native Node v24.16.0 local-source/missing-dependency probe confirms point-of-use failure; full browser acceptance remains to implement/prove.
- Host owns source seeding, creation/update timing, URLs, namespace selection and migration; no host installation ledger is required.
- Existing literal namespace/default/fallback and bounded timer semantics reused from ADR-0402/0410; namespace is addressing, required OPFS is not eviction protection.
- rejected route: replace SDK with public Workbench — violates no-COI Outcome; Workbench still requires COI.
- rejected route: private archive extraction/global storage overrides/dist timer patch — violates published-SDK Outcome.
- rejected route: saved completion receipt or auto-recovery gate — violates I4/I6 and the user's round 1 decision.

Final written-result review: `/root/refine_final` at
`5bc41b01e3def0919f28c38c5320adbd58e88837`, PASS;
`docs/backlog/distribution/reference/no-coi-project-open-refine-final-green.json`.
Ready destination only; children require PICKUP/Contract+RED before implementation.
