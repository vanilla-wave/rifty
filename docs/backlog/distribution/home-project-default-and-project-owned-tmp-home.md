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
archives (which enumerate `tree/`) exclude them by construction and a project
switch shows a different `~`; the synthetic `/` lists only the ancestors of the
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
3. The Files API root listing contains no `tmp`/`home` entry after row 2 → I2, scenario 2
4. Durable workspace: `~/.npmrc` and `/tmp/keep.txt` survive closing and
   reopening the Workbench; a second project opened in the same Workbench lists
   an empty `~` and `/tmp`, and the first still has its own after switching back → I2, scenario 2
5. Vite 7 starter at the default and at `publicProjectRoot: '/srv/app'`:
   `vite build` (✓ built, `dist/assets/*.js`), dev server ready + an edit of
   `src/main.js` updates `#app` in place over HMR (no reload), `vite preview`
   serves the built `index.html`; at `/srv/app` `pwd` → `/srv/app`, `ls /` →
   `home srv tmp` → I4, scenario 4
6. Vite 8 starter `vite build` + `vite preview` at the default and at `/srv/app` → I4, scenario 4
7. `publicProjectRoot: '/'`: `pwd` → `/`; `ls /` lists the project files plus
   `home` and `tmp`; `vite build` passes → I4
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
- 2026-10-16 — carriers (map fog): Workbench option `publicProjectRoot`;
  private areas `<container>/guest/{tmp,home}`; synthetic `/` = mount
  ancestors; cross-mount rename `EXDEV`; `/` root with own `tmp`/`home` →
  loud refusal; superseding ADR names ADR-0280's Decision + ADR-0278
  §Corrections (DEC-2).
