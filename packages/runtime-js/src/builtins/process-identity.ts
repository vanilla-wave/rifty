/**
 * Shared Node-identity fields for every rifty `process` (owner + spawned child).
 *
 * Single source of truth so owner (`RiftyProcess`) and child (`WorkerNodeProcessShim`)
 * cannot drift.
 *
 * TODO(backlog: runtime-js/process-versions-node-honesty) — `version`/`versions.node` impersonate Node
 * while `platform`/`arch` follow ADR-0026's honesty principle. Tracked for
 * human review by M11 close; see docs/backlog/runtime-js/process-versions-node-honesty.md.
 */
export const NODE_PROCESS_IDENTITY = Object.freeze({
  argv0: 'rifty',
  execPath: '/usr/local/bin/rifty',
  platform: 'rifty',
  arch: 'wasm',
  version: 'v24.0.0',
  versions: Object.freeze({ node: '24.0.0', v8: '13.6.0', rifty: '0.0.0' }),
  title: 'rifty',
} as const);
