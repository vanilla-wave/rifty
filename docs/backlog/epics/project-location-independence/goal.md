---
kind: epic
status: draft
title: Project location independence — a project runs correctly wherever it lives, and where it lives is a configurable, reversible default
created: 2026-10-15
value: A developer's real Node program and toolchain (Vite 7/8 starters, npm, the Node parity programs) behave as on real Node whether the project is at `/` or under a home-like path, temp/home paths do not land inside the project, and the default location can be chosen without re-architecting the namespace.
user_story: As a developer running a real Node program in rifty, I want it to behave as on real Node wherever the project lives — at `/` or under a path like `/home/project` — and to be able to choose that location, but today the location is a fixed implicit `/` (ADR-0280), `os.tmpdir()`/`os.homedir()` resolve inside my project, and the two installed-Vite root patches exist only because the project root is the filesystem root
---

## Outcome

<!-- Draft FIT input (rifty-refine 2026-10-15). Two separate things the user
     named: (1) correctness at every location is a parity obligation;
     (2) the default location is a reversible, configurable product default.
     The default itself is unanswered (owner: user, map.md). The temp/home
     clause below is AGENT-PROPOSED from evidence §Root, not the user's words —
     the user decides it at FIT. -->

A project behaves as on real Node at any supported location; the public root
string is a parameter of ADR-0280's projection seam (public root → physical
tree), not a hard-coded `/`. Agent-proposed, to confirm at FIT: `os.tmpdir()`
and `os.homedir()` resolve outside the project. Which default ships is the
user's choice (map.md fog).

## User scenario

1. The Vite 7 and Vite 8 starters run `vite build`, `vite dev` + HMR and
   `vite preview` at the current location and at a non-root location, with
   the same observable result; the Node parity runner passes at both.
2. `fs.mkdtemp(path.join(os.tmpdir(), 'x-'))` and `os.homedir()` resolve
   outside the project tree at either location (today: inside the project
   per `os.ts:13-18` + ADR-0280; the ENOENT is expected, unprobed).
3. A Workbench/SDK knob (or template field) selects the public root; the
   default is the one the user chooses; archives (project-relative, ADR-0278)
   and snapshots (template-keyed) are unaffected by the choice.

## Invariants

<!-- To draft at FIT after the default-location answer; each must be checked
     false on current main with evidence. Known-false facts on `9645c62bf`:
     public cwd `'/'` literals (`pty-client.ts:182,800,919`,
     `workbench-browser-owner-spawn.ts:62,76`, `playground-terminal-state.ts:69`,
     `project-runtime-acquisition.ts:12`); `os.ts:13-18` `/tmp`, `/home/rifty`
     inside the project; no non-root-location lane exists. -->

## Challenge

<!-- At FIT. -->

## Decisions

- 2026-10-15 — user: «Один эпик + отдельная цель для корня (Recommended)» —
  this directory is that separate goal; seeded `draft` at the refine of
  `honest-guest-package-adaptations`.
- 2026-10-15 — user: «мы смешали надежность доказаность и дефолт платформы.
  Проекты должны уметь корректно работать где бы они не находились. При этом
  расположение проекта как будто и настраиваться может и это обратимое
  решение» — correctness at every location is the obligation; the default is
  a configurable, reversible product default.
- 2026-10-15 — agent: changing the public root string still touches ADR-0280's
  Decision ("Public `/` maps to its exact physical tree") and ADR-0433
  §Alternatives (rejected changing the root) → a short ADR citing both at
  FIT/PICKUP (DEC-1 p3), even though the product default is reversible.
- 2026-10-15 — agent: the two Vite root policies are classified by the
  real-Node-at-`/` artifact in `honest-guest-package-adaptations`
  (`docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md`
  §Root); they stay while `/` is a supported location.
