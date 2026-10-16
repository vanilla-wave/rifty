---
area: npm-client
status: ready
title: The installed Vite bundles carry no root-location policy, and a project placed at `/` behaves as real Node + Vite do at `/`
created: 2026-10-15
why: `viteRootWatchPatchPolicy` and `viteRootUrlPatchPolicy` make Vite work at a project root of `/` where real Node + Vite 7.3.6 phantom-restart, emit spurious change events and split the React Refresh module URL (evidence §Root, configured runs 2-3/5); once the default moves to `/home/project` the user wants the patches deleted and rifty taking upstream's own code paths at `/`
user_story: As a developer who deliberately configures the root as `/`, I want rifty to take the code paths real Node + Vite take there — including Vite's own defects — instead of a silently patched Vite, and at the default `/home/project` I want upstream bytes
epic: project-location-independence
blocked_by: [distribution/home-project-default-and-project-owned-tmp-home]
sources: [ADR-0433, ADR-0384, docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md, docs/backlog/npm-client/guest-package-adaptation-inventory-classes.md]
code: [tools/shadow-registry/src/runtime/vite-cli-install-policy.ts, tools/shadow-registry/src/runtime/vite-cli-prep.ts, tools/shadow-registry/tools/generate-install-artifact-identity.ts, tools/shadow-registry/tools/check-dep-snapshot-artifacts.ts, tests/integration/vite-cli-prep.test.ts]
---

## Context

Finding (2026-10-15). Policies `vite-cli-install-policy.ts:11-14` (chokidar
`DirEntry.add` empty name) and `:44-47` (`resolved.id.slice(root.length)`);
`validateRootWatchPatch` (`vite-cli-prep.ts:110-117`) refuses an unpatched
tree; recipe identity and baked snapshots carry the prepared bytes (ADR-0433).
Real-Node artifacts (evidence §Root, Node 24.22.0 + Vite 7.3.6 + plugin-react
5.2.0 at `/` in a Linux container): phantom `vite.config.js changed,
restarting server…` + spurious `[file change]` + OOM (runs 2-3); `/src/App.jsx`
imports `/@id//@react-refresh` while the preamble uses `/@react-refresh`
(run 5; oracle configs: pseudo-fs ignored for runs 2-3, watcher off +
explicit optimizer entry for run 5 — pinned as the `/` oracle). ADR-0433 is
overturned entirely by this unit → ADR removed + old→new pointer in
`docs/adr/README.md` (DEC-2), the superseding decision recorded in this
unit's short ADR. Depends on child 2's loud form for `/tmp`/`$HOME` at root
`/`. Vite 8 at `/` has no real-Node artifact: covered by byte identity only
until a container probe of the Rolldown bundle at `/` lands (map fog).

Acceptance shape expected at pickup: both policies, their apply/validate
paths and test rows deleted; installed `chunks/config.js` (Vite 7.3.6 and the
Vite 8 bundle) byte-identical to the upstream tarball member; recipe identity
and snapshots re-baked; a `/`-rooted lane asserts the real-Node behavior from
the artifacts (split Refresh URL; the restart symptom as observable in rifty's
small `/`), documented in `docs/public/compat/vite-command.md` as behavior at
`/`; the ADR-0384 inventory rows for both policies deleted.

Dedup: `honest-guest-package-adaptations` I3 classifies these rows (kill
condition = this unit); no declined match.

## Challenge

challenge: 2026-10-15 — clear (goal premise, `epics/project-location-independence` §Challenge)

## Reference contract

Real Node 24.22.0 + Vite 7.3.6 (+ plugin-react 5.2.0) at project root `/` in a
Linux container, evidence §Root runs 1-5: `vite build` works at `/`; with
`server.watch: null` + `optimizeDeps.entries: ['index.html']` (run 5) the served
`/src/main.jsx` imports `/@id//src/App.jsx` and `/src/App.jsx` imports
`/@id//@react-refresh` while the preamble uses `/@react-refresh` — every
resolved id under root `/` is served as `/@id//<path>` (`normalizeResolvedIdToUrl`
slices `root.length`). Upstream tarball members: Vite 7.3.6
`dist/node/chunks/config.js` sha256 `c2fcfa51…24ba3` (fixture
`tests/integration/fixtures/registry/rollup-companions/packages/vite-7.3.6.tgz`),
Vite 8.0.16 `dist/node/chunks/node.js` sha256 `c3dd49d1…3588b` (`npm pack vite@8.0.16`).

## Acceptance

1. The installed Vite 7.3.6 `dist/node/chunks/config.js` and Vite 8.0.16
   `dist/node/chunks/node.js` (baked snapshots and the running starters) are
   byte-identical to the upstream tarball members; the install-artifact recipe
   carries no Vite policy → I3, scenario 3
2. With `publicProjectRoot: '/'`, a React project (vite 7.3.6,
   @vitejs/plugin-react 5.2.0, react 19) configured as evidence run 5
   (`server.watch: null`, `optimizeDeps.entries: ['index.html']`) serves an
   `index.html` preamble importing `/@react-refresh` and a `/src/App.jsx`
   importing `/@id//@react-refresh`, `/src/main.jsx` importing
   `/@id//src/App.jsx` — as real Node + Vite 7.3.6 at `/`; at the default root
   the same project serves one `/@react-refresh` URL → I3, scenario 3
3. At `/`, `vite build` and `vite preview` pass (Vite 7) → I3, I4
4. `docs/public/compat/vite-command.md` documents Vite at `/` as upstream
   behavior (split `/@id//` URLs, watcher over the whole root), not a defect
   rifty repairs → I3, scenario 3

## Out of scope

- Repairing Vite at `/` — goal §Decisions «Снять патчи — быть Node-точным в `/` (сломанным)».
- Vite 8 at `/` beyond byte identity — no real-Node artifact (goal I3).

## Decisions

- 2026-10-16 — pickup: ADR-0433 is overturned whole (DEC-2: removed + README
  pointer); the removal decision is recorded in a short ADR at implementation;
  the `/`-rooted lane asserts the deterministic run-5 URL split; the phantom
  restart of runs 2-3 depends on the watcher walking a real filesystem and is
  not asserted (rifty's `/` holds only the project).
