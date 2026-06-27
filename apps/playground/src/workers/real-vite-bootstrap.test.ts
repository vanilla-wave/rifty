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

  it('passes browser HMR config to real vite .bin dev children', () => {
    expect(source).toContain('const VITE_DEFAULT_DEV_PORT = 5173');
    expect(source).toContain('RIFTY_VITE_CLI_HMR');
    expect(source).toContain('RIFTY_VITE_CLI_PORT');
    expect(source).toContain('withViteCliArgs');
  });

  it('forwards editor writes into the active real vite CLI child', () => {
    expect(source).toContain('let activeViteDevChild');
    expect(source).toContain("type: 'rifty:vite-file-change'");
    expect(source).toContain('activeViteDevChild?.send');
  });

  it('accepts VFS write frames over the kernel worker IPC channel', () => {
    expect(source).toContain('const kernelIpc = installRuntimeGlobals()');
    expect(source).toContain('kernelIpc.onMessage?.((message) => {');
    expect(source).toContain('applyVfsWriteFrame(message.frame, { onWrite: onVfsWrite })');
  });

  it('re-seeds template-owned node_modules files into the owner before child dev boot', () => {
    expect(source).toContain('function seedTemplateNodeModulesFiles(cfg: BootstrapConfig)');
    expect(source).toContain('const nodeModulesRoot = `${cfg.root}/node_modules/`;');
    expect(source).toContain('seedTemplateNodeModulesFiles(devCfg);');
  });
});

describe('vite command — real installed bin routing', () => {
  it('does not register an owner vite command that would shadow node_modules/.bin/vite', () => {
    expect(source).not.toContain("shell.registerCommand('vite'");
    expect(source).not.toContain('classifyViteCommand');
    expect(source).toContain('createOwnerChildBinExecutor(opts.nodeEntryWorkerUrl');
    expect(source).toContain("binNameOf(req.shimPath) === 'vite'");
  });

  it('mirrors server-capable non-vite bins into the preview registry', () => {
    expect(source).toContain('const binPreviewSids = new WeakMap<object, string>()');
    expect(source).toContain('previews.addNode(sid, message.ports)');
    expect(source).toContain('previews.removeBySid(sid)');
  });

  it('routes vite npm scripts through the same shell/bin path as direct commands', () => {
    expect(source).toContain('const runPackageScript = async');
    expect(source).toContain("devSpec.runtime !== 'vite' && isDevScriptName(devSpec, name)");
    expect(source).toContain('const scriptShell = makeShell({ cwd: ctx.cwd, env: ctx.env })');
    expect(source).toContain('const result = await scriptShell.run(command');
    expect(source).not.toContain('only the dev line boots the co-resident server');
  });

  it('waits for preset dev-config dependency restore before running the next pty command', () => {
    expect(source).toContain('let devConfigReady: Promise<void> = Promise.resolve()');
    expect(source).toContain('devConfigReady = prepareActiveDevConfigDeps()');
    expect(source).toContain("if (frame.type === 'pty:exec')");
    expect(source).toContain('void devConfigReady.then(() => server.handleFrame(frame))');
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
