import type { ViteProjectSpec } from './project-spec.ts';

/**
 * Hidden first-run workspace template. It gives the IDE a real `/scratch` owner
 * before a starter is chosen, without restoring deps or booting a dev server.
 */
export const HIDDEN_EMPTY_TEMPLATE: ViteProjectSpec = {
  id: 'hidden-empty',
  displayName: 'Empty workspace',
  runtime: 'vite',
  install: {},
  runtimeSpecifier: 'vite',
  entry: { relativePath: '/src/main.js', content: '' },
  defaultPort: 5174,
  estimatedBootSeconds: 0,
  htmlTitle: 'rifty empty workspace',
  server: {
    appType: 'spa',
    strictPort: true,
    optimizeDepsDisabled: true,
    host: true,
    allowedHosts: true,
  },
  hmr: { enabled: false },
};
