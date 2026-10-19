// Verbatim Vite DEFAULT_CONFIG_FILES order (vite/src/node/constants.ts).
export const VITE_CONFIG_FILENAMES = [
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'vite.config.cjs',
  'vite.config.mts',
  'vite.config.cts',
] as const;

// The esbuild runtime admits only its proven Vite consumer version. Exact starter pins are
// declared platform-gap debt (AGENTS.md §Fidelity). TODO(backlog: npm-client/vite-7-3-7-from-scratch-esbuild-refusal)
export const DEFAULT_VITE7_VERSION = '7.3.6';
export const DEFAULT_VITE8_VERSION = '8.0.16';
export const DEFAULT_VITE8_CONFIG_PATH = '/vite.config.js';
export const DEFAULT_VITE8_CONFIG_JS = `export default {
  server: { hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
};
`;
