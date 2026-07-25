/**
 * Shared Node-identity fields for every rifty `process` (owner + spawned child).
 *
 * Single source of truth so owner (`RiftyProcess`) and child (`WorkerNodeProcessShim`)
 * cannot drift. Node API compatibility and rifty host identity are separate
 * axes (ADR-0322).
 */
export const NODE_PROCESS_IDENTITY = Object.freeze({
  argv0: 'rifty',
  execPath: '/usr/local/bin/rifty',
  platform: 'rifty',
  arch: 'wasm',
  version: 'v24.0.0',
  versions: Object.freeze({ node: '24.0.0', v8: '13.6.0', rifty: '0.0.0' }),
  release: Object.freeze({ name: 'node' } as const),
  title: 'rifty',
} as const);
