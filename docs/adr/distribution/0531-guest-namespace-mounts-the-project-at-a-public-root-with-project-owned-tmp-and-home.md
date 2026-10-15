# ADR 0531: Guest namespace mounts the project at a public root with project-owned tmp and home

Status: Accepted
Date: 2026-10
Supersedes: ADR-0280 Decision "Public `/` maps to its exact physical tree" and its `/`-rooted traversal and destructive-mutation clauses

> TL;DR: Shell, npm, Node children, installed bins, dev servers and recursive Workers see the active project at one public root (Workbench option `publicProjectRoot`, default `/home/project`), plus project-owned `/tmp` and `/home/rifty` stored beside the project tree; `/` is a real root listing the mount ancestors, not the project.

## Context

ADR-0280 made the project the filesystem root. `os.tmpdir()`/`os.homedir()`
then resolved inside the project and did not exist (`mkdtemp` → ENOENT), real
tools took root-edge code paths (two installed-Vite patches exist only for
`/`), and no lane could run a project anywhere else (goal
`project-location-independence`, evidence §Location probe/§Root). User
decisions: physically nothing moves; the default is `/home/project`; temp and
home belong to the project; the location is a host/SDK/template parameter.

## Decision

1. One guest layout per active project: `{ publicRoot, projectRoot, privateRoot }`.
   `publicRoot` is the Workbench option `publicProjectRoot` (absolute,
   normalized, `/` allowed; default `/home/project`), carried in the owner boot
   config and in every child launch beside `remoteFsRoot`. `privateRoot` is
   `<project container>/guest`, beside `tree/` (ADR-0165 layout unchanged).
2. Mounts: `publicRoot` → `projectRoot`; `/tmp` → `privateRoot/tmp`;
   `/home/rifty` → `privateRoot/home` (longest prefix wins). Strict ancestors of
   a mount are directories listing the next mount segment (`/` → `home`, `tmp`;
   `/home` → `project`, `rifty`), merged with the project's own entries when the
   project mount covers them. Everything else is ENOENT, as before.
3. Creating or removing entries directly under a synthetic directory fails
   `EACCES`; removing/replacing a mount point fails `EPERM`; `rename` across
   mounts fails `EXDEV` (a separate mount, as tmpfs `/tmp`); copies work.
4. With `publicRoot` `/`, a project tree carrying its own top-level `tmp` or
   `home` is refused loudly: listing `/` or touching the colliding mount fails
   `EEXIST` naming it; the mounts never silently shadow project files.
5. Writes into the private areas persist in the owner authority, bypass project
   publication (no Files/explorer revision), and are not copied by
   save-as/convert (which copy `tree/`); deleting a project deletes them.
6. The Shell environment gets `HOME=/home/rifty` unless the seed sets it; a bare
   `cd` goes there. `os.homedir()` returns `$HOME` and `os.tmpdir()` returns
   `$TMPDIR`/`$TMP`/`$TEMP` (trailing slash stripped) like Node, defaulting to
   `/home/rifty` and `/tmp`.
7. Diagnostics translate owner paths to guest paths (`publicRoot/...`,
   `/tmp/...`, `/home/rifty/...`); the owner layout stays hidden.
8. Files, Documents, SCM, TypeScript and terminal-state persistence keep
   project-relative paths (`/` = project root); an owner cwd outside the
   project tree persists as the project root.

## Alternatives

- Private areas inside the visible tree under the reserved `/.rifty` (archives
  already skip it): killed — `tree/.rifty` is filtered inconsistently (file-tree
  snapshot, Files `readdir`, SCM differ) and a project-relative store would be
  carried by convert/copy paths; the sibling `guest/` needs no filter at all.
- Nest the project inside its physical tree (`tree/home/project`, ordinary
  `tmp/`, `home/` dirs): rejected by the goal — moves files and puts tmp/home
  into the explorer, `git status` and archives.
- Reserve `/tmp`, `/home` under `/` without moving the project: rejected by the
  goal — the project stays at the root and the Vite root patches stay.
- Parameter per project (definition field): killed for now — no persona sets
  different roots per project (goal: host/SDK/template, playground starters
  always at the default); a Workbench option is the minimal interface and a
  later per-project field can refine it.

## Consequences

- (+) `pwd`, `process.cwd()`, Vite's root and diagnostics agree at
  `/home/project`; `mkdtemp(os.tmpdir())` and `~/.npmrc` work and persist with
  the project.
- (+) Lanes can run the same project at a second location through one option.
- (−) `/dev`, `/etc`, `/usr` stay absent.
- (−) Cross-mount `rename` is `EXDEV`; tools must copy (as with tmpfs `/tmp`).

## Corrections

- ADR-0280 (2026-10-16): §Decision "Public `/` maps to its exact physical tree",
  "Parent traversal cannot escape it" and "A destructive mutation whose source
  or destination is public `/` rejects" now read: the project is mounted at
  `publicRoot`; traversal reaches only the mounts and their ancestors; the
  destructive-mutation refusal applies to every mount point.
- ADR-0278 (2026-10-16): the terminal-state "public project cwd" (`:196-204`)
  and archive root `/` (`:613-615`) mean the project root, not the guest
  filesystem root; a persisted cwd outside the project falls back to the
  project root.
