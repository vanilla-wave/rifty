/**
 * The Vite template — the single registered {@link ProjectSpec} (ADR-0078).
 *
 * Holds exactly the literals that used to be inline in
 * `workers/real-vite-bootstrap.ts` (install deps, import specifier, createServer
 * knobs, the seeded entry source, default port). Adding another runnable
 * template means writing a sibling ProjectSpec and registering it in
 * `registry.ts` — no worker or orchestrator edits.
 */
import type { ViteProjectSpec } from './project-spec.ts';

const INITIAL_MAIN_JS = `const message =
  'Hello from real Vite running inside a kernel-spawned Worker — edit me, save.';

export function render() {
  document.getElementById('app').textContent = message;
}

render();

if (import.meta.hot) {
  import.meta.hot.accept((next) => {
    next?.render();
  });
}
`;

export const VITE_TEMPLATE: ViteProjectSpec = {
  id: 'vite',
  displayName: 'Vite dev server',
  runtime: 'vite',
  // Default = Vite 7 (Rollup/esbuild). Vite 8's Rolldown WASI build is
  // upstream-blocked, so it lives in the opt-in `vite8` preset.
  // @rollup/wasm-node is NOT pinned here: the installer injects it as rollup's
  // same-version shadow-shim companion (ADR-0188) — a hand pin could drift.
  install: { vite: '^7.0.0' },
  // Regenerate with `pnpm snapshots:bake` after changing `install` (ADR-0135).
  bakedNodeModulesUrl: '/snapshots/vite-node-modules.json.gz',
  runtimeSpecifier: 'vite',
  entry: { relativePath: '/src/main.js', content: INITIAL_MAIN_JS },
  defaultPort: 5174,
  estimatedBootSeconds: 20,
  htmlTitle: 'rifty + real Vite (worker)',
  server: {
    appType: 'spa',
    strictPort: true,
    // Zero deps + plain-JS sources: dep discovery would drag the 13.5 MB
    // esbuild-wasm onto the default preset's boot path for an empty result
    // (ADR-0192 lazy-init contract). Dep-carrying projects run the real
    // optimizer.
    optimizeDepsDisabled: true,
    host: true,
    allowedHosts: true,
  },
  // Vite 7 uses the proven cross-realm native-HMR bridge; Vite 8 keeps HMR off
  // separately until its Rolldown WASI socket path is re-proven (ADR-0161).
  hmr: { enabled: true },
};
