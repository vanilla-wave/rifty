// Verbatim Vite DEFAULT_CONFIG_FILES order (vite/src/node/constants.ts).
export const VITE_CONFIG_FILENAMES = [
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'vite.config.cjs',
  'vite.config.mts',
  'vite.config.cts',
] as const;

export const DEFAULT_VITE8_VERSION = '8.0.16';
export const VITE8_WASI_RUNTIME_OVERRIDE_NAME = '@napi-rs/wasm-runtime';
export const VITE8_WASI_RUNTIME_OVERRIDE = 'npm:@napi-rs/wasm-runtime@1.1.6';
export const DEFAULT_VITE8_CONFIG_PATH = '/vite.config.js';
export const DEFAULT_VITE8_CONFIG_JS = `export default {
  server: { hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
};
`;
