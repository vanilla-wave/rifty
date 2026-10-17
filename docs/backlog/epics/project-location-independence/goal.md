---
kind: epic
status: ready
title: Project location independence — the project lives at `/home/project`, `/tmp` and `$HOME` belong to it, the root is a parameter, and at `/` rifty takes upstream's own code paths
created: 2026-10-15
value: A developer's real Node program and toolchain (Vite 7/8 starters, npm, the Node parity programs) behave as on real Node at the shipped location `/home/project` and at any other supported location; temp and home paths exist and belong to the project instead of landing in its visible tree or failing ENOENT; the two installed-Vite root patches are gone, and a project placed at `/` takes the code paths real Node + Vite take there (oracle: evidence §Root configured runs).
user_story: As a developer running a real Node program in rifty, I want it to behave as on real Node wherever the project lives and to have a working `/tmp` and `$HOME`, but today the project is pinned at the filesystem root `/` (ADR-0280), `os.tmpdir()` and `os.homedir()` point inside the project and do not exist (ENOENT), and two Vite patches exist only because the project root is `/`
tier: works
---

## Outcome

Physically nothing moves: one OPFS directory per project (ADR-0165 `/scratch`,
`/projects/<id>/`), one active project, switching respawns the owner
(ADR-0280 isolation unchanged). What a program sees changes: the active
project is `/home/project`; `/` is a real root that is not the project;
`os.tmpdir()` → `/tmp` and `os.homedir()` → `/home/rifty` exist, are writable,
and belong to the active project — stored in its private area (outside the
visible tree, snapshots and archives), surviving reload, never shared between
projects. The public root string is a parameter of ADR-0280's projection seam
(default `/home/project`), set by the host/SDK/template, never a playground
UI; a project placed at `/` takes the code paths real Node + Vite take at `/`
(the same tree; rifty has no `/proc`) — including Vite's own defects there —
with the two root policies deleted from the installed bytes. Faithful-runtime payoff: programs take the code
paths they take on real machines; the Vite root patches and the `/tmp`
ENOENT class disappear together.

## User scenario

1. The developer opens the Vite 7 starter. In the terminal `pwd` prints
   `/home/project`; `ls /` shows `home` and `tmp`, not the project files;
   `vite` dev + HMR, `vite build` and `vite preview` work as before; the
   React starter edit updates in place with one Refresh module URL.
2. `node -e "const fs=require('fs'),os=require('os'),p=require('path');console.log(os.tmpdir(),os.homedir(),process.cwd());console.log(fs.mkdtempSync(p.join(os.tmpdir(),'x-')));fs.writeFileSync(p.join(os.homedir(),'.npmrc'),'x')"`
   prints `/tmp /home/rifty /home/project` and a created temp dir (today:
   `MKERR ENOENT`, `HOMEERR ENOENT`); the file explorer, a saved snapshot and
   an exported archive show neither `tmp/` nor `home/`; after a page reload
   `~/.npmrc` is still there; switching to another project shows a different,
   empty `~`.
3. `node_modules/vite/dist/node/chunks/config.js` is byte-identical to the
   upstream tarball member (no `viteRootWatchPatchPolicy` /
   `viteRootUrlPatchPolicy`); a project deliberately configured at `/` serves
   `/src/App.jsx` importing `/@id//@react-refresh` beside a preamble
   `/@react-refresh`, as real Node 24 + Vite 7.3.6 does at `/` (evidence §Root
   run 5; oracle configs: watcher off + explicit optimizer entry, and runs
   2-3 for the phantom config restart) — documented, not repaired. Vite 8 at
   `/`: byte identity only, no real-Node artifact yet.
4. The Vite 7 starter build/dev+HMR/preview and the Vite 8 starter
   build/dev (an edit served after reload; its template keeps
   `server.hmr: false`, ADR-0161)/preview lanes run at the default and,
   through the same host/SDK/template parameter, at a second non-root
   location (e.g. `/srv/app`) with identical observable results; at `/` the
   build/preview lanes pass and the dev lane asserts the documented
   Vite-at-`/` behavior.
Done when 1–4 run as browser-unit/e2e lanes on the default lane, with the
real-Node artifacts of evidence §Root as the `/` oracle.

## Invariants

<!-- Each checked false on main `9645c62bf` (2026-10-15); command + output in
     `docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md`:
     I1 — §Location probe: `pwd` → `/`, `ls -a /` lists `package.json src
          node_modules …`; ADR-0280 Decision "Public `/` maps to its exact
          physical tree"; public cwd `'/'` literals `pty-client.ts:182,800,919`,
          `workbench-browser-owner-spawn.ts:62,76`, `playground-terminal-state.ts:69`,
          `project-runtime-acquisition.ts:12`.
     I2 — §Location probe: `OS /tmp /home/rifty /` then `MKERR ENOENT`,
          `HOMEERR ENOENT`; `os.ts:13-18`; no code seeds or reserves `/tmp`.
     I3 — `vite-cli-install-policy.ts:11-14,44-47` policies exist;
          `vite-cli-prep.ts:110-117` refuses an unpatched tree; §Root run 5
          real-Node artifact.
     I4 — no root parameter exists (7 cwd literals above); no lane runs a
          starter at a second location through ADR-0280's seam (the
          node-parity-runner `cwd` is a harness knob below that seam). -->

1. I1. Programs see the active project at `/home/project`: `pwd`,
   `process.cwd()`, Vite's printed root, terminal and diagnostic absolute
   paths agree; `/` is a real root that does not contain the project files;
   the physical OPFS layout and project isolation (ADR-0165, ADR-0280) are
   unchanged.
2. I2. `os.tmpdir()` → `/tmp`, `os.homedir()` → `/home/rifty` and
   `process.env.HOME=/home/rifty` exist and are writable (`fs.mkdtemp`,
   `~/.npmrc`), belong to the active project — persisted with it across
   reload, absent from the visible tree, snapshots and archives, and not
   shared with other projects.
3. I3. The installed Vite 7 and Vite 8 bundles carry no root-location policy
   (`chunks/config.js` byte-identical to upstream); a Vite 7.3.6 project placed
   at `/` takes the code paths real Node 24 + Vite 7.3.6 take at `/` (evidence
   §Root runs 2-3/5 with their configs as the oracle), documented as behavior,
   not repaired; Vite 8 at `/` is covered by byte identity only.
4. I4. The public root is one host/SDK/template parameter with default
   `/home/project`; the Vite 7 starter build/dev+HMR/preview and the Vite 8
   starter build/dev (edit served after reload; template `server.hmr: false`,
   ADR-0161)/preview lanes pass at
   the default and, through the same parameter, at a second non-root location
   with identical observable results; at `/` build/preview pass and dev
   asserts I3's documented behavior.

## Challenge

challenge: 2026-10-15 — 5 problems (all resolved; record: evidence file
§Review record)

Fresh read-only critic over the handoff §B, the user's quoted statements, evidence
§Root/§Location probe, goal/map/3 children, ADR-0280/0165/0278/0433/0384:
1. I4 leaned on the node-parity-runner `cwd` (a harness knob below the
   ADR-0280 seam) and on "same lanes pass at `/`" (undefined under I3) →
   reworded: default + second non-root location through the parameter; the
   `/` leg = I3's lane with explicit outcomes.
2. DEC-2 understated → child 2 supersedes ADR-0280's Decision (+ ADR-0278
   §Corrections), child 3 removes ADR-0433; child 1 only cites.
3. I2's reload persistence and tree/snapshot/archive exclusion were credited
   to the user's «TMP фактически принадлежит проекту» → split into `agent:` derivations with their authorities.
4. Who sets the root was hidden in "carrier agent-owned" → recorded: host/SDK/
   template parameter, playground starters always at `/home/project`, no UI
   (user-observable: a playground user cannot relocate a project — reported).
5. Child 3 rested on open fog → `/tmp`/`$HOME` at root `/` (loud collision,
   item 2 ADR) and the Vite 8 artifact gap are explicit fog; I3 pins the Vite
   7.3.6 oracle configs and limits Vite 8 to byte identity.
Advisories taken: `HOME` env in I2; persisted-cwd fallback target in child 2;
synthetic-`/` listing moved to child 1; "nest the project inside the tree"
and "reserve `/tmp`,`/home` under `/`" recorded as rejected routes; title says
"takes upstream's own code paths" rather than "Node-exact".

## Decisions

- tier: works — honest happy path at two locations; no crash/reload or
  fault-injection promise beyond existing persistence contracts (2026-10-15).
- 2026-10-15 — user: «Один эпик + отдельная цель для корня (Recommended)» —
  this directory is that separate goal.
- 2026-10-15 — user: «мы смешали надежность доказаность и дефолт платформы.
  Проекты должны уметь корректно работать где бы они не находились. При этом
  расположение проекта как будто и настраиваться может и это обратимое
  решение» — correctness at every location is the obligation (I4); the
  default is a configurable product default.
- 2026-10-15 — user: «Дефолт — home-like путь (/home/project)» — I1.
- 2026-10-15 — user: «Снять патчи — быть Node-точным в `/` (сломанным)» — I3.
- 2026-10-15 — user: «физически мы ничего не трогаем, но то, что видит
  программа стартовой директории становится какой-нибудь slash Home. Тогда и
  TMP фактически принадлежит проекту, и хоум фактически принадлежит проекту.
  Всё остаётся работать как есть. Кроме того, что мы не спавним проект в корне
  файловой системы и избегаем приколов с vite.» — I2 core: `/tmp` and `$HOME`
  belong to the active project (hence not shared), physical layout unchanged,
  project not at the filesystem root.
- 2026-10-15 — agent (I2 derivations, not the user's words): reload
  persistence follows from storing the areas in the project's OPFS directory
  (ADR-0165 durability; clearing `/tmp` at reload would be extra machinery,
  REV-7); exclusion from the visible tree, snapshots and archives follows
  from the reserved `/.rifty` carrier (ADR-0280 reserved prefix; ADR-0278:613
  archive exclusion); `process.env.HOME=/home/rifty` so shell `cd` and CLIs
  reading `$HOME` agree with `os.homedir()` (ADR-0280 allows constant env).
- 2026-10-15 — agent: the paths `/tmp` and `/home/rifty` are today's
  `os.ts:13-18` values retained (the user named no path); not a new choice.
- 2026-10-15 — agent: who sets the root — a host/SDK/template parameter used
  by tests and embedders; playground starters always run at `/home/project`,
  no playground UI (REV-7: nobody asked for one; «настраиваться может» names no persona).
- 2026-10-15 — agent: at root `/` the project-owned areas stay mounted at
  `/tmp` and `/home/rifty`; a project tree carrying its own `tmp/` or `home/`
  at that location is reported loudly at spawn, never silently shadowed —
  exact form in child 2's ADR.
- 2026-10-15 — user: «Давай так и оставим.» (on the fixed `/home/project` for
  whichever project is active) — I1 path is fixed, no project name in it.
- 2026-10-15 — agent: sequencing — the default moves first, the root policies
  are deleted after (I3 after I1/I4), so the shipped starters never break at
  the default; carriers (parameter form, private-area prefix such as the
  reserved `/.rifty`, what else `/` lists) are agent-owned at pickup.
- 2026-10-15 — agent (DEC-2): child 2 overturns ADR-0280's Decision "Public
  `/` maps to its exact physical tree" (and its `/`-rooted traversal /
  destructive-mutation clauses) → superseding ADR naming it + dated
  §Corrections note on ADR-0280; ADR-0278 `:613-615` (archive root `/`) and
  `:196-204` (cwd fallback to `/`) → §Corrections note (archive root = project
  root; cwd fallback = project root); child 3 overturns all of ADR-0433 →
  ADR removed + pointer in `docs/adr/README.md`. ADR-0165 layout/switch and
  ADR-0280 isolation stay. Child 1's parameter ADR cites ADR-0280 without
  overturning it (default still `/`).
- amend: 2026-10-17 — user: «ок» on «Поправить I4: для Vite 8 dev — «правка
  видна после reload» по текущей политике стартера. Включение HMR у Vite 8 —
  отдельная цель.» — I4/scenario 4: the Vite 8 dev leg is an edit served after
  reload (template `server.hmr: false`, ADR-0161); Vite 8 HMR is outside this goal.
- rejected route: keep `/` and patch each upstream edge — violates I3 and
  Outcome ("code paths they take on real machines").
- rejected route: per-project path `/home/projects/<name>` — user chose the
  fixed path («Давай так и оставим»); renaming a project would change
  absolute paths (I1 stability).
- rejected route: one namespace showing every project (`cd` between them) —
  violates Outcome clause "one active project, switching respawns the owner"
  (ADR-0280 isolation, ADR-0165); user took the fixed path («Давай так и
  оставим»).
- rejected route: session-only `/tmp`/`$HOME` (agent's earlier
  recommendation) — violates I2 "belong to the active project" as derived
  above; agent decision.
- rejected route: nest the project inside its physical tree (files under
  `home/project/`, `tmp/`, `home/rifty/` as ordinary dirs, no parameter) —
  violates the user's «физически мы ничего не трогаем» and I2 (tmp/home would
  enter the explorer, `git status` and archives).
- rejected route: reserve `/tmp` and `/home` under `/` without moving the
  project — closes I2 only; violates I1/I3 (project still at the root, root
  patches stay).
- rejected route: shared persistent `$HOME` across projects — violates I2
  ("not shared"); needs a new storage authority outside projects.
