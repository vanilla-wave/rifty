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
  writeOutputFiles,
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

  it('build(): the browser service never writes — the bridge writes outputFiles and marks them written (native write:true parity)', async () => {
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
    // RENEGOTIATED (PR#125 r4): this asserted the key was ABSENT; real esbuild
    // 0.28.0 (probed 2026-07-10) keeps `outputFiles` as an own enumerable
    // `undefined` key on write:true results.
    expect(outputFilesShape(result)).toEqual(NATIVE_WRITTEN_SHAPE);
    expect(result.metafile).toEqual({ inputs: {}, outputs: {} });
  });

  it('build() with no outfile/outdir writes NOTHING — the <stdout> entry is dropped (native parity)', async () => {
    // Real esbuild (probed on 0.28.0): default-write build with no
    // outfile/outdir succeeds, writes nothing, and the JS-API result carries
    // `outputFiles` as an own enumerable `undefined` key. The browser service
    // (forced write:false) reports one outputFile with the literal path
    // '<stdout>' — writing that to the VFS invents a file native esbuild
    // never creates.
    const fs = memoryMirror();
    const build = vi.fn().mockResolvedValue({
      errors: [],
      warnings: [],
      outputFiles: [outputFile('<stdout>', 'export {};')],
    });
    const { lib } = fakeLib({ build } as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: () => fs });

    const result = await host.build({ entryPoints: ['a'] });
    // RENEGOTIATED (PR#125 r4): was `not.toHaveProperty` — native shape is the
    // own-undefined key (probe 2026-07-10).
    expect(outputFilesShape(result)).toEqual(NATIVE_WRITTEN_SHAPE);
    expect(fs.existsSync('/<stdout>')).toBe(false);
    expect(fs.readdirSync('/')).toEqual([]); // nothing materialized at all
  });

  it('build() defaults absWorkingDir to the guest cwd (relative outdir must not resolve from the wasm root)', async () => {
    // Real esbuild resolves relative outdir/entryPoints against the service
    // cwd; the browser service's internal cwd is '/', not the guest program's
    // process.cwd() — without the default a `vite build` in /scratch writes
    // its dist under the VFS ROOT.
    const build = vi.fn().mockResolvedValue({ errors: [], warnings: [], outputFiles: [] });
    const { lib } = fakeLib({ build } as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: memoryMirror });
    const proc = globalThis.process as { cwd?: () => string };
    const realCwd = proc.cwd;
    proc.cwd = () => '/scratch';
    try {
      await host.build({ entryPoints: ['a'], outdir: 'dist' });
      expect(build).toHaveBeenCalledWith(expect.objectContaining({ absWorkingDir: '/scratch' }));
      // Caller-provided absWorkingDir wins.
      await host.build({ entryPoints: ['a'], outdir: 'dist', absWorkingDir: '/proj' });
      expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ absWorkingDir: '/proj' }));
      // The write:false passthrough gets the same default (paths in the
      // returned outputFiles must be guest-cwd-relative too).
      await host.build({ entryPoints: ['a'], write: false });
      expect(build).toHaveBeenLastCalledWith(
        expect.objectContaining({ absWorkingDir: '/scratch', write: false }),
      );
    } finally {
      proc.cwd = realCwd;
    }
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
    // RENEGOTIATED (PR#125 r4): was `not.toHaveProperty` — native shape is the
    // own-undefined key (real esbuild 0.28.0 probe 2026-07-10).
    expect(outputFilesShape(result)).toEqual(NATIVE_WRITTEN_SHAPE);
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

// Fault tier — fs facade persistence boundary (fault classes: provenance-lie ×
// fsync, quota-perm-fail × flush, torn-state × multi-output write).
describe('createWasmExecFs — fault: flush honesty', () => {
  it('fsync flushes dirty bytes to the mirror BEFORE close (fsync success is not a durability lie)', async () => {
    const fs = memoryMirror();
    fs.mkdirSync('/workspace', { recursive: true });
    const facade = createWasmExecFs(() => fs);
    const { O_WRONLY, O_CREAT, O_TRUNC } = facade.constants;
    const fd = await call<number>((cb) =>
      facade.open('/workspace/out.txt', O_WRONLY | O_CREAT | O_TRUNC, 0o644, cb),
    );
    await call((cb) => facade.write(fd, enc.encode('data'), 0, 4, null, cb));
    await call((cb) => facade.fsync(fd, cb));
    // Crash-before-close scenario: fsynced bytes must already be in the mirror.
    expect(dec.decode(fs.readFileBytesSync('/workspace/out.txt'))).toBe('data');
    await call((cb) => facade.close(fd, cb));
  });

  it('fsync surfaces a mirror write failure instead of claiming success', async () => {
    const real = memoryMirror();
    real.mkdirSync('/workspace', { recursive: true });
    let failWrites = false;
    const mirror = new Proxy(real, {
      get(target, prop) {
        if (prop === 'writeFileSync' && failWrites) {
          return () => {
            throw Object.assign(new Error('disk quota exceeded'), { code: 'EDQUOT' });
          };
        }
        // Bind to the target: FsSync methods use #private state — a proxy
        // receiver would detach them.
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as FsSync;
    const facade = createWasmExecFs(() => mirror);
    const { O_WRONLY, O_CREAT, O_TRUNC } = facade.constants;
    const fd = await call<number>((cb) =>
      facade.open('/workspace/out.txt', O_WRONLY | O_CREAT | O_TRUNC, 0o644, cb),
    );
    await call((cb) => facade.write(fd, enc.encode('data'), 0, 4, null, cb));
    failWrites = true;
    await expect(call((cb) => facade.fsync(fd, cb))).rejects.toThrow('disk quota exceeded');
  });

  it('writeOutputFiles: a mid-list write failure is LOUD — torn output surfaces, never a silent success', () => {
    const real = memoryMirror();
    let writes = 0;
    const mirror = new Proxy(real, {
      get(target, prop) {
        if (prop === 'writeFileSync') {
          return (path: string, data: Uint8Array) => {
            writes += 1;
            if (writes === 2) throw Object.assign(new Error('quota'), { code: 'EDQUOT' });
            real.writeFileSync(path, data);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as FsSync;
    expect(() =>
      writeOutputFiles(mirror, [
        outputFile('/o/a.js', '1'),
        outputFile('/o/b.js', '2'),
        outputFile('/o/c.js', '3'),
      ]),
    ).toThrow('quota');
    expect(real.existsSync('/o/a.js')).toBe(true); // torn — but the caller SAW the throw
    expect(real.existsSync('/o/c.js')).toBe(false); // stopped at the fault, no blind continue
  });
});

// Plugin-visible write surface: the bridge's write:false rewrite must be
// invisible to user plugins (provenance-lie kill — a plugin reading
// initialOptions.write or expecting written files in onEnd saw the rewrite).
type ProbeBuild = {
  initialOptions: Record<string, unknown>;
  esbuild: unknown;
  onEnd: (cb: (result: Record<string, unknown>) => unknown) => void;
};
type ProbePlugin = { name: string; setup: (build: ProbeBuild) => unknown };

// Stands for the browser lib's module exports that the REAL service puts on
// pluginBuild.esbuild (esm/browser.js `esbuild: streamIn.esbuild`) — the raw
// object the bridge must never leak to plugins.
const rawBrowserLibSentinel = { rawBrowserLib: true };

function pluginRunningBuild(resultOf: () => Record<string, unknown>) {
  // Executes plugins the way esbuild does: setup at build start (initialOptions
  // = the live options object), onEnd hooks in registration order against the
  // SHARED result object (mutations propagate to the resolved value).
  return vi.fn().mockImplementation(async (opts: { plugins?: ProbePlugin[] }) => {
    const onEnds: Array<(r: Record<string, unknown>) => unknown> = [];
    for (const p of opts.plugins ?? []) {
      await p.setup({
        initialOptions: opts as unknown as Record<string, unknown>,
        esbuild: rawBrowserLibSentinel,
        onEnd: (cb) => onEnds.push(cb),
      });
    }
    const result = resultOf();
    for (const cb of onEnds) await cb(result);
    return result;
  });
}

function pluginRunningContext(resultOf: () => Record<string, unknown>) {
  // Context twin of pluginRunningBuild: setup at context creation, per-rebuild
  // onEnd against a fresh shared result.
  const watch = vi.fn().mockResolvedValue(undefined);
  const context = vi.fn().mockImplementation(async (opts: { plugins?: ProbePlugin[] }) => {
    const onEnds: Array<(r: Record<string, unknown>) => unknown> = [];
    for (const p of opts.plugins ?? []) {
      await p.setup({
        initialOptions: opts as unknown as Record<string, unknown>,
        esbuild: rawBrowserLibSentinel,
        onEnd: (cb) => onEnds.push(cb),
      });
    }
    return {
      rebuild: async () => {
        const r = resultOf();
        for (const cb of onEnds) await cb(r);
        return r;
      },
      watch,
      serve: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(),
    };
  });
  return { context, watch };
}

/** Own-key shape of `result.outputFiles` (native write:true oracle: own enumerable undefined). */
function outputFilesShape(r: object): { hasOwn: boolean; value: unknown; enumerable?: boolean } {
  return {
    hasOwn: Object.prototype.hasOwnProperty.call(r, 'outputFiles'),
    value: (r as { outputFiles?: unknown }).outputFiles,
    enumerable: Object.getOwnPropertyDescriptor(r, 'outputFiles')?.enumerable,
  };
}
const NATIVE_WRITTEN_SHAPE = { hasOwn: true, value: undefined, enumerable: true };

describe('createEsbuildHost — plugin-visible write:true surface stays native', () => {
  it('a user plugin observes the CALLER write shape in initialOptions, not the bridge rewrite', async () => {
    const fs = memoryMirror();
    const build = pluginRunningBuild(() => ({
      errors: [],
      warnings: [],
      outputFiles: [outputFile('/out/a.js', 'x')],
    }));
    const { lib } = fakeLib({ build } as unknown as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: () => fs });
    const seen: unknown[] = [];
    const probe: ProbePlugin = {
      name: 'probe',
      setup(b) {
        seen.push(b.initialOptions.write, 'write' in b.initialOptions);
      },
    };

    await host.build({
      entryPoints: ['a'],
      outdir: '/out',
      write: true,
      plugins: [probe as never],
    });
    expect(seen).toEqual([true, true]);

    seen.length = 0;
    await host.build({ entryPoints: ['a'], outdir: '/out', plugins: [probe as never] });
    expect(seen).toEqual([undefined, false]); // omitted stays omitted

    // …while the SERVICE really ran write:false underneath (browser lib would throw).
    expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ write: false }));
  });

  it('user onEnd hooks run AFTER outputs land on the VFS and see a native write:true result shape', async () => {
    const fs = memoryMirror();
    const build = pluginRunningBuild(() => ({
      errors: [],
      warnings: [],
      outputFiles: [outputFile('/out/a.js', 'x')],
    }));
    const { lib } = fakeLib({ build } as unknown as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: () => fs });
    const observed: Record<string, unknown> = {};
    const probe: ProbePlugin = {
      name: 'probe',
      setup(b) {
        b.onEnd((r) => {
          observed.fileOnDisk = fs.existsSync('/out/a.js');
          observed.outputFiles = outputFilesShape(r);
        });
      },
    };

    const result = await host.build({
      entryPoints: ['a'],
      outdir: '/out',
      plugins: [probe as never],
    });
    // RENEGOTIATED (PR#125 r4): asserted `'outputFiles' in r === false`; real
    // esbuild 0.28.0 onEnd (probed 2026-07-10) sees the own enumerable
    // `undefined` key on the shared result.
    expect(observed).toEqual({ fileOnDisk: true, outputFiles: NATIVE_WRITTEN_SHAPE });
    expect(outputFilesShape(result)).toEqual(NATIVE_WRITTEN_SHAPE);
    expect(dec.decode(fs.readFileBytesSync('/out/a.js'))).toBe('x');
  });

  it('plugin mutations of initialOptions flow through to the real build options', async () => {
    const build = pluginRunningBuild(() => ({ errors: [], warnings: [], outputFiles: [] }));
    const { lib } = fakeLib({ build } as unknown as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: memoryMirror });
    const mutator: ProbePlugin = {
      name: 'mutate',
      setup(b) {
        b.initialOptions.define = { X: '1' };
      },
    };

    await host.build({ entryPoints: ['a'], outdir: '/out', plugins: [mutator as never] });
    expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ define: { X: '1' } }));
  });

  it('build({write:false}) with plugins: outputFiles stay in memory, VFS untouched, caller shape intact', async () => {
    // RENEGOTIATED (PR#125 r4): this pinned the passthrough implementation
    // (raw plugin refs, no injected writer). Real esbuild 0.28.0 (probed
    // 2026-07-10) honors a setup() write flip even on write:false builds and
    // exposes a module-shaped pluginBuild.esbuild — both impossible under
    // passthrough, so write:false plugin builds run the masked path now. The
    // guest-observable contract stays: no VFS writes, outputFiles in memory,
    // plugin reads back the caller's write:false.
    const fs = memoryMirror();
    const build = pluginRunningBuild(() => ({
      errors: [],
      warnings: [],
      outputFiles: [outputFile('/out/a.js', 'x')],
    }));
    const { lib } = fakeLib({ build } as unknown as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: () => fs });
    const seen: unknown[] = [];
    const probe: ProbePlugin = {
      name: 'p',
      setup(b) {
        seen.push(b.initialOptions.write, 'write' in b.initialOptions);
      },
    };

    const result = await host.build({
      entryPoints: ['a'],
      write: false,
      plugins: [probe as never],
    });
    expect(seen).toEqual([false, true]);
    expect(result.outputFiles).toHaveLength(1);
    expect(fs.existsSync('/out/a.js')).toBe(false);
  });

  it('context(): user onEnd hooks see rebuilt outputs on the VFS per rebuild, native result shape', async () => {
    const fs = memoryMirror();
    const context = vi.fn().mockImplementation(async (opts: { plugins?: ProbePlugin[] }) => {
      const onEnds: Array<(r: Record<string, unknown>) => unknown> = [];
      for (const p of opts.plugins ?? []) {
        await p.setup({
          initialOptions: opts as unknown as Record<string, unknown>,
          esbuild: rawBrowserLibSentinel,
          onEnd: (cb) => onEnds.push(cb),
        });
      }
      return {
        rebuild: async () => {
          const r: Record<string, unknown> = {
            errors: [],
            warnings: [],
            outputFiles: [outputFile('/deps/c.js', 'y')],
          };
          for (const cb of onEnds) await cb(r);
          return r;
        },
        watch: vi.fn(),
        serve: vi.fn(),
        cancel: vi.fn(),
        dispose: vi.fn(),
      };
    });
    const { lib } = fakeLib({ context } as unknown as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: () => fs });
    const observed: Record<string, unknown> = {};
    const probe: ProbePlugin = {
      name: 'probe',
      setup(b) {
        b.onEnd((r) => {
          observed.fileOnDisk = fs.existsSync('/deps/c.js');
          observed.outputFiles = outputFilesShape(r);
        });
      },
    };

    const ctx = await host.context({
      entryPoints: ['a'],
      outdir: '/deps',
      plugins: [probe as never],
    });
    const result = await ctx.rebuild();
    // RENEGOTIATED (PR#125 r4): was `'outputFiles' in r === false` — native
    // shape is the own-undefined key (real esbuild 0.28.0 probe 2026-07-10).
    expect(observed).toEqual({ fileOnDisk: true, outputFiles: NATIVE_WRITTEN_SHAPE });
    expect(outputFilesShape(result)).toEqual(NATIVE_WRITTEN_SHAPE);
  });
});

// F1 (provenance-lie × result shape) — oracle: real esbuild 0.28.0 probed
// 2026-07-10: every write-effective result KEEPS `outputFiles` as an OWN
// ENUMERABLE key with value `undefined` (descriptor {writable, enumerable,
// configurable}); `'outputFiles' in result` is TRUE natively. Deleting or
// spread-dropping the key was caller/plugin-observable.
describe('createEsbuildHost — native outputFiles key shape (own enumerable undefined)', () => {
  it('pluginless build({write:true}): own-undefined key, never deleted', async () => {
    const fs = memoryMirror();
    const build = vi.fn().mockResolvedValue({
      errors: [],
      warnings: [],
      outputFiles: [outputFile('/out/a.js', 'x')],
    });
    const { lib } = fakeLib({ build } as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: () => fs });
    const result = await host.build({ entryPoints: ['a'], outdir: '/out' });
    expect(outputFilesShape(result)).toEqual(NATIVE_WRITTEN_SHAPE);
    expect(dec.decode(fs.readFileBytesSync('/out/a.js'))).toBe('x');
  });

  it('plugin build: user onEnd and the resolved result both see the own-undefined key', async () => {
    const fs = memoryMirror();
    const build = pluginRunningBuild(() => ({
      errors: [],
      warnings: [],
      outputFiles: [outputFile('/out/a.js', 'x')],
    }));
    const { lib } = fakeLib({ build } as unknown as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: () => fs });
    let onEndShape: unknown;
    const probe: ProbePlugin = {
      name: 'probe',
      setup(b) {
        b.onEnd((r) => {
          onEndShape = outputFilesShape(r);
        });
      },
    };
    const result = await host.build({
      entryPoints: ['a'],
      outdir: '/out',
      plugins: [probe as never],
    });
    expect(onEndShape).toEqual(NATIVE_WRITTEN_SHAPE);
    expect(outputFilesShape(result)).toEqual(NATIVE_WRITTEN_SHAPE);
  });

  it('context rebuild (pluginless): own-undefined key', async () => {
    const fs = memoryMirror();
    const rebuild = vi.fn().mockResolvedValue({
      errors: [],
      warnings: [],
      outputFiles: [outputFile('/deps/chunk.js', 'y')],
    });
    const context = vi.fn().mockResolvedValue({
      rebuild,
      watch: vi.fn(),
      serve: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(),
    });
    const { lib } = fakeLib({ context } as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: () => fs });
    const ctx = await host.context({ entryPoints: ['a'], outdir: '/deps' });
    const result = await ctx.rebuild();
    expect(outputFilesShape(result)).toEqual(NATIVE_WRITTEN_SHAPE);
  });
});

// F2 (provenance-lie × write honoring) — oracle: real esbuild 0.28.0 probed
// 2026-07-10 honors a plugin setup() mutation of initialOptions.write in BOTH
// directions: true→false ⇒ outputFiles array on the result + disk untouched;
// false→true ⇒ files written + own-undefined outputFiles.
describe('createEsbuildHost — plugin setup() write flips are honored', () => {
  const flipTo = (value: boolean): ProbePlugin => ({
    name: 'flip',
    setup(b) {
      b.initialOptions.write = value;
    },
  });

  it('build write:true flipped to false in setup: outputFiles stay in memory, VFS untouched', async () => {
    const fs = memoryMirror();
    const build = pluginRunningBuild(() => ({
      errors: [],
      warnings: [],
      outputFiles: [outputFile('/out/a.js', 'x')],
    }));
    const { lib } = fakeLib({ build } as unknown as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: () => fs });
    const result = await host.build({
      entryPoints: ['a'],
      outdir: '/out',
      write: true,
      plugins: [flipTo(false) as never],
    });
    expect(result.outputFiles).toHaveLength(1);
    expect(fs.existsSync('/out/a.js')).toBe(false);
  });

  it('build write:false flipped to true in setup: VFS written, own-undefined outputFiles', async () => {
    const fs = memoryMirror();
    const build = pluginRunningBuild(() => ({
      errors: [],
      warnings: [],
      outputFiles: [outputFile('/out/a.js', 'x')],
    }));
    const { lib } = fakeLib({ build } as unknown as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: () => fs });
    const result = await host.build({
      entryPoints: ['a'],
      outdir: '/out',
      write: false,
      plugins: [flipTo(true) as never],
    });
    expect(dec.decode(fs.readFileBytesSync('/out/a.js'))).toBe('x');
    expect(outputFilesShape(result)).toEqual(NATIVE_WRITTEN_SHAPE);
  });

  it('context write:true flipped to false in setup: rebuild keeps outputFiles, VFS untouched', async () => {
    const fs = memoryMirror();
    const { context } = pluginRunningContext(() => ({
      errors: [],
      warnings: [],
      outputFiles: [outputFile('/deps/c.js', 'y')],
    }));
    const { lib } = fakeLib({ context } as unknown as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: () => fs });
    const ctx = await host.context({
      entryPoints: ['a'],
      outdir: '/deps',
      write: true,
      plugins: [flipTo(false) as never],
    });
    const result = await ctx.rebuild();
    expect(result.outputFiles).toHaveLength(1);
    expect(fs.existsSync('/deps/c.js')).toBe(false);
  });

  it('context write:true flipped to false in setup: watch() delegates (effective write is false)', async () => {
    const { context, watch } = pluginRunningContext(() => ({
      errors: [],
      warnings: [],
      outputFiles: [],
    }));
    const { lib } = fakeLib({ context } as unknown as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: memoryMirror });
    const ctx = await host.context({
      entryPoints: ['a'],
      outdir: '/deps',
      write: true,
      plugins: [flipTo(false) as never],
    });
    await ctx.watch({ delay: 5 });
    expect(watch).toHaveBeenCalledWith({ delay: 5 });
  });
});

// F3 (provenance-lie × plugin surface) — oracle: real esbuild 0.28.0 probed
// 2026-07-10: pluginBuild.esbuild is a MODULE-shaped surface (key set pinned
// below; NOT identical to require('esbuild')). Leaking the raw esbuild-wasm
// lib bypassed write normalization, replaced the guest *Sync NotImplemented
// throws with browser-lib Errors, and let one plugin stop() the SHARED
// realm-wide service.
describe('createEsbuildHost — PluginBuild.esbuild masked to the bridge module view', () => {
  // Sorted own keys of real pluginBuild.esbuild (probe 2026-07-10, esbuild 0.28.0).
  const REAL_PLUGIN_ESBUILD_KEYS = [
    'analyzeMetafile',
    'analyzeMetafileSync',
    'build',
    'buildSync',
    'context',
    'default',
    'formatMessages',
    'formatMessagesSync',
    'initialize',
    'stop',
    'transform',
    'transformSync',
    'version',
  ];

  async function captureView(write?: boolean) {
    const fs = memoryMirror();
    const build = pluginRunningBuild(() => ({
      errors: [],
      warnings: [],
      outputFiles: [outputFile('/out/a.js', 'x')],
    }));
    const { lib } = fakeLib({ build } as unknown as Partial<EsbuildWasmLib>);
    const host = createEsbuildHost({ lib, wasmUrl: '/w', mirror: () => fs });
    let view: Record<string, unknown> | undefined;
    const cap: ProbePlugin = {
      name: 'cap',
      setup(b) {
        view = b.esbuild as Record<string, unknown>;
      },
    };
    await host.build({
      entryPoints: ['a'],
      outdir: '/out',
      ...(write === undefined ? {} : { write }),
      plugins: [cap as never],
    });
    if (view === undefined) throw new Error('plugin setup never ran');
    return { view, fs, lib };
  }

  it('is module-shaped over the host bridge, never the raw wasm lib (default-write build)', async () => {
    const { view, lib } = await captureView();
    expect(view).not.toBe(rawBrowserLibSentinel);
    expect(Reflect.ownKeys(view).map(String).sort()).toEqual(REAL_PLUGIN_ESBUILD_KEYS);
    expect(view.version).toBe(lib.version);
    expect(view.default).toBe(view);
  });

  it('is masked on write:false plugin builds too (the leak was mode-independent)', async () => {
    const { view } = await captureView(false);
    expect(view).not.toBe(rawBrowserLibSentinel);
    expect(Reflect.ownKeys(view).map(String).sort()).toEqual(REAL_PLUGIN_ESBUILD_KEYS);
  });

  it('view.build routes through the bridge write normalization (raw lib would leave the VFS empty)', async () => {
    const { view, fs } = await captureView();
    fs.rmSync('/out/a.js', { force: false });
    const nested = (await (view.build as (o: object) => Promise<object>)({
      entryPoints: ['b'],
      outdir: '/out',
    })) as Record<string, unknown>;
    expect(dec.decode(fs.readFileBytesSync('/out/a.js'))).toBe('x');
    expect(outputFilesShape(nested)).toEqual(NATIVE_WRITTEN_SHAPE);
  });

  it('*Sync entries + stop() keep guest-shim semantics (NotImplementedError; stop never kills the shared service)', async () => {
    const { view, lib } = await captureView();
    for (const name of [
      'transformSync',
      'buildSync',
      'formatMessagesSync',
      'analyzeMetafileSync',
    ]) {
      let err: unknown;
      try {
        (view[name] as () => unknown)();
      } catch (e) {
        err = e;
      }
      expect(err).toMatchObject({ name: 'NotImplementedError', feature: `esbuild.${name}` });
    }
    await (view.stop as () => Promise<void>)();
    // One consumer's stop() must never kill the SHARED realm service (guest
    // shim stop() parity — see SHIM_ESBUILD_BODY in tools/shadow-registry).
    expect(lib.stop).not.toHaveBeenCalled();
  });

  it('stays in lockstep with the guest shim export surface (executes the generated CJS shim)', async () => {
    const { internalsShims } = await import('@riftydev/shadow-registry');
    const cjsBody = internalsShims['@esbuild/wasi-preview1']?.files['lib/main.cjs'];
    if (cjsBody === undefined) {
      throw new Error('esbuild shim CJS body missing from shadow-registry internalsShims');
    }
    // Execute the generated shim string (template-literal shims break
    // silently — run the real artifact). The body touches the host bridge
    // only lazily, so bare module/exports suffice.
    const moduleRef: { exports: Record<string, unknown> } = { exports: {} };
    new Function('module', 'exports', cjsBody)(moduleRef, moduleRef.exports);
    // Guest CJS exports + the ESM `default` = the module surface the view mirrors.
    expect([...Object.keys(moduleRef.exports), 'default'].sort()).toEqual(REAL_PLUGIN_ESBUILD_KEYS);
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
