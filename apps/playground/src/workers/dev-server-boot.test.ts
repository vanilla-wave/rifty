import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Co-resident dev-server boot core extracted from real-vite-bootstrap (P6b prep).
// These guarantees moved here verbatim with the code they pin (bootDevServer +
// the node-server/vite tails); the behavior is unchanged (pure move).
const source = readFileSync(
  fileURLToPath(new URL('./dev-server-boot.ts', import.meta.url)),
  'utf8',
);

describe('dev-server boot preview routing', () => {
  it('uses a relative Vite base so transformed imports stay under the preview route', () => {
    expect(source).toContain("base: './'");
  });

  it('routes owner VFS writes through Vite native HMR', () => {
    // ADR-0148/0150 P6b (dev server runs in the supervised child): the running
    // dev server's HMR is fed from the virtual FS (it fires no real watcher events).
    expect(source).toContain('function handleViteFileChange(path: string): void');
    expect(source).toContain('const syntheticWatcherChanges = new Set<string>();');
    expect(source).toContain('syntheticWatcherChanges.add(modulePath)');
    expect(source).toContain('if (syntheticWatcherChanges.has(modulePath))');
    expect(source).toContain('invalidateViteModule(activeServer, modulePath)');
    expect(source).not.toContain('function broadcastFileUpdate(path: string): void');
    expect(source).not.toContain('hmrBridgeRef.current?.broadcast(');
    // Stock vite HMR (ADR-0189): the generic preview-path bridge carries vite's
    // own server.ws — no rifty token/plugin/endpoint rewrite. `hmr: false`
    // stays only for templates pinned off (Vite 8, ADR-0161).
    expect(source).toContain('hmr: cfg.hmrEnabled ? undefined : false');
    expect(source).not.toContain('createHmrBridgeToken');
    expect(source).not.toContain('createHmrBridgeVitePlugin');
    expect(source).not.toContain('__hmr/');
    expect(source).not.toContain('channels:');
    expect(source).not.toContain('ws: false');
  });

  it('does not feed Vite watcher change events back into synthetic invalidation', () => {
    const watcherBlock = source.slice(source.indexOf("server.watcher?.on('change'"));
    expect(watcherBlock).toContain('publishSnapshot();');
    expect(watcherBlock).not.toContain('handleViteFileChange(file)');
  });

  it('does not pin Vite to the old server.hmr.channels seam', () => {
    expect(source).not.toContain('readResolvedPackageVersion(');
    expect(source).not.toContain('assertSupportedViteHmrVersion');
    expect(source).not.toContain('createViteHmrBridgeChannel');
    expect(source).not.toContain('server.hmr.channels');
  });

  it('serves the cross-realm preview route from the child, not an in-worker SW bridge', () => {
    // ADR-0150 P6b corrected: the child owns listen() + serveCrossRealmPreview;
    // setupPreviewBridge no-ops in any worker realm so it is NOT called here (the
    // SW-direct route is page-anchored via mountPlaygroundPreviewBridge).
    expect(source).toContain('serveCrossRealmPreview(');
    expect(source).toContain('opts.previewScope === undefined ? {} : { scope: opts.previewScope }');
    expect(source).not.toContain('setupPreviewBridge(');
  });

  it('carries zero shim glue — internals shims are applied at install time (ADR-0188)', () => {
    // The esbuild/rollup/lightningcss shims are written by the npm-client
    // installer into the actual installed dirs; a boot-time overlay would
    // mask a broken install path (backlog npm-client/install-time-shadow-shims).
    expect(source).not.toContain('overlayShims');
    expect(source).not.toContain('reRootShimPath');
    expect(source).not.toContain('ShimFiles');
  });

  it('installs the real esbuild WASI transform bridge before Vite imports esbuild', () => {
    expect(source).toContain('installEsbuildTransformBridge(root)');
    expect(source.indexOf('installEsbuildTransformBridge(root)')).toBeLessThan(
      source.indexOf('loader.import(\n      cfg.runtimeSpecifier'),
    );
  });

  it('loud-rejects user vite.config files before curated dev boot can ignore them', () => {
    expect(source).toContain("import { assertNoUserViteConfig } from './vite-config-guard.ts'");
    expect(source).toContain('assertNoUserViteConfig(root)');
  });
});

describe('node-server runtime branch', () => {
  it('dispatches on the bootstrap config runtime discriminant', () => {
    expect(source).toContain("cfg.runtime === 'node-server'");
    expect(source).toContain("cfg.runtime === 'vite'");
    expect(source).toContain("cfg.runtime === 'node-cli'");
    expect(source).toContain('node-cli templates run through the owner node executor');
  });

  it('carries no eager node:sqlite bring-up — the builtin self-initializes at first require', () => {
    // the lazy node:sqlite engine — the realm installs a sync wasm provider
    // (glue/sqlite-wasm-provider.ts); no preset flag, no boot-time engine cost.
    expect(source).not.toContain('initSqliteEngine');
    expect(source).not.toContain('cfg.sqlite');
    expect(source).not.toContain('sql.js/dist/sql-wasm.wasm');
  });

  it('runs the entry as the server program', () => {
    expect(source).toContain('await loader.import(cfg.entryPath');
  });

  it('routes the server program console into kernel stdio (Node parity: console.log IS stdout)', () => {
    // Without this, server console.log lands in worker devtools, not the
    // playground terminal — the demo's request/db logs would be invisible.
    expect(source).toContain('console = new Console(');
  });

  it('fails loudly when the entry never starts listening on the routed port', () => {
    expect(source).toContain('listPorts()');
    expect(source).toContain('never started listening');
    // the guard must actually gate the boot path, not just exist as a helper
    expect(source).toContain('await waitForListeningPort(cfg.port');
  });

  it('carries no bespoke WS bridge — preview HTML injection is generic (ADR-0189)', () => {
    expect(source).not.toContain('setupHmrBridge(');
    expect(source).not.toContain('webSocketBridgeClientScript');
  });
});
