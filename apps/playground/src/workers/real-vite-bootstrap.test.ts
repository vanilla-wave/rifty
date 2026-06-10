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
    expect(source).toContain(
      "hmrBridgeRef.current?.broadcast(JSON.stringify({ type: 'update', path }))",
    );
    expect(source).toContain('hmrBridgeRef.current = setupHmrBridge({ port })');
    expect(source).toContain(
      'const tearVfsBridge = serveVfsWrites(port, { onWrite: handleVfsWrite })',
    );
  });

  it('accepts VFS write frames over the kernel worker IPC channel', () => {
    expect(source).toContain('const kernelIpc = installRuntimeGlobals()');
    expect(source).toContain('kernelIpc.onMessage?.((message) => {');
    expect(source).toContain('applyVfsWriteFrame(message.frame, { onWrite: handleVfsWrite })');
  });
});
