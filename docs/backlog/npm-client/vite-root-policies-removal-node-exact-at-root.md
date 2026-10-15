---
area: npm-client
status: draft
title: The installed Vite bundles carry no root-location policy, and a project placed at `/` behaves as real Node + Vite do at `/`
created: 2026-10-15
why: `viteRootWatchPatchPolicy` and `viteRootUrlPatchPolicy` make Vite work at a project root of `/` where real Node + Vite 7.3.6 phantom-restart, emit spurious change events and split the React Refresh module URL (evidence §Root, configured runs 2-3/5); once the default moves to `/home/project` the user wants the patches deleted and rifty taking upstream's own code paths at `/`
user_story: As a developer who deliberately configures the root as `/`, I want rifty to take the code paths real Node + Vite take there — including Vite's own defects — instead of a silently patched Vite, and at the default `/home/project` I want upstream bytes
epic: project-location-independence
blocked_by: [distribution/home-project-default-and-project-owned-tmp-home]
sources: [ADR-0433, ADR-0384, docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md, docs/backlog/npm-client/guest-package-adaptation-inventory-classes.md]
code: [tools/shadow-registry/src/runtime/vite-cli-install-policy.ts, tools/shadow-registry/src/runtime/vite-cli-prep.ts, tests/integration/vite-cli-prep.test.ts]
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

<!-- finding capture under a fitted goal — premise checked at the goal (README §Challenge) -->
