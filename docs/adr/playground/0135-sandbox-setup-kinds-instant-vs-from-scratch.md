# ADR 0135: Sandbox setup kinds: instant vs from-scratch

Status: Accepted
Date: 2026-06

> TL;DR: presets split into `setup: 'instant' | 'from-scratch'`. Instant boots straight to the dev line and the worker skips a redundant install via a stamp file; from-scratch visibly runs `npm install` in the terminal (per-package lines, ADR-0134) before the dev line.

## Context

All presets booted identically: terminal runs `vite`/`npm run dev`, the worker silently installs deps inside its bootstrap. Wanted: (a) "ready" sandboxes with the fastest possible start; (b) "honest" sandboxes where the terminal really runs `npm install` and shows what it installs, then starts. Naming: "live" collides with `tag.tone: 'live'` (= dev server running), so **instant / from-scratch**.

Key mechanics available: page and worker realms share origin OPFS (each realm preloads at boot; async write-through drained by `flush()`); `install()` has a lockfile fast path + tarball cache; `runSequence` echoes `$ <line>` and stops on non-zero exit.

## Decision

1. **`Preset.setup: 'instant' | 'from-scratch'`** (required). instant: `project-files`, `node-worker`; from-scratch: `real-vite`, `express-sqlite`. `DEFAULT_PRESET` stays instant (preserves `$ vite` boot contract in e2e).
2. **Boot lines** come from `presetBootLines(preset, spec, root)`: from-scratch → `['cd <root> && npm install', <dev line>]`; instant → `[<dev line>]`. Used by both first boot and preset-switch restart, so re-selecting a from-scratch preset always replays the honest install.
3. **Install stamp** `<root>/node_modules/.rifty-install-stamp.json` (`{version: 1, deps, packages}`):
   - written after every successful install (page `npm install` command AND worker bootstrap), `deps` = package.json effective set (deps ∪ devDeps ∪ optionals — mirrors installer's request);
   - VFS `flush()` runs BEFORE the stamp write: OPFS write-through is unordered across files, so the stamp lands durable only after the tree — stamp implies tree;
   - worker bootstrap: stamp matches package.json effective deps AND `node_modules/` exists → **skip `install()` entirely** (log reuse). This is what makes instant presets (and the post-install boot of from-scratch presets) fast: page-side install warms the shared OPFS, worker preloads it.
4. **Trust model**: stamp trusts the tree — no per-file verification. Escape hatch: an explicit terminal `npm install` never consults the stamp (always runs the real installer, then re-stamps). Invalidation strategy is provisional → `docs/backlog/playground/install-stamp-invalidation.md`.
5. **UI**: TemplateSwitcher dropdown groups rows under "Instant start" / "From scratch"; rows render the preset `tag` pill (instant / npm install). e2e selectors (`data-testid="gallery"`, `data-preset`) unchanged.

Rejected: bundling node_modules snapshots as static assets (true cold-start instant — heavy asset pipeline, separate milestone); faking the install by echoing a command the page didn't run (dishonest); making the worker's internal install the "visible" one (it runs inside the `vite` command, can't be presented as a user-level `npm install`).

## Consequences

- From-scratch flow installs twice in substance once: page realm does the real (visible) install; worker bootstrap then skips via stamp (shared OPFS). First-ever instant boot still pays one silent worker install, then stamps — later boots are near-instant.
- A corrupted-but-stamped tree boots a broken dev server; recovery = run `npm install` (stampless path) or change deps. Accepted for now; see backlog item.
- `fullstack-demo` e2e updated: selecting `express-sqlite` now shows `$ cd /workspace && npm install` + `npm: + express@…` before `dev:` boot (deliberate product change).
- Worker bootstrap install stays summary-only (instant kind is quiet); per-package streaming is the page-side install's job.
