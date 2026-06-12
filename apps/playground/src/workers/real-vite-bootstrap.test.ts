import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./real-vite-bootstrap.ts', import.meta.url)),
  'utf8',
);

describe('real Vite bootstrap preview routing', () => {
  it('uses a relative Vite base so transformed imports stay under the preview route', () => {
    expect(source).toContain("base: './'");
  });

  it('broadcasts HMR updates for page-to-worker VFS writes', () => {
    expect(source).toContain('function handleVfsWrite(path: string): void');
    expect(source).toContain('const hmrBridgeRef: { current?: HmrBridgeHandle } = {}');
    expect(source).toContain('function broadcastFileUpdate(path: string): void');
    expect(source).toContain('hmrBridgeRef.current?.broadcast(');
    expect(source).toContain("type: 'update'");
    expect(source).toContain("event: 'change'");
    expect(source).toContain('path: toRootRelativePath(root, modulePath)');
    expect(source).toContain(
      'hmrBridgeRef.current = setupHmrBridge({ port, token: hmrBridgeToken })',
    );
    expect(source).toContain(
      'const tearVfsBridge = serveVfsWrites(port, { onWrite: handleVfsWrite })',
    );
  });

  it('accepts VFS write frames over the kernel worker IPC channel', () => {
    expect(source).toContain('const kernelIpc = installRuntimeGlobals()');
    expect(source).toContain('kernelIpc.onMessage?.((message) => {');
    expect(source).toContain('applyVfsWriteFrame(message.frame, { onWrite: handleVfsWrite })');
  });

  it('advertises the page owner token on the direct service-worker bridge', () => {
    expect(source).toContain('const ownerToken = env.RIFTY_PREVIEW_OWNER_TOKEN');
    expect(source).toContain('setupPreviewBridge(dispatchSerializedPreview, {');
    expect(source).toContain('ownerToken,');
  });
});

describe('node-server runtime branch', () => {
  it('dispatches on the bootstrap config runtime discriminant', () => {
    expect(source).toContain("cfg.runtime === 'node-server'");
    expect(source).toContain("cfg.runtime === 'vite'");
  });

  it('registers node:sqlite and brings the WASM engine up from a same-origin asset', () => {
    // side-effect import makes require('node:sqlite') resolvable in user code
    expect(source).toContain("import '@riftydev/net/sqlite/register-builtins'");
    // engine bytes come from the bundled asset (CORP-correct, D-001 — no CDN),
    // passed as wasmBinary so the emscripten glue never probes fs/fetch paths
    expect(source).toContain("from 'sql.js/dist/sql-wasm.wasm?url'");
    expect(source).toContain('initSqliteEngine(config)');
    expect(source).toContain('wasmBinary');
  });

  it('runs the entry as the server program with cwd at the project root', () => {
    // express.static('public') resolves against process.cwd()
    expect(source).toContain('setProcessCwd(cfg.root)');
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
    // setupHmrBridge must not appear in the shared/common path; pin the call
    // count so a node-branch copy fails this test.
    expect(source.split('setupHmrBridge(').length - 1).toBe(1);
  });
});
