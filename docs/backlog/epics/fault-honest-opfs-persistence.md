---
kind: epic
status: ready
title: Fault-honest OPFS persistence — reload never trusts torn state, durability gates never park
created: 2026-07-05
value: After a mid-write failure or reload, own metadata recovery and durability reports remain honest; readable saved projects stay accessible even when npm installation is incomplete, without implicit reinstall or a false completed-install claim; durability checks answer within a bound.
user_story: As a developer, I want to close or reload the tab at ANY moment — mid `npm install`, mid `git commit`, mid editor save — and reopen to a correct project, but today the git ref path has no torn-write tests, a wedged OPFS op parks every durability gate forever, and no e2e ever kills the page at the worst moment.
---

## Outcome

PR #107 built the honest core for ONE flow: the persist-failure ledger gates the install stamp (record-on-fail, heal-on-success, revoke-proof, ancestor/rename heal). This epic finishes the layer on the remaining `torn-state` / `quota-perm-fail` / `unbounded-read` axes (`docs/process/fault-classes.md`): a watchdog so a hung OPFS op can't park `flush()` (and with it every stamp/boot gate), torn-write rows for iso-git refs (reload mid-commit must not corrupt the graph), the missing ledger rows (rename quota-stage, mid-queue isolation, consumer-visible tarball/pins persistence), and one end-to-end crash-consistency e2e that kills the page at the worst moments and asserts honesty after reload.

Boundaries verified at original refine (2026-07-05): corrupt install-stamp JSON cannot certify a completed tree; learned pins (corrupt/TTL/cap tested in #107); tarball cache (integrity re-verified on every get → corrupt = miss + refetch). Saved-open behavior after absent trust follows the 2026-09-10 amendment below, replacing the original automatic-reinstall assumption. Oversized-pins row REJECTED: the file is rifty-written, capped at 64 entries — no external writer. The dissolved `fault-honest-npm-install` epic's residual consumer rows live in `vfs/persist-ledger-fault-rows-completion`.

## User scenario

A developer runs `npm install lodash` in an already saved snapshot-created Vite project and closes the tab before completion. Reopen preserves access to saved sources and the terminal, without automatic install or snapshot restore. Commands use the actual files; missing packages fail when used. The user may explicitly rerun install. They `git commit` and instantly reload: the repo opens clean — the commit is fully there or cleanly absent, `git log`/`status` behave like real git at that state, never a torn HEAD. Their disk quota runs out mid-session: the live session keeps working from memory, and failure to durably save the installed tree is reported honestly. The next readable saved open exposes the persisted files without certifying the incomplete install or implicitly reinstalling. Own transaction recovery and unreadable-storage failures retain their existing outcomes; none of the durability checks hangs indefinitely when an OPFS handle wedges.

## Items

- `vfs/iso-git-ref-torn-write-rows` (ready) — torn object/ref writes: repo opens clean after any single persist failure + reload.
- `vfs/persist-ledger-fault-rows-completion` (ready) — pin the missing ledger rows: rename quota-stage, mid-queue isolation, consumer-visible tarball-put/pins-write degradation.
- `playground/install-stamp-invalidation` (draft) — readable saved files and terminal open independently of install trust; commands fail at actual dependency use.
- `playground/reload-crash-consistency-fault-e2e` (draft) — Playwright kills/reloads mid-install / mid-restore / mid-commit / mid-save → honest project after reopen; new npm row awaits RED.

## Decisions

- amend: 2026-09-10 — user: «да, ок, ровно поведение node» to the concrete saved Vite → interrupted `npm install lodash` → reopen files/terminal without auto-install scenario; replaces automatic npm rerun and all-or-nothing npm-tree implications, preserves own transaction recovery and no false completion claims. Raw exchange and probe: `docs/backlog/playground/reference/project-open-ide-boundaries-refine.md`.
- 2026-09-10 — original npm clause: "A developer runs `npm install` in a vite preset and closes the tab before it finishes: reopening shows no stamp, install re-runs to completion (npm parity — rerun just works)." Ordinary metadata/Git/save guarantees are not weakened by the npm amendment.
