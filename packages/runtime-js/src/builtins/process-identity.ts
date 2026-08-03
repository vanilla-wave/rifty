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
const NODE_PROCESS_RELEASE_IDENTITY = Object.freeze({
  name: 'node',
  sourceUrl: 'https://nodejs.org/download/release/v24.0.0/node-v24.0.0.tar.gz',
  headersUrl: 'https://nodejs.org/download/release/v24.0.0/node-v24.0.0-headers.tar.gz',
} as const);

export type NodeProcessRelease = {
  readonly [Key in keyof typeof NODE_PROCESS_RELEASE_IDENTITY]: (typeof NODE_PROCESS_RELEASE_IDENTITY)[Key];
};

export const NODE_PROCESS_IDENTITY = Object.freeze({
  argv0: 'rifty',
  execPath: '/usr/local/bin/rifty',
  platform: 'rifty',
  arch: 'wasm',
  version: 'v24.0.0',
  versions: Object.freeze({ node: '24.0.0', v8: '13.6.0', rifty: '0.0.0' }),
  release: NODE_PROCESS_RELEASE_IDENTITY,
  title: 'rifty',
} as const);

export function createNodeProcessRelease(): NodeProcessRelease {
  return Object.defineProperties(
    {},
    {
      name: {
        value: NODE_PROCESS_RELEASE_IDENTITY.name,
        writable: false,
        enumerable: true,
        configurable: true,
      },
      sourceUrl: {
        value: NODE_PROCESS_RELEASE_IDENTITY.sourceUrl,
        writable: false,
        enumerable: true,
        configurable: true,
      },
      headersUrl: {
        value: NODE_PROCESS_RELEASE_IDENTITY.headersUrl,
        writable: false,
        enumerable: true,
        configurable: true,
      },
    },
  ) as NodeProcessRelease;
}
