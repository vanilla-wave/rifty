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
    expect(source).toContain('const onVfsWrite = (paths: readonly string[]): void');
    expect(source).toContain('for (const path of paths)');
    expect(source).toContain('devServer.notifyFileChanged(path)');
    expect(source).toContain('const tearVfsBridge = serveVfsWrites(port, { onWrite: onVfsWrite })');
  });

  it('uses the status-aware owner publish wrapper for every owner mutation refresh hook', () => {
    expect(source).toContain('onSnapshotDirty: publishOwnerState');
    expect(source).not.toContain('onSnapshotDirty: publishSnapshot');
    expect(source).toContain('flushSyncMirror,\n    publishOwnerState,');
  });

  it('passes browser HMR config to real vite .bin dev children', () => {
    expect(source).toContain('const VITE_DEFAULT_DEV_PORT = 5173');
    expect(source).toContain('RIFTY_VITE_CLI_HMR');
    expect(source).toContain('RIFTY_VITE_CLI_PORT');
    expect(source).toContain('withViteCliArgs');
  });

  it('runs real vite preview on the synthetic preview-local host without the dev wrapper config', () => {
    expect(source).toContain("if (mode === 'preview')");
    expect(source).toContain("return [...args, '--host', PREVIEW_LOCAL_HOST]");
    expect(source).toContain("if (mode !== 'dev') return [...args]");
    expect(source).toContain('const userConfigEnv: Record<string, string> = {}');
    expect(source).toContain("...(mode === 'preview' ? userConfigEnv : {})");
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

  it('acks owner-routed VFS writes with real owner-side apply errors', () => {
    expect(source).toContain("type: 'rifty:vfs-write-ack'");
    expect(source).toContain('opId: message.opId');
    expect(source).toContain('ok: false');
    expect(source).toContain('error: { name: error.name, message: error.message }');
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
    expect(source).toContain('previews.addNode(sid, message.ports, message.previewScope');
    expect(source).toContain('previews.removeBySid(sid)');
  });

  it('routes vite npm scripts through the same shell/bin path as direct commands', () => {
    expect(source).toContain('const runPackageScript = async');
    expect(source).toContain("devSpec.runtime === 'node-server' && isDevScriptName(devSpec, name)");
    expect(source).toContain('execBin: ownerBinExecutor');
    expect(source).toContain('const scriptShell = makeShell(');
    expect(source).toContain('{ cwd: scriptCtx.cwd, env: scriptCtx.env }');
    expect(source).toContain('ptySidFromContext(scriptCtx)');
    expect(source).toContain('const result = await scriptShell.run(scriptCommand');
    expect(source).not.toContain('only the dev line boots the co-resident server');
  });

  it('runs node-cli lifecycle scripts by executing the package.json command', () => {
    expect(source).toContain('const runNodeCliTemplate = async');
    expect(source).toContain("devSpec.runtime === 'node-cli' && isDevScriptName(devSpec, name)");
    expect(source).toContain('scriptCtx.stdout.write(`cli: running ${devSpec.displayName}\\n`)');
    expect(source).toContain('return runNodeCliTemplate(command, ctx)');
    expect(source).not.toContain('ownerNodeExecutor(devCfg.entryPath, [], ctx');
    expect(source).toContain('scriptCtx.stdout.write(`[cli] completed with exit code ${code}\\n`)');
  });

  it('waits for preset dev-config dependency restore before running the next pty command', () => {
    expect(source).toContain('let devConfigReady: Promise<void> = Promise.resolve()');
    expect(source).toContain('devConfigReady = prepareActiveDevConfigDeps()');
    expect(source).toContain('return devConfigReady');
    expect(source).toContain("if (frame.type === 'pty:exec')");
    expect(source).toContain('void devConfigReady.then(() => server.handleFrame(frame))');
  });

  it('waits for preset dev-config dependency restore before relaying TS-LSP requests', () => {
    expect(source).toContain('async function waitForWorkspaceTypeScript(root: string)');
    expect(source).toContain('await devConfigReady;');
    expect(source).toContain('await waitForWorkspaceTypeScript(devCfg.root);');
    expect(source).toContain('relayTsLspRequest(message);');
  });

  it('restores instant dependencies without wiping user files in the project root', () => {
    const restoreStart = source.indexOf('async function restoreInstantDeps(');
    const restoreEnd = source.indexOf('function seedTemplateNodeModulesFiles', restoreStart);
    const restore = source.slice(restoreStart, restoreEnd);
    expect(restoreStart).toBeGreaterThan(-1);
    expect(restoreEnd).toBeGreaterThan(restoreStart);
    expect(restore).not.toContain('clearProjectTree(fs, cfg.root)');
    expect(restore).toContain('fs.rmSync(`${cfg.root}/node_modules`');
    expect(restore).toContain('fs.rmSync(`${cfg.root}/package-lock.json`');
    expect(restore).toContain('fs.rmSync(`${cfg.root}/package.json`');
  });

  it('absorbs generated baseline files immediately after dev-config instant restore', () => {
    const prepareStart = source.indexOf('async function prepareActiveDevConfigDeps()');
    const prepareEnd = source.indexOf('// Co-resident dev server', prepareStart);
    const prepare = source.slice(prepareStart, prepareEnd);
    expect(prepareStart).toBeGreaterThan(-1);
    expect(prepareEnd).toBeGreaterThan(prepareStart);
    expect(prepare.indexOf('await restoreInstantDeps(devCfg, devSpec.id, devSlug);')).toBeLessThan(
      prepare.indexOf('await absorbPendingStarterGeneratedBaseline(devCfg.root);'),
    );
    expect(
      prepare.indexOf('await absorbPendingStarterGeneratedBaseline(devCfg.root);'),
    ).toBeLessThan(prepare.indexOf('seedTemplateNodeModulesFiles(devCfg);'));
  });

  it('publishes owner readiness after IPC handlers and workspace bridges are served', () => {
    const onMessageAt = source.indexOf('kernelIpc.onMessage?.((message) => {');
    const bridgeAt = source.indexOf('const tearIndexBridge = serveProjectIndex(');
    const readyAt = source.indexOf(
      "kernelIpc.send?.({ type: 'rifty:workspace-owner-ready', port })",
    );
    expect(onMessageAt).toBeGreaterThan(-1);
    expect(bridgeAt).toBeGreaterThan(onMessageAt);
    expect(readyAt).toBeGreaterThan(bridgeAt);
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
