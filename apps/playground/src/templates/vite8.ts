import bakedSnapshotIdentities from '../generated/baked-snapshot-identities.json';
/**
 * Vite 8 opt-in template. Dev/build/preview are proven; HMR stays disabled
 * until its socket path has separate parity evidence (ADR-0161/0317).
 */
import {
  DEFAULT_VITE8_CONFIG_JS,
  DEFAULT_VITE8_CONFIG_PATH,
  DEFAULT_VITE8_VERSION,
} from '../vite-project-policy.ts';
import type { ViteProjectSpec } from './project-spec.ts';

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
  install: { vite: DEFAULT_VITE8_VERSION },
  bakedNodeModulesUrl: '/snapshots/vite8-node-modules.json.gz',
  bakedNodeModulesSnapshotId: bakedSnapshotIdentities.snapshots.vite8,
  entry: { relativePath: '/src/main.js', content: INITIAL_MAIN_JS },
  defaultPort: 5174,
  estimatedBootSeconds: 25,
  htmlTitle: 'rifty + real Vite 8 (Rolldown, worker)',
  extraFiles: {
    // Rolldown optimizer/HMR remain off in user-visible template policy.
    [DEFAULT_VITE8_CONFIG_PATH]: DEFAULT_VITE8_CONFIG_JS,
  },
};
