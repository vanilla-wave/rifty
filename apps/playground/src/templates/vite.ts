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

const INITIAL_MAIN_JS = `document.getElementById('app').textContent =
  'Hello from real Vite running inside a kernel-spawned Worker — edit me, save.';
`;

export const VITE_TEMPLATE: ViteProjectSpec = {
  id: 'vite',
  displayName: 'Vite dev server',
  runtime: 'vite',
  install: { vite: '^5.4.0' },
  runtimeSpecifier: 'vite',
  entry: { relativePath: '/src/main.js', content: INITIAL_MAIN_JS },
  defaultPort: 5174,
  estimatedBootSeconds: 20,
  htmlTitle: 'rifty + real Vite (worker)',
  server: {
    appType: 'spa',
    strictPort: true,
    optimizeDepsDisabled: true,
    host: true,
    allowedHosts: true,
  },
  hmr: { enabled: true },
};
