/**
 * Vite 8 opt-in template. Dev server works; build/preview stay loud-rejected
 * because Rolldown's WASI pthread build path is upstream-blocked.
 */
import type { ViteProjectSpec } from '@riftydev/workbench';

const INITIAL_MAIN_JS = `const message =
  'Hello from real Vite 8 (Rolldown) running inside a kernel-spawned Worker — edit me, save.';

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

export const VITE8_TEMPLATE: ViteProjectSpec = {
  id: 'vite8',
  displayName: 'Vite 8 (Rolldown experimental)',
  runtime: 'vite',
  install: { vite: '8.0.16' },
  bakedNodeModulesUrl: '/snapshots/vite8-node-modules.json.gz',
  runtimeSpecifier: 'vite',
  entry: { relativePath: '/src/main.js', content: INITIAL_MAIN_JS },
  defaultPort: 5174,
  estimatedBootSeconds: 25,
  htmlTitle: 'rifty + real Vite 8 (Rolldown, worker)',
  server: {
    appType: 'spa',
    strictPort: true,
    optimizeDepsDisabled: true,
    host: true,
    allowedHosts: true,
  },
  hmr: { enabled: false },
};
