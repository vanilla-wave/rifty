export const lightningcssMatrix = {
  file: 'lightningcss.md',
  title: 'Compatibility matrix — lightningcss',
  intro:
    'The lightningcss@1.32.0 facade delegates to exact lightningcss-wasm@1.32.0. Admission is `semver-admits`: a request must admit the trigger version 1.32.0 (for example `^1.30.0` or `^1.32.0`). Admitting a range still installs the exact twin; this is a version ceiling, not general native-lightningcss compatibility (ADR-0361, ADR-0371).',
  rows: [
    [
      'CJS / ESM facade',
      '⚠️',
      'CJS re-exports the twin. ESM re-exports `Features`, `browserslistToTargets`, `bundle`, `bundleAsync`, `composeVisitors`, `transform`, and `transformStyleAttribute`; its default is the twin namespace. A real Node 24 probe transforms CSS through both facade entries without calling init: the twin selects synchronously initialized `wasm-node.cjs` / `wasm-node.mjs`. This is not browser-runtime or full API parity proof.',
    ],
    [
      'Default browser entry initialization',
      '⚠️',
      'The upstream default entry `index.mjs`, probed directly on Node, throws `TypeError` on `transform` before async `init()`; after initialization with the real WASM bytes it transforms CSS. The facade does not call init. This default-entry result does not establish failure through the node-conditioned entries or prove browser execution.',
    ],
    [
      'Requests not admitting 1.32.0',
      '❌',
      "Throws `NotImplementedError('lightningcss.version')` under `semver-admits`; for example `^1.33.0` cannot use the pinned twin.",
    ],
    [
      'Acquisition dependency projection drift',
      '❌',
      "Throws `NotImplementedError('lightningcss.acquisition')` when the acquired twin's dependency projection differs from the recipe; the exact archive retains bundled `napi-wasm`.",
    ],
    [
      'CLI / bin',
      '❌',
      'No CLI or bin is published by this facade; no invented lightningcss CLI throw is claimed.',
    ],
    [
      'TypeScript declarations',
      '❌',
      'The facade publishes no types entry or declaration files. The twin has declarations, but the lightningcss facade does not expose them; this is missing metadata, not a runtime throw.',
    ],
  ],
  tests: [
    '`tools/checks/lightningcss-compat-matrix.test.ts`',
    '`packages/npm-client/src/installer-shadow-shims.test.ts`',
    '`packages/npm-client/src/internal/shadow/admission.contract.test.ts`',
    '`packages/npm-client/src/installer-shadow-recipe-v2-acquisition-replay-authority.contract.test.ts`',
  ],
  limitations: [
    'The exact 1.32.0 twin is a substitution ceiling; native bindings, other twin versions, and full lightningcss API parity are not claimed.',
    'The init probe executes the real archive on Node 24, including its default browser entry. Browser-runtime initialization and Vite css.transformer behavior remain unverified here; tracked in `docs/backlog/playground/vite8-lightningcss-wasm-init.md`.',
    'The registry-backed install/replay tests prove acquisition and facade materialization, not browser CSS execution.',
  ],
};
