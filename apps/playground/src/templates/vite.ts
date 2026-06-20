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
  install: { vite: '8.0.16' },
  // Regenerate with `pnpm snapshots:bake` after changing `install` (ADR-0135).
  bakedNodeModulesUrl: '/snapshots/vite-node-modules.json.gz',
  runtimeSpecifier: 'vite',
  entry: { relativePath: '/src/main.js', content: INITIAL_MAIN_JS },
  defaultPort: 5174,
  estimatedBootSeconds: 25,
  htmlTitle: 'rifty + real Vite (worker)',
  server: {
    appType: 'spa',
    strictPort: true,
    optimizeDepsDisabled: true,
    host: true,
    allowedHosts: true,
  },
  hmr: { enabled: false },
};
