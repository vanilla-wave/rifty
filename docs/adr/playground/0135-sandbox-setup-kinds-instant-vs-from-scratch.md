# ADR 0135: Sandbox setup kinds: instant vs from-scratch

Status: Accepted
Date: 2026-06

> TL;DR: presets split into `setup: 'instant' | 'from-scratch'`. BOTH boot the template's dev line; the difference lives in the WORKER realm. Instant restores a BAKED node_modules snapshot (static asset) on the first-ever boot, later boots skip via a stamp. From-scratch skips the snapshot and runs a real `install()` IN THE WORKER, streaming each package to the terminal (per-package lines, ADR-0134), before the dev server starts — because only the worker realm owns the OPFS tree the preview is served from.

## Context

All presets booted identically: terminal runs `vite`/`npm run dev`, the worker silently installs deps inside its bootstrap. Wanted: (a) "ready" sandboxes with the fastest possible start; (b) "honest" sandboxes where the terminal really runs `npm install` and shows what it installs, then starts. Naming: "live" collides with `tag.tone: 'live'` (= dev server running), so **instant / from-scratch**.

Realm/storage constraint (load-bearing): the VFS interface is synchronous; sync OPFS (`FileSystemSyncAccessHandle`) is **worker-only**, so the page (main-thread) realm falls back to an in-memory VFS and cannot persist to OPFS. The tree the preview is served from lives in the WORKER's OPFS. Therefore any install whose output must serve the preview has to run in the worker realm — a page-side install lands in a memory store nothing reads.

`install()` has a lockfile fast path + tarball cache and a per-package progress hook (ADR-0134); `runSequence` echoes `$ <line>` and stops on non-zero exit.

## Decision

1. **`Preset.setup: 'instant' | 'from-scratch'`** (required). instant: `project-files`, `node-worker`; from-scratch: `real-vite`, `express-sqlite`. `DEFAULT_PRESET` stays instant (preserves `$ vite` boot contract in e2e).
2. **Boot lines** come from `presetBootLines(preset, root)` = `[<dev line>]` for BOTH kinds. The setup kind no longer changes the page's boot lines — it is carried to the worker over `RIFTY_RFV_SETUP` and drives the worker's dependency-arrival path. Single source for first boot AND preset-switch restart.
3. **Worker-owned dependency arrival** (`ensureProjectDependencies`, priority stamp → snapshot → install), parameterised by setup:
   - **instant** — snapshot enabled, quiet: stamp reuse → baked snapshot restore → install. First-ever boot restores the snapshot; later boots skip via the stamp.
   - **from-scratch** — snapshot DISABLED (honest), streamed: stamp reuse → real `install()` with the ADR-0134 `onPackage` hook logging `npm: + <name>@<version>` to the terminal. The dev server starts after the install settles.
4. **Install stamp** `<root>/node_modules/.rifty-install-stamp.json` (`{version, deps, packages}`), in the worker's OPFS:
   - written after every successful worker install, `deps` = package.json effective set (deps ∪ devDeps ∪ optionals — mirrors installer's request);
   - VFS `flush()` runs BEFORE the stamp write: OPFS write-through is unordered across files, so the stamp lands durable only after the tree — stamp implies tree;
   - a re-selected from-scratch preset whose tree is already installed hits the stamp and skips the install — fast after the first honest install, exactly like `npm install` once then `npm run dev` (the install is visible on the first-ever boot).
5. **Trust model**: stamp trusts the tree — no per-file verification. Escape hatch: deleting `node_modules` or changing package.json deps forces a fresh worker install. Invalidation strategy is provisional → `docs/backlog/playground/install-stamp-invalidation.md`.
6. **UI**: TemplateSwitcher dropdown groups rows under "Instant start" / "From scratch"; rows render the preset `tag` pill (instant / npm install). e2e selectors (`data-testid="gallery"`, `data-preset`) unchanged.
7. **Baked node_modules snapshots** (instant only) — the first-ever boot of an instant template is truly instant, no silent install:
   - `pnpm snapshots:bake` runs a REAL `install()` (same installer, shadow overrides, native gate as the worker) into a memory VFS for every template declaring `bakedNodeModulesUrl`, and writes node_modules + lockfile as a gzipped JSON asset under `apps/playground/public/snapshots/` (vite: 8 packages, ~9 MB gz — dominated by `@esbuild/wasi-preview1/esbuild.wasm`; kept, the tree must be byte-equivalent to an installed one).
   - Asset is COMMITTED: deploys stay hermetic (no registry at build time), dev + e2e get the instant path deterministically. Regeneration is manual after a baked template's `install` map changes.
   - Restore is gated on `templateId` + `depsEqual(snapshot.deps, package.json)` — a stale asset falls back to install, never a wrong tree. Restore REPLACES node_modules, writes the lockfile, then stamps (flush → stamp → flush).
   - Gzip is sniffed by magic bytes, not URL/headers: vite dev serves `.gz` with `Content-Encoding: gzip` (browser pre-decodes), static hosts serve raw bytes — both must work. Any fetch/parse/restore failure → install fallback; a broken asset never bricks the boot.
   - **from-scratch passes `snapshotUrl: undefined`** even when its template ships a snapshot (e.g. `real-vite` on the `vite` template), so the visible install is a genuine resolve, not a snapshot restore.

Rejected: faking the install by echoing a command the page didn't run (dishonest); **running the visible install on the page realm** — it is memory-backed (sync OPFS worker-only), so its tree never serves the preview and a page→worker "shared OPFS warm-up" is impossible; generating the snapshot at deploy time (build needs the live registry, e2e loses determinism); stripping the unused-today esbuild.wasm from the snapshot (restored tree would silently diverge from an installed one).

Superseded sub-decision (this ADR was not yet merged): a first cut ran the from-scratch `npm install` as a page-side terminal line and assumed it "warmed shared OPFS" for the worker to skip. Unsound — page and worker have no shared writable store — so it produced two installs (page-memory theater + worker), gated the boot on the weaker page realm (a transient page-install failure blocked the dev server even though the worker could install independently), and the streamed packages never served the preview. The visible install is now worker-owned; the page boot install is removed.

## Consequences

- From-scratch installs ONCE, in the worker realm that serves the preview, streamed live to the terminal; re-selecting the same preset reuses the OPFS stamp (fast). First-ever instant boot restores the baked snapshot (seconds, no resolver/network); later boots skip via stamp.
- The visible install now appears under the dev command (`$ vite` / `npm run dev`) rather than a discrete `$ npm install` page line — the per-package `npm: + …` stream is the honest signal. The page-side `npm` shell command stays for ad-hoc `npm install <pkg>` (M9) but is no longer part of the from-scratch boot.
- ~9 MB committed asset; each re-bake adds another copy to git history. Regeneration policy + size pressure tracked in `docs/backlog/playground/baked-snapshot-regeneration.md`.
- A corrupted-but-stamped tree boots a broken dev server; recovery = delete node_modules / change deps. Accepted for now; see backlog item.
- `fullstack-demo` e2e: selecting `express-sqlite` streams `npm: + express@…` from the worker before the server boots (deliberate product change).
