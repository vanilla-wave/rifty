/**
 * Architecture import-boundary rules for dependency-cruiser (check:arch).
 * Single source for: layer top-down direction, no cycles, no foreign src/internal,
 * solid-js only in playground (D-002). Consumed by .dependency-cruiser.cjs (CLI)
 * and tests/integration/arch-boundaries.test.ts (programmatic).
 *
 * Layer match is segment-based (`/<pkg>/`), so the same rules fire on real
 * `packages/<pkg>/src/...` and on test fixtures under any root.
 */

// Layer tiers, low → high. A lower tier importing a strictly-higher tier = reverse (forbidden).
const TIERS = [
  ['vfs', 'io', 'net', 'service-worker', 'git'],
  ['kernel'],
  ['runtime-js', 'runtime-wasi'],
  ['shell', 'terminal', 'npm-client', 'ts-language-service'],
  ['playground'],
];

const seg = (pkgs) => `(?:^|/)(?:${pkgs.join('|')})/`;
const ALL = TIERS.flat();

// Server-side services (outside the browser layer graph). They may import UP
// into browser-layer packages (e.g. eddy → npm-client, ADR-0182), but no
// browser-layer package may import them. Kept OUT of TIERS so the linear
// reverse-import logic never constrains their (legitimate) upward imports.
const SERVICES = ['eddy'];

// enhancedResolveOptions: honor package.json `exports` so cross-package subpath
// imports (`@riftydev/vfs/internal`) resolve to src — madge could not (blindspot).
const options = {
  tsConfig: { fileName: 'tsconfig.base.json' },
  doNotFollow: { path: 'node_modules' },
  // skip build output, coverage, type decls and tests — layering applies to
  // source only. Also skip the transient temp configs tsup/vitest write next to
  // their config (they appear mid-run and would race depcruise to an ENOENT).
  exclude: {
    path: '(^|/)(dist|build|coverage|playwright-report|test-results)/|/tests?/|/__tests__/|/__mocks__/|\\.test\\.[tj]sx?$|\\.d\\.ts$|(^|/)tsup\\.config\\.bundled_[^/]+\\.mjs$|(^|/)vitest\\.config\\.[tj]s\\.timestamp-[^/]+\\.mjs$',
  },
  enhancedResolveOptions: {
    exportsFields: ['exports'],
    conditionNames: ['import', 'node', 'default', 'types'],
    mainFields: ['module', 'main', 'types'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
  },
};

const forbidden = [
  {
    name: 'no-circular',
    severity: 'error',
    comment: 'no import cycles (incl. cross-package via subpath exports)',
    from: {},
    to: { circular: true },
  },
  // Layer direction: each tier must not import a strictly-higher tier (reverse import).
  ...TIERS.slice(0, -1).map((pkgs, i) => ({
    name: `no-reverse-import-${pkgs[0]}`,
    severity: 'error',
    comment: `layer [${pkgs.join(', ')}] must not import a higher layer`,
    from: { path: seg(pkgs) },
    to: { path: seg(TIERS.slice(i + 1).flat()) },
  })),
  {
    name: 'no-foreign-internal',
    severity: 'error',
    comment: 'reach another package only via its public entry, never its src/internal/*',
    from: { path: `(?:^|/)(${[...ALL, ...SERVICES].join('|')})/src/` },
    to: {
      path: `(?:^|/)(?:${[...ALL, ...SERVICES].join('|')})/src/internal/`,
      // allow same-package internal, and a declared `./internal` export entry
      pathNot: ['(?:^|/)$1/src/internal/', '/internal/index\\.[tj]sx?$'],
    },
  },
  {
    name: 'no-browser-imports-eddy',
    severity: 'error',
    comment: 'ADR-0182: services/eddy is server-side; no browser-layer package may import it',
    from: { path: seg(ALL) },
    to: { path: seg(SERVICES) },
  },
  {
    name: 'solid-only-in-playground',
    severity: 'error',
    comment: 'D-002: solid-js only in apps/playground',
    from: { pathNot: '(?:^|/)playground/' },
    to: { path: '(?:^|/)solid-js(?:/|$)|(?:^|/)@solidjs/' },
  },
  {
    name: 'no-ui-imports-in-playground-orchestration',
    severity: 'error',
    comment:
      'ADR-0195: orchestration/* is the headless core — no xterm/monaco/components/adapters (node-vitest testability is the point)',
    from: { path: '(?:^|/)playground/src/orchestration/' },
    to: {
      path: '(?:^|/)@xterm/|(?:^|/)monaco-editor(?:/|$)|(?:^|/)playground/src/(?:components|adapters)/|(?:^|/)playground/src/App\\.tsx$',
    },
  },
];

module.exports = { TIERS, seg, options, forbidden };
