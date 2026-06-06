# ADR 0078: Generic ProjectSpec/Template runtime for the playground (Vite as the default template)

Status: Accepted (2026-06-05)
Date: 2026-06-05
Relates to: ADR-0043 (Vite-in-Worker — the real-vite worker realm this generalises), ADR-0077 (real-vite preview render: worker keep-alive + log surfacing + SW frame routing — the env-driven bootstrap and the `await new Promise<never>` keep-alive are preserved verbatim), ADR-0076 (cross-realm reverse VFS snapshot — keyed on `RIFTY_RFV_PORT`, which this ADR deliberately does not re-key), ADR-0075 (VSCode shell / preset gallery). Resolves the "more templates" half of Q-2026-06-04-316; the single-switcher half is ADR-0079.

## Context

The playground's "Real Vite" mode hardcoded Vite in ~15 places spread across the worker bootstrap (`workers/real-vite-bootstrap.ts`), the page-realm orchestrator (`glue/realVite.ts`), the mode machine (`adapters/useMode.ts`), the preset registry (`presets.ts`), and the shell UI (`App.tsx`): `INITIAL_PACKAGE_JSON` seeded `{ vite: '^5.4.0' }`; the same literal dependency map was passed to `install(...)`; the dynamic `import('vite')` specifier, the entire `createServer({...})` config (`appType: 'spa'`, `optimizeDeps.disabled`, `hmr: false`, the HMR-bridge plugin), the seed sources (`INITIAL_INDEX_HTML`/`INITIAL_MAIN_JS`), the default entry `/src/main.js`, the default port `5174`, and every user-facing "Real Vite" string were baked in.

User feedback (Q-2026-06-04-316): *"переключатель проектов выглядит странно. Давай заложим так, чтобы там могло быть больше шаблонов."* Adding a second runnable template would have meant copy-pasting the worker bootstrap and threading a second set of literals through five files. The runtime concept the playground actually demonstrates is "install a real npm project and run its dev server" — Vite is one instance of that, not the abstraction.

Note: this is a **playground-only** change. The core packages (`@riftydev/kernel`, `runtime-js`, `npm-client`, `net`, `vfs`) are already Vite-free — `rg -ni -w vite packages/*/src` shows Vite only in *comments*. The generic machinery already installs/resolves/runs arbitrary npm trees; the hardcoding lived entirely in the playground glue/UI layer, so the fix lives there and touches no cross-package public API.

## Decision

Introduce a **ProjectSpec/Template** value object owned by the playground and route every Vite-specific literal through it. Vite becomes the single registered, default template; the architecture admits more without touching the worker bootstrap or the orchestrator.

1. **`ProjectSpec` + a Solid-free template registry** live in new pure modules under `apps/playground/src/templates/` (glue-layer altitude, mirroring `glue/file-tree.ts` / `glue/snapshot-fs.ts`). Fully typed (no `any`):

   ```ts
   interface ProjectSpec {
     readonly id: string;                 // 'vite' — the only field crossing realms (env)
     readonly displayName: string;        // 'Vite dev server' — replaces "Real Vite"
     readonly install: Readonly<Record<string, string>>;  // { vite: '^5.4.0' }
     readonly runtimeSpecifier: string;   // 'vite' — the dynamic import() specifier
     readonly entry: { readonly relativePath: string; readonly content: string };
     readonly defaultPort: number;        // 5174
     readonly estimatedBootSeconds: number;
     readonly htmlTitle: string;
     readonly server: ServerSpec;         // serializable createServer knobs
     readonly hmr: { readonly enabled: boolean };
   }
   ```

   `ServerSpec` is the serializable subset (`appType`, `strictPort`, `optimizeDepsDisabled`, `host`, `allowedHosts`); the non-serializable plugin instances (`createHmrBridgeVitePlugin`) are **not** in the spec — the worker constructs them from `spec.hmr` after resolving.

2. **`resolveBootstrapConfig(spec, port, root): BootstrapConfig`** is a pure mapping (the unit-tested seam) that derives the concrete `{ entryPath, packageName, packageVersion, installDeps, packageJson, server, hmrEnabled, seedFiles }` the worker feeds to `install()` / `createServer()` / the seed step. The three seed files are **generated** from data, not stored statically: `package.json` from `spec.install`, the entry file from `spec.entry.content`, and **index.html with its `<script src>` derived from `spec.entry.relativePath`** — so a non-default entry can never drift from the HTML that loads it (a unit test pins exactly this).

3. **`resolveProjectSpec(id)`** does a registry lookup and **throws `NotImplementedError('templates.resolveProjectSpec', …)`** for an unknown id — no silent fallback-to-vite, no null (the no-silent-stubs hard rule, pinned by a failing test). `DEFAULT_TEMPLATE_ID = 'vite'`.

4. **The worker reads the template from env.** `realVite.ts` already serialises `RIFTY_RFV_PORT/ROOT/ENTRY` onto the spawn spec (ADR-0077); we add **one** var, `RIFTY_RFV_TEMPLATE` (default `'vite'`). `real-vite-bootstrap.ts` calls `resolveProjectSpec(env.RIFTY_RFV_TEMPLATE)` then `resolveBootstrapConfig(...)`; install deps, `import(spec.runtimeSpecifier)`, the createServer config, and the seed files all derive from it. The `RIFTY_RFV_*` prefix and the `RIFTY_RFV_PORT`-keyed snapshot/write/HMR/node_modules channels are kept **unchanged** — re-keying would needlessly collide with ADR-0076/0077/0080 for zero benefit. An explicit `RIFTY_RFV_ENTRY` override is still honoured (the orchestrator defaults it to the template's own entry, so it is normally a no-op).

5. **The internal `Mode` token `'real-vite'` is kept** (read at ~24 sites incl. the ADR-0076 snapshot gate and the e2e `[data-preset]` contract). `useMode` gains an optional `template: ProjectSpec`; its real-vite default port and status copy derive from the template. A preset gains an optional `templateId` so the gallery can declare which template a tile runs; `loadPreset` resolves it (`preset.templateId ? resolveProjectSpec(...) : machineTemplate`) and threads it through **both** `startRealVite` call sites (the toggle path and the preset path) — without this, a future second template would never reach the worker via the gallery.

6. **Vite is registered as the one template now** (`templates/vite.ts`), holding the lifted literals. Adding a template later is: write a `ProjectSpec`, register it, add a preset row (with its `templateId`) — no worker/orchestrator edits.

This is IRREVERSIBLE-by-checklist (>2 files / >100 lines), recorded here per ADR-0063. It adds no external dependency and no cross-package public API (ProjectSpec is playground-internal).

## Alternatives considered

- **Status-quo hardcode.** Rejected: the user asked for headroom; a second template would fork the worker bootstrap.
- **ProjectSpec config, one default template, env-driven worker (chosen, pinned).** Minimal new concepts, unit-testable via the pure `resolveBootstrapConfig`; the worker becomes template-agnostic. Cost: one new env var + a registry module.
- **Full template registry with per-template worker entry URLs / plugins-in-spec.** Rejected for now: serialising plugin factories or shipping a worker chunk per template is over-built for one template and fights the "plugins are realm-local" reality. The chosen shape leaves the door open without paying for it.
- **Rename the `Mode` token `'real-vite' → 'project'`.** Rejected: churns ~24 read sites incl. the ADR-0076 snapshot gate for no functional gain; the user-visible rename is achieved through `displayName`, and the e2e selector change is ADR-0079's deliberate contract change.

## Consequences

- (+) A second runnable template is now a data change (a `ProjectSpec` + a preset row), not a worker fork.
- (+) The worker bootstrap and the orchestrator are template-agnostic; Vite literals live in one place (`templates/vite.ts`). `resolveBootstrapConfig` is pure — the spec→install/server/seed mapping is red-able, including the index.html-follows-entry coherence the worker used to bury.
- (+) No core-package change, no new dependency, no new cross-package public API; the ADR-0077 keep-alive and env surface are preserved.
- (−) `devMode.ts` (the ADR-0025 non-isolated fallback) was deliberately **left as-is**: its index.html uses a RELATIVE `<script src>` (it must escape the iframe `/preview/` base), a different serving contract from the worker's ABSOLUTE-src seed — sharing them would regress the m7 SW round-trip. The two paths share only the entry-path shape, not the HTML. Folding dev mode into the spec is deferred.
- (−) One new env var (`RIFTY_RFV_TEMPLATE`); the `RIFTY_RFV_*` prefix now slightly misnames a generic surface (RFV = "real Vite"). Renaming to `RIFTY_RT_*` is deferred (it would touch the channel naming ADR-0076/0080 depend on) — logged in `OPEN_QUESTIONS.md`.
- (−) The internal `Mode` token stays `'real-vite'` while the UI says something generic — a small label/token mismatch, accepted to keep the read sites + e2e contract stable; a future rename is a mechanical follow-up.
- (−) Worker log lines still read "vite is listening" / carry a `[real-vite/worker]` prefix; full generic-ization of the worker log surface is deferred (and the m10 e2e asserts those exact markers — see ADR-0079).
