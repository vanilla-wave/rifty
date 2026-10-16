# ADR 0533: Vite runs upstream bytes at every project root; root policies removed

Status: Accepted
Date: 2026-10

> TL;DR: Supersedes ADR-0433 whole. The registry no longer rewrites Vite's bundled Chokidar `DirEntry.add` (`viteRootWatchPatchPolicy`) or `normalizeResolvedIdToUrl`'s root slice (`viteRootUrlPatchPolicy`); installed Vite 7.3.6 `chunks/config.js` and Vite 8.0.16 `chunks/node.js` are the upstream tarball members, and a project placed at `/` takes the code paths real Node + Vite take there.

## Context

Both policies made Vite work at project root `/`, rifty's former default
(ADR-0280). Real Node 24.22.0 + Vite 7.3.6 at `/` reproduces both edges: with
the watcher on, `vite.config.js changed, restarting server` and root-file
change events with no edit (evidence §Root runs 2-3,
`docs/backlog/npm-client/reference/vite-at-root-watcher-oracle-2026-10-16.md`);
with it off, `/src/App.jsx` imports `/@id//@react-refresh` beside a preamble
`/@react-refresh` (run 5). ADR-0531 moved the default to `/home/project`, where
neither edge exists. Goal `project-location-independence` I3 (user: «Снять
патчи — быть Node-точным в `/` (сломанным)»).

## Decision

1. Delete both policies, their apply/validate paths (`vite-cli-install-policy.ts`,
   acquisition planning and trusted-entry validation in `vite-cli-prep.ts`,
   the registry's `planInstalledConsumerFiles`/`prepareInstalledConsumerFiles`
   and the install finalizer's call), the snapshot input proof and the
   install-artifact recipe entries. Baked snapshots are re-baked over their
   committed lockfile pins; only the two chunks and the identity change.
2. At `/` rifty does not repair Vite: the split Refresh URL and the watcher
   restarts are upstream behavior, documented in
   `docs/public/compat/vite-command.md`. Vite 8 at `/`: byte identity only
   (no real-Node artifact yet).
3. ADR-0433 is removed; `docs/adr/README.md` keeps a pointer to this ADR.

## Consequences

- (+) Installed Vite is upstream bytes at every root; one fewer acquisition
  step and recipe input.
- (−) A project deliberately placed at `/` gets Vite's real defects there
  (React Refresh identity split, restart loop with the watcher on).
