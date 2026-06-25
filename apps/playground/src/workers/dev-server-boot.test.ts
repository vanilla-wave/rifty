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
    expect(source).toContain('invalidateViteModule(activeServer, modulePath)');
    expect(source).not.toContain('function broadcastFileUpdate(path: string): void');
    expect(source).not.toContain('hmrBridgeRef.current?.broadcast(');
    // The bridge token + plugin + "bridge ready" log are gated on HMR being
    // enabled — no token minted and no false "bridge ready" signal when HMR is off
    // (Vite 8 template, ADR-0161).
    expect(source).toContain(
      'const hmrBridgeToken = cfg.hmrEnabled ? createHmrBridgeToken() : null',
    );
    expect(source).toContain(
      'plugins: hmrBridgeToken ? [createHmrBridgeVitePlugin({ port, token: hmrBridgeToken })] : []',
    );
    expect(source).toContain('host: PREVIEW_LOCAL_HOST');
    expect(source).toContain('path: `__hmr/${encodeURIComponent(hmrBridgeToken)}`');
    expect(source).not.toContain('channels:');
    expect(source).not.toContain('ws: false');
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
    expect(source).toContain('serveCrossRealmPreview(port');
    expect(source).not.toContain('setupPreviewBridge(');
  });

  it('re-roots the esbuild/rollup shim overlay onto the active root, not /workspace (ADR-0165 §4)', () => {
    // The shim files are keyed on the historical `/workspace/node_modules/...`
    // path; ADR-0165 moved the dev root to `/scratch` | `/projects/<id>`. The
    // overlay MUST re-root onto the active root, else the REAL native rollup loads
    // (Rollup throws on the rifty/wasm platform) and every Vite dev boot breaks.
    expect(source).toContain('overlayShims(root)'); // passes the active root
    expect(source).toContain('reRootShimPath'); // and re-roots the /workspace key
    // overlayShims writes the RE-ROOTED path, never the verbatim /workspace key.
    expect(source).toContain('reRootShimPath(path, root)');
  });
});

describe('node-server runtime branch', () => {
  it('dispatches on the bootstrap config runtime discriminant', () => {
    expect(source).toContain("cfg.runtime === 'node-server'");
    expect(source).toContain("cfg.runtime === 'vite'");
  });

  it('brings the node:sqlite WASM engine up from a same-origin asset', () => {
    // engine bytes come from the bundled asset (CORP-correct, D-001 — no CDN),
    // passed as wasmBinary so the emscripten glue never probes fs/fetch paths
    expect(source).toContain("from 'sql.js/dist/sql-wasm.wasm?url'");
    expect(source).toContain('initSqliteEngine(config)');
    expect(source).toContain('wasmBinary');
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

  it('keeps the HMR bridge a vite-only concern', () => {
    // The browser WebSocket bridge injection must not leak into node-server boot.
    expect(source).not.toContain('setupHmrBridge(');
    expect(source.split('createHmrBridgeVitePlugin(').length - 1).toBe(1);
  });
});
