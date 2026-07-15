---
kind: epic
status: ready
title: Fault-honest OPFS persistence — reload never trusts torn state, durability gates never park
created: 2026-07-05
value: After any mid-write failure or worst-moment reload (quota, crash, wedged handle), the project a developer reopens is provably honest — the operation fully took effect or cleanly didn't; durability checks answer within a bound instead of parking forever.
user_story: As a developer, I want to close or reload the tab at ANY moment — mid `npm install`, mid `git commit`, mid editor save — and reopen to a correct project, but today the git ref path has no torn-write tests, a wedged OPFS op parks every durability gate forever, and no e2e ever kills the page at the worst moment.
items: [vfs/iso-git-ref-torn-write-rows, vfs/persist-ledger-fault-rows-completion, playground/reload-crash-consistency-fault-e2e]
---

## Outcome

PR #107 built the honest core for ONE flow: the persist-failure ledger gates the install stamp (record-on-fail, heal-on-success, revoke-proof, ancestor/rename heal). This epic finishes the layer on the remaining `torn-state` / `quota-perm-fail` / `unbounded-read` axes (`docs/process/fault-classes.md`): a watchdog so a hung OPFS op can't park `flush()` (and with it every stamp/boot gate), torn-write rows for iso-git refs (reload mid-commit must not corrupt the graph), the missing ledger rows (rename quota-stage, mid-queue isolation, consumer-visible tarball/pins persistence), and one end-to-end crash-consistency e2e that kills the page at the worst moments and asserts honesty after reload.

Boundaries verified as ALREADY honest at refine (2026-07-05), no items needed: corrupt persisted artifacts degrade gracefully by construction — install stamp (corrupt JSON = absent → reinstall), learned pins (corrupt/TTL/cap tested in #107), tarball cache (integrity re-verified on every get → corrupt = miss + refetch). Oversized-pins row REJECTED: the file is rifty-written, capped at 64 entries — no external writer. The dissolved `fault-honest-npm-install` epic's residual consumer rows live in `vfs/persist-ledger-fault-rows-completion`.

## User scenario

A developer runs `npm install` in a vite preset and closes the tab before it finishes: reopening shows no stamp, install re-runs to completion (npm parity — rerun just works). They `git commit` and instantly reload: the repo opens clean — the commit is fully there or cleanly absent, `git log`/`status` behave like real git at that state, never a torn HEAD. Their disk quota runs out mid-session: the live session keeps working from memory, `npm install` finishes but says loudly the tree isn't durable (no stamp), and the next boot re-installs instead of trusting a torn tree — and none of these checks ever hangs the boot, even if an OPFS handle wedges.

## Items

- `vfs/iso-git-ref-torn-write-rows` (ready) — torn object/ref writes: repo opens clean after any single persist failure + reload.
- `vfs/persist-ledger-fault-rows-completion` (ready) — pin the missing ledger rows: rename quota-stage, mid-queue isolation, consumer-visible tarball-put/pins-write degradation.
- `playground/reload-crash-consistency-fault-e2e` (ready) — Playwright kills/reloads mid-install / mid-restore / mid-commit / mid-save → honest project after reopen.
