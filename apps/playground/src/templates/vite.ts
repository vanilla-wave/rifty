/**
 * Default Vite 7 template (ADR-0078/0174): install, visible config, entry, port.
 * Installed `.bin/vite` owns execution; adding a template is registry data.
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

export const DEFAULT_VITE_CONFIG_JS = `export default {
  optimizeDeps: { noDiscovery: true, include: [] },
};
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
  entry: { relativePath: '/src/main.js', content: INITIAL_MAIN_JS },
  defaultPort: 5174,
  estimatedBootSeconds: 20,
  htmlTitle: 'rifty + real Vite (worker)',
  extraFiles: {
    // Empty runtime dependency graph: keep optimizer startup off this template
    // path through visible user config, never a hidden CLI wrapper.
    '/vite.config.js': DEFAULT_VITE_CONFIG_JS,
  },
};
