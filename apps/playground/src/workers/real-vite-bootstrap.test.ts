import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./real-vite-bootstrap.ts', import.meta.url)),
  'utf8',
);

describe('real Vite bootstrap preview routing', () => {
  it('forwards editor VFS writes to the co-resident dev server HMR + republishes', () => {
    // ADR-0148 (co-resident dev server runs inside the store owner): the owner's
    // single vfs-write handler forwards editor writes to
    // the running dev server's HMR (the virtual FS fires no real watcher events).
    expect(source).toContain('const onVfsWrite = (path: string): void');
    expect(source).toContain('devServer.notifyFileChanged(path)');
    expect(source).toContain('const tearVfsBridge = serveVfsWrites(port, { onWrite: onVfsWrite })');
  });

  it('accepts VFS write frames over the kernel worker IPC channel', () => {
    expect(source).toContain('const kernelIpc = installRuntimeGlobals()');
    expect(source).toContain('kernelIpc.onMessage?.((message) => {');
    expect(source).toContain('applyVfsWriteFrame(message.frame, { onWrite: onVfsWrite })');
  });

  it('advertises the page owner token on the direct service-worker bridge', () => {
    expect(source).toContain('const ownerToken = env.RIFTY_PREVIEW_OWNER_TOKEN');
    expect(source).toContain('ownerToken,');
  });
});

describe('node-server runtime branch', () => {
  it('calls builtin registrars explicitly so production bundling cannot drop them', () => {
    expect(source).toContain(
      "import { registerNetBuiltins } from '@riftydev/net/register-builtins'",
    );
    expect(source).toContain(
      "import { registerSqliteBuiltin } from '@riftydev/net/sqlite/register-builtins'",
    );
    expect(source).toContain('registerNetBuiltins()');
    expect(source).toContain('registerSqliteBuiltin()');
  });

  it('registers node:sqlite so require(node:sqlite) resolves in user code', () => {
    // explicit registrar makes require('node:sqlite') resolvable in user code
    expect(source).toContain('registerSqliteBuiltin()');
  });

  it('runs the entry as the server program with cwd at the project root', () => {
    // express.static('public') resolves against process.cwd()
    expect(source).toContain('setProcessCwd(cfg.root)');
  });
});

describe('OPFS persistence wiring (owner OPFS persistence)', () => {
  it('wires the OPFS-or-memory backend before serving the owner (initBackend)', () => {
    // The owner is the workspace source-of-truth once the dev server is co-resident
    // in it, but was the only worker realm not calling initBackend() → memory-only,
    // losing the tree on reload. Owner OPFS persistence applies the established
    // OPFS-boot pattern (runtime-js/worker-entry.ts).
    // OPFS write-through (ADR-0072) is the durability mechanism on its own — no
    // explicit per-command flush barrier (it only coupled command latency to the
    // unrelated boot write-through queue).
    expect(source).toContain('await initBackend()');
  });
});
