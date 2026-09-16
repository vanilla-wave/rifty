---
area: npm-client
status: draft
title: Installing a different version over an existing `node_modules/<pkg>` leaves the old files in place
created: 2026-09-15
why: npm replaces the package directory on a version change; rifty writes the new tarball over the old tree, so mixed files survive (vite 7.3.6 → 8.0.16 left both chunk sets and the vite install patch failed "expected exactly one Chokidar DirEntry.add anchor; found 2"); `rm -rf node_modules` first avoids it
user_story: As a developer bumping a dependency in package.json and re-running `npm install`, I want the package directory to match the new version exactly, but today stale files from the previous version remain and can break install-time preparation or runtime resolution
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md]
code: [packages/npm-client/src/linker.ts, packages/npm-client/src/installer.ts]
---

## Context

Observed 2026-09-15 on main 51440931a: starter project (vite 7.3.6 installed),
`package.json` changed to vitest + `overrides: {vite: "vite@8.0.16"}`,
`npm install` without cleaning → vite 8.0.16 unpacked over the 7.3.6 dir,
`dist/node/chunks` holds both versions' chunk files, vite-cli-prep counts two
watcher-patch anchors and aborts the install; a clean tree installs fine.
Finding only (no carrier decided); belongs with the planned honest-npm work,
not with `vitest-run-in-browser` (whose scenario starts from a clean project).
Until fixed, the visible workaround is documented nowhere — at minimum the
prep error should name the stale-dir cause.

## Challenge

challenge: 2026-09-15 — factual capture (no premise critic needed, README §Challenge)
