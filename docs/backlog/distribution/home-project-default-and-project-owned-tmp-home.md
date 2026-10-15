---
area: distribution
status: draft
title: The default public root becomes `/home/project`, and `/tmp` and `/home/rifty` are project-owned private areas that exist, persist with the project and stay out of its visible tree, snapshots and archives
created: 2026-10-15
why: at the shipped default `/` the project is the filesystem root, so `os.tmpdir()` and `os.homedir()` resolve inside the project and do not exist (`mkdtemp` → ENOENT), and upstream code takes untested root-edge paths; the user chose `/home/project` as the default with temp/home owned by the project
user_story: As a developer, I want `pwd` to show `/home/project`, `fs.mkdtemp(os.tmpdir())` and `~/.npmrc` to work and survive a reload without polluting my project tree, snapshot or archive, but today both paths are ENOENT and would land inside the project
epic: project-location-independence
blocked_by: [distribution/public-project-root-parameter]
sources: [ADR-0280, ADR-0278, ADR-0165, docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md]
code: [packages/runtime-js/src/builtins/os.ts, packages/workbench/src/workbench/project-file-boundary.ts, apps/playground/public/snapshots, apps/playground/src/generated/baked-snapshot-identities.json]
---

## Context

Finding (2026-10-15, evidence §Location probe on `9645c62bf`): `pwd` → `/`;
`ls -a /` lists the project files; `OS /tmp /home/rifty /` then `MKERR
ENOENT`, `HOMEERR ENOENT` (`os.ts:13-18` returns the paths; nothing seeds
them). User decision (goal §Decisions): physically nothing moves; the project
is seen at `/home/project`; `/tmp` and `/home/rifty` belong to the project —
stored in its private area (candidate: the reserved `/.rifty` prefix of
ADR-0280, which ADR-0278 already excludes from archives), reload-persistent,
absent from the explorer/snapshot/archive, not shared between projects —
the persistence/exclusion derivations are the agent's (goal §Decisions).
`process.env.HOME=/home/rifty` is set so shell `cd` (`cd.ts:14` falls back to
`$HOME ?? '/'`) and CLIs agree with `os.homedir()`. At root `/` the areas
stay mounted at `/tmp`/`/home/rifty`; a tree carrying its own `tmp/`/`home/`
there is reported loudly at spawn (form in this unit's ADR). This unit
supersedes ADR-0280's Decision ("Public `/` maps to its exact physical
tree", `/`-rooted traversal and destructive-mutation clauses) with a
superseding ADR naming it by number plus a dated §Corrections note on
ADR-0280, and corrects ADR-0278 `:613-615` (archive root = project root) and
`:196-204` (persisted-cwd fallback = project root) — DEC-2.

Acceptance shape expected at pickup: default root `/home/project`; `ls /`
shows `home`, `tmp` and no project files; scenario 2 of the goal passes as a
browser-unit test (mkdtemp, `~/.npmrc`, reload, project switch → empty `~`);
snapshot/archive exclusion tests; cwd literals replaced by the parameter;
printed paths in terminal/diagnostics; e2e assertions on absolute paths and
baked snapshots (`pnpm snapshots:bake`, `check:snapshot-artifact-drift`)
updated; compat row for the project-owned `$HOME` (Node divergence: not shared
across projects).

Dedup: no title/`code:`/map/declined match.

## Challenge

<!-- finding capture under a fitted goal — premise checked at the goal (README §Challenge) -->
