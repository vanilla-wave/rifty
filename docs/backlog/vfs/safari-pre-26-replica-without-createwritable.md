---
area: vfs
status: draft
title: Admit Safari/iOS 16.4–25 by writing the OPFS replica through sync access handles instead of createWritable
created: 2026-09-27
why: `createWritable` is the only Safari-26 requirement; every other non-COI requirement is met from Safari 16.4; that band is 4.895 % global / 1.784 % RU of all tracked traffic (caniuse-lite 1.0.30001793; research: 3 / 1.2 p.p. of the external host's admitted traffic) and shrinking with Safari 26 adoption (62–64 % of desktop Safari already)
sources: [ADR-0469, docs/backlog/distribution/reference/browsers-compat-matrix-evidence.md]
code: [packages/vfs/src/opfs-replica-store.ts, packages/vfs/src/opfs.ts, packages/vfs/src/opfs-errors.ts]
---

## Question

Is the widening worth its cost, and when. Cost: replica durability today rides `createWritable`'s atomic swap (Chromium `.crswap`, `opfs-errors.ts:62-89`); sync-access-handle writes are in-place, so HEAD/segment atomicity and crash consistency must be re-derived and carried by a fault matrix (`docs/backlog/README.md` §Tier robust/production of `epics/fault-honest-opfs-persistence`); `opfs.ts` non-replica path too. Value decays monthly. Outside `epics/browser-support-floor` — user 2026-09-27 "2a" (record only). Trigger: a host naming Safari <26 traffic it cannot drop, or a 2027-03 re-read of the share.

## User scenario

A host embeds the non-COI tier; an iPhone on iOS 18.6 opens it; today `createSandbox` with storage selects opfs and the first write fails; after `vfs/opfs-createwritable-capability-gate` it runs ephemeral under `preferred` and is refused under `required`; with this change install/build persist on that device.

## Out of scope

COI on WebKit (D-001, separate question); external hosts' own main-thread `createWritable` use.

## Decisions

- 2026-09-27 — recorded as question, not scheduled — user "2a"
