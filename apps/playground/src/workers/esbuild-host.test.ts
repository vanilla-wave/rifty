/**
 * Host esbuild bridge (ADR-0192) unit surface: the wasm_exec fs facade the
 * inline gojs service reads, and the bridge's lazy single-init + browser-lib
 * write normalization. The REAL esbuild-wasm service is browser-only (wasm +
 * fetch); it is exercised end-to-end by tests/e2e/manual-vite-install.spec.ts (real dep discovery) —
 * here the lib is the one unavoidable injected boundary.
 */
import type { FsSync } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type EsbuildWasmLib,
  type WasmExecFs,
  createEsbuildHost,
  createWasmExecFs,
} from './esbuild-host.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

function memoryMirror(): FsSync {
  return createMemoryFs().fsSync;
}

function call<T = unknown>(
  fn: (callback: (err: (Error & { code?: string }) | null, value?: unknown) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, value) => (err ? reject(err) : resolve(value as T)));
  });
}

afterEach(() => {
  // createEsbuildHost lazily installs the realm-global wasm_exec fs facade.
  (globalThis as { fs?: WasmExecFs }).fs = undefined;
});

describe('createWasmExecFs — wasm_exec fs facade over the sync mirror', () => {
  it('open/read/close round-trips file bytes with sequential positioning', async () => {
    const fs = memoryMirror();
    fs.mkdirSync('/workspace', { recursive: true });
    fs.writeFileSync('/workspace/a.txt', enc.encode('hello world'));
    const facade = createWasmExecFs(() => fs);

    const fd = await call<number>((cb) => facade.open('/workspace/a.txt', 0, 0, cb));
    const buffer = new Uint8Array(5);
    expect(await call<number>((cb) => facade.read(fd, buffer, 0, 5, null, cb))).toBe(5);
    expect(dec.decode(buffer)).toBe('hello');
    expect(await call<number>((cb) => facade.read(fd, buffer, 0, 5, null, cb))).toBe(5);
    expect(dec.decode(buffer)).toBe(' worl');
    // EOF after the tail byte.
    expect(await call<number>((cb) => facade.read(fd, buffer, 0, 5, null, cb))).toBe(1);
    expect(await call<number>((cb) => facade.read(fd, buffer, 0, 5, null, cb))).toBe(0);
    await call((cb) => facade.close(fd, cb));
  });

  it('creates + flushes written files on close (O_CREAT|O_TRUNC|O_WRONLY)', async () => {
    const fs = memoryMirror();
    fs.mkdirSync('/out', { recursive: true });
    const facade = createWasmExecFs(() => fs);
    const flags = facade.constants.O_WRONLY | facade.constants.O_CREAT | facade.constants.O_TRUNC;

    const fd = await call<number>((cb) => facade.open('/out/chunk.js', flags, 0o644, cb));
    const bytes = enc.encode('export {};');
    expect(await call<number>((cb) => facade.write(fd, bytes, 0, bytes.length, null, cb))).toBe(
      bytes.length,
    );
    await call((cb) => facade.close(fd, cb));
    expect(dec.decode(fs.readFileBytesSync('/out/chunk.js'))).toBe('export {};');
  });

  it('stat reports POSIX mode bits, sizes, and ENOENT with a code', async () => {
    const fs = memoryMirror();
    fs.mkdirSync('/workspace/dir', { recursive: true });
    fs.writeFileSync('/workspace/f.ts', enc.encode('const x = 1;'));
    const facade = createWasmExecFs(() => fs);

    type StatLike = {
      mode: number;
      size: number;
      ino: number;
      isDirectory(): boolean;
      isFile(): boolean;
      isSymbolicLink(): boolean;
    };
    const file = await call<StatLike>((cb) => facade.stat('/workspace/f.ts', cb));
    expect(file.mode & 0o170000).toBe(0o100000); // S_IFREG
    expect(file.size).toBe(12);
    const dir = await call<StatLike>((cb) => facade.stat('/workspace/dir', cb));
    expect(dir.mode & 0o170000).toBe(0o40000); // S_IFDIR
    expect(dir.ino).not.toBe(file.ino); // stable synthetic inos, not all-zero
    // Node fs.Stats METHODS — Go's fs_js.go CALLS these (panics on fields-only).
    expect(file.isDirectory()).toBe(false);
    expect(file.isFile()).toBe(true);
    expect(file.isSymbolicLink()).toBe(false);
    expect(dir.isDirectory()).toBe(true);

    await expect(call((cb) => facade.stat('/workspace/missing', cb))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    // No symlinks in the VFS: lstat === stat, readlink is EINVAL (Node parity).
    await expect(call((cb) => facade.readlink('/workspace/f.ts', cb))).rejects.toMatchObject({
      code: 'EINVAL',
    });
  });

  it('readdir lists child names', async () => {
    const fs = memoryMirror();
    fs.mkdirSync('/workspace/pkg', { recursive: true });
    fs.writeFileSync('/workspace/pkg/index.js', enc.encode(''));
    fs.writeFileSync('/workspace/pkg/package.json', enc.encode('{}'));
    const facade = createWasmExecFs(() => fs);
    const names = await call<string[]>((cb) => facade.readdir('/workspace/pkg', cb));
    expect([...names].sort()).toEqual(['index.js', 'package.json']);
  });

  it('routes fds 0-2 to the service protocol overrides, file fds to the VFS', async () => {
    const fs = memoryMirror();
    fs.mkdirSync('/workspace', { recursive: true });
    fs.writeFileSync('/workspace/a.txt', enc.encode('abc'));
    const facade = createWasmExecFs(() => fs);

    // The esbuild browser lib ASSIGNS its stdio handlers exactly like this.
    const protocolRead = vi.fn();
    const protocolWrite = vi.fn().mockReturnValue(3);
    facade.read = protocolRead;
    facade.writeSync = protocolWrite;

    facade.read(0, new Uint8Array(3), 0, 3, null, () => {});
    expect(protocolRead).toHaveBeenCalledTimes(1);
    expect(facade.writeSync(1, enc.encode('msg'))).toBe(3);
    expect(protocolWrite).toHaveBeenCalledWith(1, expect.any(Uint8Array));

    // File fds still hit the VFS after the stdio overrides are installed.
    const fd = await call<number>((cb) => facade.open('/workspace/a.txt', 0, 0, cb));
    const buffer = new Uint8Array(3);
    expect(await call<number>((cb) => facade.read(fd, buffer, 0, 3, null, cb))).toBe(3);
    expect(dec.decode(buffer)).toBe('abc');
  });

  it('defers callbacks off the caller stack (Go cannot be re-entered synchronously)', () => {
    const fs = memoryMirror();
    fs.mkdirSync('/workspace', { recursive: true });
    const facade = createWasmExecFs(() => fs);
    let sync = false;
    facade.stat('/workspace', () => {
      sync = true;
    });
    expect(sync).toBe(false);
  });
});

describe('createWasmExecFs — Node errno fidelity at the execution boundary', () => {
  it('read() on a directory fd → EISDIR, not silent EOF', async () => {
    const fs = memoryMirror();
    fs.mkdirSync('/workspace/dir', { recursive: true });
    const facade = createWasmExecFs(() => fs);
    // Node: open(dir, O_RDONLY) succeeds; read() on the dir fd → EISDIR.
    const fd = await call<number>((cb) => facade.open('/workspace/dir', 0, 0, cb));
    const buffer = new Uint8Array(8);
    await expect(call((cb) => facade.read(fd, buffer, 0, 8, null, cb))).rejects.toMatchObject({
      code: 'EISDIR',
    });
    await call((cb) => facade.close(fd, cb));
  });

  it('read() from an O_WRONLY fd → EBADF', async () => {
    const fs = memoryMirror();
    fs.mkdirSync('/out', { recursive: true });
    const facade = createWasmExecFs(() => fs);
    const flags = facade.constants.O_WRONLY | facade.constants.O_CREAT;
    const fd = await call<number>((cb) => facade.open('/out/w.js', flags, 0o644, cb));
    const buffer = new Uint8Array(4);
    await expect(call((cb) => facade.read(fd, buffer, 0, 4, null, cb))).rejects.toMatchObject({
      code: 'EBADF',
    });
    await call((cb) => facade.close(fd, cb));
  });

  it('write() through an O_RDONLY fd → EBADF', async () => {
    const fs = memoryMirror();
    fs.mkdirSync('/workspace', { recursive: true });
    fs.writeFileSync('/workspace/a.txt', enc.encode('hello'));
    const facade = createWasmExecFs(() => fs);
    const fd = await call<number>((cb) => facade.open('/workspace/a.txt', 0, 0, cb));
    const bytes = enc.encode('x');
    await expect(
      call((cb) => facade.write(fd, bytes, 0, bytes.length, null, cb)),
    ).rejects.toMatchObject({ code: 'EBADF' });
    await call((cb) => facade.close(fd, cb));
    // The read-only open must not have mutated the file.
    expect(dec.decode(fs.readFileBytesSync('/workspace/a.txt'))).toBe('hello');
  });

  it('ftruncate() through an O_RDONLY fd → EBADF', async () => {
    const fs = memoryMirror();
    fs.mkdirSync('/workspace', { recursive: true });
    fs.writeFileSync('/workspace/a.txt', enc.encode('hello'));
    const facade = createWasmExecFs(() => fs);
    const fd = await call<number>((cb) => facade.open('/workspace/a.txt', 0, 0, cb));
    await expect(call((cb) => facade.ftruncate(fd, 2, cb))).rejects.toMatchObject({
      code: 'EBADF',
    });
    await call((cb) => facade.close(fd, cb));
  });

  it('chmod / chown / lchown on a missing path → ENOENT', async () => {
    const fs = memoryMirror();
    const facade = createWasmExecFs(() => fs);
    await expect(call((cb) => facade.chmod('/missing', 0o644, cb))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(call((cb) => facade.chown('/missing', 0, 0, cb))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(call((cb) => facade.lchown('/missing', 0, 0, cb))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('fchmod / fchown / fsync on a bad fd → EBADF', async () => {
    const fs = memoryMirror();
    const facade = createWasmExecFs(() => fs);
    await expect(call((cb) => facade.fchmod(9999, 0o644, cb))).rejects.toMatchObject({
      code: 'EBADF',
    });
    await expect(call((cb) => facade.fchown(9999, 0, 0, cb))).rejects.toMatchObject({
      code: 'EBADF',
    });
    await expect(call((cb) => facade.fsync(9999, cb))).rejects.toMatchObject({ code: 'EBADF' });
  });

  it('chmod on an existing path + fsync on a live fd still succeed (permissionless mount parity)', async () => {
    const fs = memoryMirror();
    fs.mkdirSync('/workspace', { recursive: true });
    fs.writeFileSync('/workspace/a.txt', enc.encode('hi'));
    const facade = createWasmExecFs(() => fs);
    // The VFS has no perm/ownership metadata, so a VALID target is a Node-style no-op success.
    await call((cb) => facade.chmod('/workspace/a.txt', 0o600, cb));
    const fd = await call<number>((cb) => facade.open('/workspace/a.txt', 0, 0, cb));
    await call((cb) => facade.fsync(fd, cb));
    await call((cb) => facade.close(fd, cb));
  });
});

function fakeLib(overrides: Partial<EsbuildWasmLib> = {}): {
  lib: EsbuildWasmLib;
  initialize: ReturnType<typeof vi.fn>;
} {
  const initialize = vi.fn().mockResolvedValue(undefined);
  const lib = {
    version: '0.27.7',
    initialize,
    transform: vi.fn().mockResolvedValue({ code: 'x', map: '', warnings: [] }),
    build: vi.fn().mockResolvedValue({ errors: [], warnings: [] }),
    context: vi.fn(),
    formatMessages: vi.fn().mockResolvedValue([]),
    analyzeMetafile: vi.fn().mockResolvedValue(''),
    stop: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as EsbuildWasmLib;
  return { lib, initialize };
}

function outputFile(path: string, text: string) {
  return { path, contents: enc.encode(text), hash: '', text };
}

describe('createEsbuildHost — lazy single init + browser-lib write normalization', () => {
  it('initializes the service once, lazily, with worker:false and the bundled wasm URL', async () => {
    const { lib, initialize } = fakeLib();
    const host = createEsbuildHost({ lib, wasmUrl: '/assets/esbuild.wasm', mirror: memoryMirror });

    expect(host.version).toBe('0.27.7'); // real version, no init needed
    expect(initialize).not.toHaveBeenCalled();

    await host.transform('const x = 1;');
    await host.build({ entryPoints: [] });
    await host.formatMessages([], { kind: 'error' });
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledWith({ wasmURL: '/assets/esbuild.wasm', worker: false });
  });

  it('a failed initialize resets so the next call can retry', async () => {
    const { lib, initialize } = fakeLib();
    initialize.mockRejectedValueOnce(new Error('wasm fetch failed'));
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: memoryMirror });

    await expect(host.transform('x')).rejects.toThrow('wasm fetch failed');
    await host.transform('x');
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it('build(): the browser service never writes — the bridge writes outputFiles and strips them (native write:true parity)', async () => {
    const fs = memoryMirror();
    const build = vi.fn().mockResolvedValue({
      errors: [],
      warnings: [],
      outputFiles: [outputFile('/proj/node_modules/.vite/deps_temp/react.js', 'export {};')],
      metafile: { inputs: {}, outputs: {} },
    });
    const { lib } = fakeLib({ build } as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: () => fs });

    const result = await host.build({ entryPoints: ['react'], outdir: '/proj' });
    // The service must run write:false — write:true loud-throws in a browser env.
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({ entryPoints: ['react'], write: false }),
    );
    expect(dec.decode(fs.readFileBytesSync('/proj/node_modules/.vite/deps_temp/react.js'))).toBe(
      'export {};',
    );
    expect(result).not.toHaveProperty('outputFiles');
    expect(result.metafile).toEqual({ inputs: {}, outputs: {} });
  });

  it('build({write:false}) passes through untouched — outputFiles stay in memory', async () => {
    const fs = memoryMirror();
    const build = vi.fn().mockResolvedValue({
      errors: [],
      warnings: [],
      outputFiles: [outputFile('/proj/out.js', 'x')],
    });
    const { lib } = fakeLib({ build } as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: () => fs });

    const result = await host.build({ entryPoints: ['a'], write: false });
    expect(result.outputFiles).toHaveLength(1);
    expect(fs.existsSync('/proj/out.js')).toBe(false);
  });

  it('context(): rebuild writes outputFiles to the VFS; dispose/cancel delegate to the real context', async () => {
    const fs = memoryMirror();
    const dispose = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn().mockResolvedValue(undefined);
    const rebuild = vi.fn().mockResolvedValue({
      errors: [],
      warnings: [],
      outputFiles: [outputFile('/deps/chunk.js', 'export const a = 1;')],
      metafile: { inputs: {}, outputs: { 'deps/chunk.js': {} } },
    });
    const context = vi
      .fn()
      .mockResolvedValue({ rebuild, watch: vi.fn(), serve: vi.fn(), cancel, dispose });
    const { lib } = fakeLib({ context } as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: () => fs });

    const ctx = await host.context({ entryPoints: ['a'], outdir: '/deps' });
    expect(context).toHaveBeenCalledWith(expect.objectContaining({ write: false }));
    const result = await ctx.rebuild();
    expect(dec.decode(fs.readFileBytesSync('/deps/chunk.js'))).toBe('export const a = 1;');
    expect(result).not.toHaveProperty('outputFiles');
    expect(result.metafile).toEqual({ inputs: {}, outputs: { 'deps/chunk.js': {} } });
    await ctx.cancel();
    await ctx.dispose();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('context({write:true}).watch() loud-throws instead of silently dropping output writes', async () => {
    const watch = vi.fn().mockResolvedValue(undefined);
    const context = vi.fn().mockResolvedValue({
      rebuild: vi.fn().mockResolvedValue({ errors: [], warnings: [], outputFiles: [] }),
      watch,
      serve: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(),
    });
    const { lib } = fakeLib({ context } as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: memoryMirror });

    const ctx = await host.context({ entryPoints: ['a'], outdir: '/deps' });
    await expect(ctx.watch()).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'esbuild.context.watch.write',
    });
    expect(watch).not.toHaveBeenCalled();
  });

  it('context({write:false}).watch() still delegates to the real context', async () => {
    const watch = vi.fn().mockResolvedValue(undefined);
    const context = vi.fn().mockResolvedValue({
      rebuild: vi.fn(),
      watch,
      serve: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(),
    });
    const { lib } = fakeLib({ context } as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: memoryMirror });

    const ctx = await host.context({ entryPoints: ['a'], outdir: '/deps', write: false });
    await ctx.watch({ delay: 10 });
    expect(watch).toHaveBeenCalledWith({ delay: 10 });
  });

  it('stop(): no-op before init; after init stops the service and the next call re-initializes', async () => {
    const { lib, initialize } = fakeLib();
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: memoryMirror });

    await host.stop();
    expect(lib.stop).not.toHaveBeenCalled();

    await host.transform('x');
    await host.stop();
    expect(lib.stop).toHaveBeenCalledTimes(1);
    await host.transform('x');
    expect(initialize).toHaveBeenCalledTimes(2);
  });
});

describe('esbuild-wasm version coupling', () => {
  it('the playground esbuild-wasm pin, the shim static version claim, and the trigger pin agree', async () => {
    // The guest shim's `version` export is a STATIC claim (no import-time host
    // read — vite chunks import { version } at module eval, before any bridge
    // exists). The claim is honest only while the three pins move in lockstep.
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { devDependencies?: Record<string, string> };
    const registrySource = readFileSync(
      new URL('../../../../tools/shadow-registry/src/index.ts', import.meta.url),
      'utf8',
    );
    const shimVersion = /const SHIM_ESBUILD_VERSION = '([^']+)'/.exec(registrySource)?.[1];
    const triggerPin = /esbuild: '@esbuild\/wasi-preview1@([^']+)'/.exec(registrySource)?.[1];
    expect(pkg.devDependencies?.['esbuild-wasm']).toBe(shimVersion);
    expect(triggerPin).toBe(shimVersion);
  });
});
