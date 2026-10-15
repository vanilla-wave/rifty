---
area: distribution
status: ready
title: The guest sees the active project at a public root parameter (default `/home/project`), with project-owned `/tmp` and `/home/rifty` that exist, persist with the project and stay out of its visible tree, snapshots and archives
created: 2026-10-15
why: at the shipped default `/` the project is the filesystem root, so `os.tmpdir()` and `os.homedir()` resolve inside the project and do not exist (`mkdtemp` → ENOENT), upstream code takes untested root-edge paths, and no lane can prove a program behaves the same at another location; the user chose `/home/project` as the default with temp/home owned by the project
user_story: As a developer, I want `pwd` to show `/home/project`, `fs.mkdtemp(os.tmpdir())` and `~/.npmrc` to work and survive a reload without polluting my project tree, snapshot or archive, and my project to behave the same at another location, but today the project is `/`, both paths are ENOENT and would land inside the project
epic: project-location-independence
blocked_by: []
sources: [ADR-0280, ADR-0278, ADR-0165, docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md]
code: [packages/workbench/src/workers/project-terminal-namespace.ts, packages/workbench/src/workers/node-entry-remote-fs.ts, packages/workbench/src/workers/workbench-project-runtime.ts, packages/workbench/src/workbench/internal/workbench-options.ts, packages/runtime-js/src/builtins/os.ts, packages/runtime-js/src/builtins/node-entry-runtime-config.ts]
---

## Context

Finding (2026-10-15, evidence §Location probe on `9645c62bf`): `pwd` → `/`;
`ls -a /` lists the project files; `OS /tmp /home/rifty /` then `MKERR
ENOENT`, `HOMEERR ENOENT` (`os.ts:13-18` returns the paths; nothing seeds
them). User decision (goal §Decisions): physically nothing moves; the project
is seen at `/home/project`; `/tmp` and `/home/rifty` belong to the project —
not shared between projects; the root is a host/SDK/template parameter, never a
playground UI. Agent carriers (map fog, decided here, ADR at implementation):
the parameter is the Workbench option `publicProjectRoot` (absolute,
normalized; `/` allowed); the private areas live in the project container beside
`tree/` (`<container>/guest/{tmp,home}`), so the visible tree, snapshots and
archives (which enumerate `tree/`) exclude them by construction, a project
switch shows a different `~`, Save (convert) carries them with the scratch
that becomes the project, and deleting a project deletes them; the synthetic `/` lists only the ancestors of the
mounts (`home`, `tmp`, first segment of a non-default root); other system paths
stay ENOENT as today. Files/Documents/SCM/TS and terminal-state persistence keep
project-relative paths (`/` = project root, ADR-0278).

## Challenge

challenge: 2026-10-15 — clear (goal premise, `epics/project-location-independence` §Challenge)

## Acceptance

Carrier: `tests/browser-unit/project-location.spec.ts` (Chromium, sealed
Workbench; the parameter passed through `bootOwner`), unless named.

1. Default location, Vite 7 starter: `pwd` and `node -e "console.log(process.cwd())"`
   print `/home/project`; `ls /` lists exactly `home tmp`; `ls /home` exactly
   `project rifty` → I1, scenario 1
2. The scenario-2 line prints `/tmp /home/rifty /home/project` then a created
   `/tmp/x-??????`; `echo $HOME` → `/home/rifty`; bare `cd; pwd` → `/home/rifty`;
   `cat ~/.npmrc` → `x` (unquoted word-initial `~`, `~/…` expand to `$HOME`, as
   bash) → I2, scenario 2
3. After row 2 the Files API root listing and the exported project archive
   contain no `tmp`/`home` entry and no `.npmrc` → I2, scenario 2
4. Durable workspace: `~/.npmrc` and `/tmp/keep.txt` survive closing and
   reopening the Workbench; Save (convert, ADR-0165: the scratch becomes the
   project) carries them into the saved project; a project from a fresh scratch
   lists an empty `~` and `/tmp`; switching back, the saved project still has its own → I2, scenario 2
5. Vite 7 starter at the default and at `publicProjectRoot: '/srv/app'`:
   `vite build` (✓ built, `dist/assets/*.js`), dev server ready + an edit of
   `src/main.js` updates `#app` in place over HMR (no reload), `vite preview`
   serves the built `index.html`; at `/srv/app` `pwd` → `/srv/app`, `ls /` →
   `home srv tmp` → I4, scenario 4
6. Vite 8 starter at the default and at `/srv/app`: `vite build`, dev server
   ready + an edit of `src/main.js` served after reload (template policy
   `server.hmr: false`), `vite preview` serves the built `index.html` → I4, scenario 4
7. `publicProjectRoot: '/'`: `pwd` → `/`; `ls /` lists the project files plus
   `home` and `tmp`; Vite 7 `vite build` and `vite preview` pass (dev at `/` is
   I3, carried by `npm-client/vite-root-policies-removal-node-exact-at-root`) → I4, scenario 4
8. `publicProjectRoot: '/'` with a project file `/tmp/own.txt`: `ls /tmp` and
   `ls /` fail `EEXIST` naming `/tmp` instead of shadowing it → I2
9. A guest diagnostic carries the public path: `node missing.cjs` →
   `Cannot find module '/home/project/missing.cjs'` → I1
10. Namespace edges: `touch /x` and `mkdir /home/x` fail `EACCES`;
    `rm -rf /home/project` fails `EPERM`; `mv /tmp/a /home/project/a` fails
    `EXDEV` (separate mount; `cp` works) → ADR-0531
11. `os.homedir()`/`os.tmpdir()` follow `HOME`/`TMPDIR` as Node (`HOME=/tmp
    node -e "…homedir()"` → `/tmp`; `TMPDIR=/home/rifty/t/` → `/home/rifty/t`) → I2

## Parity cases

1. Node v24.16.0: `HOME=/tmp node -e "console.log(require('os').homedir())"` →
   `/tmp`; `TMPDIR=/x/ node -e "console.log(require('os').tmpdir())"` → `/x`
   (trailing slash stripped) — carrier Acceptance 11 → I2

## Out of scope

- Repairing Vite at `/` and deleting the root policies —
  `npm-client/vite-root-policies-removal-node-exact-at-root`.
- `/dev/null`, `/etc`, `/usr` and other system paths: ENOENT, unchanged.
- A playground UI for the location — goal §Decisions.
- The no-COI SDK sandbox (`packages/rifty` `toolchain.*`): embedder-chosen
  absolute paths, no project namespace.

## Decisions

- re-cut: 2026-10-16 — merged `distribution/public-project-root-parameter`
  (parameter + second-location lanes, default unchanged) into this unit: both
  ride one PR, the parameter's null case is proven by the same lanes at the
  flipped default, and one Contract+RED covers the seam once — trace: none
- 2026-10-16 — Contract+RED BLOCK @ 7b0595c24 (codex): B1 scenario 4 needs Vite 8
  dev at both non-root locations and preview at `/` — HOLDS, rows 6-7 + RED;
  concerns taken: archive row 3, Save carries `guest/` (ADR-0165 convert), ADR
  attribution, `tree/.rifty` evidence (evidence file §Location carriers), the
  switch test's lifecycle.
- 2026-10-16 — Contract+RED BLOCK @ 7e07a27d6 (codex): B2 switch test lacked
  `catalog.activate` for the saved project, B3 dev helpers wrote a non-fixture
  path — both HOLDS (test bugs), fixed; Files/snapshot rows also check `/.npmrc`.
- 2026-10-16 — carriers (map fog): Workbench option `publicProjectRoot`;
  private areas `<container>/guest/{tmp,home}`; synthetic `/` = mount
  ancestors; cross-mount rename `EXDEV`; `/` root with own `tmp`/`home` →
  loud refusal; superseding ADR names ADR-0280's Decision + ADR-0278
  §Corrections (DEC-2).
