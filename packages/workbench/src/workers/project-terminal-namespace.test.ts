import {
  type FsSync,
  VfsError,
  type VfsMutationGuard,
  type VfsMutationIntent,
} from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import { createProjectTerminalNamespace } from './project-terminal-namespace.ts';

const ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const GUESSED_PHYSICAL_ROOT = '/projects/project-files';
const enc = new TextEncoder();
const dec = new TextDecoder();

function bytes(text: string): Uint8Array {
  return enc.encode(text);
}

function text(value: Uint8Array): string {
  return dec.decode(value);
}

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to throw');
}

function expectPublicDiagnostic(error: unknown): void {
  expect(String(error)).not.toContain(ROOT);
  if (error instanceof VfsError) expect(error.path).not.toContain(ROOT);
  if (error instanceof AggregateError) {
    for (const entry of error.errors as readonly unknown[]) expectPublicDiagnostic(entry);
  }
  if (error instanceof Error) {
    const details = error as Error & { readonly path?: unknown };
    if (typeof details.path === 'string') expect(details.path).not.toContain(ROOT);
  }
}

function seededProject() {
  const { fsSync } = createMemoryFs();
  fsSync.mkdirSync(ROOT, { recursive: true });
  fsSync.writeFileSync(`${ROOT}/keep.txt`, bytes('project bytes'));
  return fsSync;
}

function trackedApplyingGuard(): {
  readonly calls: ReturnType<typeof vi.fn>;
  readonly guard: VfsMutationGuard;
} {
  const calls = vi.fn();
  return {
    calls,
    guard: <T>(intents: readonly VfsMutationIntent[], apply: () => T | Promise<T>) => {
      calls(intents, apply);
      return apply();
    },
  };
}

describe('project terminal namespace', () => {
  it('maps the complete FsSync operation matrix beneath one project root', () => {
    const fsSync = seededProject();
    fsSync.mkdirSync('/src', { recursive: true });
    fsSync.writeFileSync('/src/input.txt', bytes('outside input'));
    fsSync.writeFileSync('/src/remove.txt', bytes('outside remove'));
    fsSync.writeFileSync('/src/renamed.txt', bytes('outside rename target'));
    fsSync.writeFileSync('/global-only.txt', bytes('outside only'));
    fsSync.utimes('/src/input.txt', 777, 777);
    const namespace = createProjectTerminalNamespace({ projectRoot: ROOT, fileSystem: fsSync });
    const projectFs = namespace.fileSystem;

    projectFs.mkdirSync('/src', { recursive: true });
    projectFs.mkdirSync('/src/nested', { recursive: false });
    projectFs.writeFileSync('/src/input.txt', bytes('inside input'));
    projectFs.writeFileSync('/src/remove.txt', bytes('inside remove'));

    expect(projectFs.existsSync('/src/input.txt')).toBe(true);
    expect(projectFs.existsSync('/global-only.txt')).toBe(false);
    expect(projectFs.statSync('/src/input.txt')).toMatchObject({ isFile: true, size: 12 });
    expect(projectFs.statSyncOrNull('/src/nested')).toMatchObject({ isDirectory: true });
    expect(projectFs.statSyncOrNull('/missing')).toBeNull();
    expect(text(projectFs.readFileBytesSync('/src/input.txt'))).toBe('inside input');
    expect(projectFs.readdirSync('/src').map((entry) => entry.name)).toEqual([
      'input.txt',
      'nested',
      'remove.txt',
    ]);

    projectFs.utimes('/src/input.txt', 222, 222);
    projectFs.copyFileSync('/src/input.txt', '/src/copied.txt');
    projectFs.cpSync('/src', '/tree-copy', { recursive: true });
    projectFs.renameSync('/src/copied.txt', '/src/renamed.txt');
    projectFs.rmSync('/src/remove.txt', {});

    expect(fsSync.statSync(`${ROOT}/src/input.txt`).mtime).toBe(222);
    expect(text(fsSync.readFileBytesSync(`${ROOT}/src/renamed.txt`))).toBe('inside input');
    expect(text(fsSync.readFileBytesSync(`${ROOT}/tree-copy/copied.txt`))).toBe('inside input');
    expect(fsSync.existsSync(`${ROOT}/src/remove.txt`)).toBe(false);
    expect(fsSync.existsSync('/tree-copy')).toBe(false);
    expect(fsSync.statSync('/src/input.txt').mtime).toBe(777);
    expect(text(fsSync.readFileBytesSync('/src/remove.txt'))).toBe('outside remove');
    expect(text(fsSync.readFileBytesSync('/src/renamed.txt'))).toBe('outside rename target');
  });

  it('clamps .. at public root and treats a guessed absolute root as an ordinary project path', () => {
    const fsSync = seededProject();
    fsSync.mkdirSync(`${GUESSED_PHYSICAL_ROOT}/src`, { recursive: true });
    fsSync.writeFileSync(`${GUESSED_PHYSICAL_ROOT}/src/main.js`, bytes('outside guess'));
    fsSync.writeFileSync('/escape.txt', bytes('outside escape'));
    const namespace = createProjectTerminalNamespace({ projectRoot: ROOT, fileSystem: fsSync });

    namespace.fileSystem.writeFileSync('/../../escape.txt', bytes('inside clamp'));
    namespace.fileSystem.mkdirSync(`${GUESSED_PHYSICAL_ROOT}/src`, { recursive: true });
    namespace.fileSystem.writeFileSync(
      `${GUESSED_PHYSICAL_ROOT}/src/main.js`,
      bytes('inside guess'),
    );

    expect(namespace.toOwnerPath('/a/../../../escape.txt')).toBe(`${ROOT}/escape.txt`);
    expect(text(fsSync.readFileBytesSync(`${ROOT}/escape.txt`))).toBe('inside clamp');
    expect(text(fsSync.readFileBytesSync('/escape.txt'))).toBe('outside escape');
    expect(text(fsSync.readFileBytesSync(`${ROOT}${GUESSED_PHYSICAL_ROOT}/src/main.js`))).toBe(
      'inside guess',
    );
    expect(text(fsSync.readFileBytesSync(`${GUESSED_PHYSICAL_ROOT}/src/main.js`))).toBe(
      'outside guess',
    );
  });

  const reservedOperations: readonly [string, (fileSystem: FsSync) => unknown][] = [
    ['exists', (fileSystem) => fileSystem.existsSync('/.rifty')],
    ['stat', (fileSystem) => fileSystem.statSync('/.rifty')],
    ['stat-or-null', (fileSystem) => fileSystem.statSyncOrNull('/.rifty')],
    ['read', (fileSystem) => fileSystem.readFileBytesSync('/.rifty/owner.json')],
    ['readdir', (fileSystem) => fileSystem.readdirSync('/.rifty')],
    ['write', (fileSystem) => fileSystem.writeFileSync('/.rifty/owner.json', bytes('changed'))],
    ['mkdir', (fileSystem) => fileSystem.mkdirSync('/.rifty/new', { recursive: true })],
    ['rm', (fileSystem) => fileSystem.rmSync('/.rifty', { recursive: true })],
    ['utimes', (fileSystem) => fileSystem.utimes('/.rifty', 1, 1)],
    ['copy source', (fileSystem) => fileSystem.copyFileSync('/.rifty/owner.json', '/copy')],
    ['copy target', (fileSystem) => fileSystem.copyFileSync('/keep.txt', '/.rifty/copy')],
    ['cp source', (fileSystem) => fileSystem.cpSync('/.rifty', '/copy', { recursive: true })],
    [
      'cp target',
      (fileSystem) => fileSystem.cpSync('/keep.txt', '/.rifty/copy', { recursive: true }),
    ],
    ['rename source', (fileSystem) => fileSystem.renameSync('/.rifty/owner.json', '/moved')],
    ['rename target', (fileSystem) => fileSystem.renameSync('/keep.txt', '/.rifty/moved')],
  ];

  it.each(reservedOperations)('rejects top-level owner metadata through %s', (_, operation) => {
    const fsSync = seededProject();
    const namespace = createProjectTerminalNamespace({ projectRoot: ROOT, fileSystem: fsSync });

    const error = thrown(() => operation(namespace.fileSystem));

    expect(error).toMatchObject({ name: 'TypeError' });
    expect(String(error)).toMatch(/invalid project path/i);
    expectPublicDiagnostic(error);
    expect(text(fsSync.readFileBytesSync(`${ROOT}/keep.txt`))).toBe('project bytes');
    expect(fsSync.existsSync(ROOT)).toBe(true);
  });

  it('keeps missing-path diagnostics in the public namespace', () => {
    const fsSync = seededProject();
    const namespace = createProjectTerminalNamespace({ projectRoot: ROOT, fileSystem: fsSync });

    const error = thrown(() => namespace.fileSystem.readFileBytesSync('/missing.txt'));

    expect(error).toBeInstanceOf(VfsError);
    expect(error).toMatchObject({ code: 'ENOENT', path: '/missing.txt' });
    expect(String(error)).toContain('ENOENT: /missing.txt');
    expectPublicDiagnostic(error);
  });

  it('maps shell mutation policy and npm context to the same owner paths', async () => {
    const fsSync = seededProject();
    const { calls: guardCalls, guard } = trackedApplyingGuard();
    const assertPortablePaths = vi.fn();
    const namespace = createProjectTerminalNamespace({
      projectRoot: ROOT,
      fileSystem: fsSync,
      mutationGuard: guard,
      assertPortablePaths,
    });

    await namespace.mutationGuard?.(
      [
        { kind: 'write', path: '/src/out.js' },
        { kind: 'rename', sourcePath: '/a', targetPath: '/b' },
      ],
      () => undefined,
    );
    namespace.assertPortablePaths?.(['/src/out.js']);
    const sink = { write: () => {} };
    const owner = namespace.toOwnerContext({
      cwd: '/src',
      env: {},
      stdout: sink,
      stderr: sink,
      fileSystem: namespace.fileSystem,
      mutationGuard: namespace.mutationGuard,
      assertPortablePaths: namespace.assertPortablePaths,
    });

    expect(guardCalls).toHaveBeenCalledWith(
      [
        { kind: 'write', path: `${ROOT}/src/out.js` },
        { kind: 'rename', sourcePath: `${ROOT}/a`, targetPath: `${ROOT}/b` },
      ],
      expect.any(Function),
    );
    expect(assertPortablePaths).toHaveBeenCalledWith([`${ROOT}/src/out.js`]);
    expect(owner.cwd).toBe(`${ROOT}/src`);
    expect(owner.fileSystem).toBe(fsSync);
    expect(owner.mutationGuard).toBe(guard);
  });

  const rawRootOperations: readonly [
    string,
    (fileSystem: FsSync) => ReturnType<typeof vi.spyOn>,
    (fileSystem: FsSync) => unknown,
  ][] = [
    [
      'write',
      (fileSystem) => vi.spyOn(fileSystem, 'writeFileSync'),
      (fileSystem) => fileSystem.writeFileSync('/', bytes('replacement')),
    ],
    [
      'mkdir',
      (fileSystem) => vi.spyOn(fileSystem, 'mkdirSync'),
      (fileSystem) => fileSystem.mkdirSync('/', { recursive: false }),
    ],
    [
      'rm',
      (fileSystem) => vi.spyOn(fileSystem, 'rmSync'),
      (fileSystem) => fileSystem.rmSync('/', { recursive: true }),
    ],
    [
      'copy source',
      (fileSystem) => vi.spyOn(fileSystem, 'copyFileSync'),
      (fileSystem) => fileSystem.copyFileSync('/', '/copy'),
    ],
    [
      'copy target',
      (fileSystem) => vi.spyOn(fileSystem, 'copyFileSync'),
      (fileSystem) => fileSystem.copyFileSync('/keep.txt', '/'),
    ],
    [
      'cp source',
      (fileSystem) => vi.spyOn(fileSystem, 'cpSync'),
      (fileSystem) => fileSystem.cpSync('/', '/copy', { recursive: true }),
    ],
    [
      'cp target',
      (fileSystem) => vi.spyOn(fileSystem, 'cpSync'),
      (fileSystem) => fileSystem.cpSync('/keep.txt', '/', { recursive: true }),
    ],
    [
      'rename source',
      (fileSystem) => vi.spyOn(fileSystem, 'renameSync'),
      (fileSystem) => fileSystem.renameSync('/', '/moved'),
    ],
    [
      'rename target',
      (fileSystem) => vi.spyOn(fileSystem, 'renameSync'),
      (fileSystem) => fileSystem.renameSync('/keep.txt', '/'),
    ],
  ];

  it.each(rawRootOperations)(
    'rejects raw project-root %s before the inner filesystem',
    (_, observe, operation) => {
      const fsSync = seededProject();
      const innerCall = observe(fsSync);
      const namespace = createProjectTerminalNamespace({ projectRoot: ROOT, fileSystem: fsSync });

      const error = thrown(() => operation(namespace.fileSystem));

      expect(error).toBeInstanceOf(VfsError);
      expectPublicDiagnostic(error);
      expect(innerCall).not.toHaveBeenCalled();
      expect(text(fsSync.readFileBytesSync(`${ROOT}/keep.txt`))).toBe('project bytes');
      expect(fsSync.statSync(ROOT).isDirectory).toBe(true);
    },
  );

  const guardedRootIntents: readonly [string, readonly VfsMutationIntent[], string][] = [
    ['write', [{ kind: 'write', path: '/' }], 'EISDIR'],
    ['rm', [{ kind: 'rm', path: '/' }], 'EPERM'],
    ['rename source', [{ kind: 'rename', sourcePath: '/', targetPath: '/moved' }], 'EPERM'],
    ['rename target', [{ kind: 'rename', sourcePath: '/keep.txt', targetPath: '/' }], 'EPERM'],
    ['copy source', [{ kind: 'copy', sourcePath: '/', targetPath: '/copy' }], 'EPERM'],
    ['copy target', [{ kind: 'copy', sourcePath: '/keep.txt', targetPath: '/' }], 'EPERM'],
  ];

  it.each(guardedRootIntents)(
    'rejects guarded project-root %s before owner policy and apply',
    (_, intents, code) => {
      const fsSync = seededProject();
      const apply = vi.fn(() => fsSync.writeFileSync(`${ROOT}/keep.txt`, bytes('changed')));
      const { calls: guardCalls, guard } = trackedApplyingGuard();
      const namespace = createProjectTerminalNamespace({
        projectRoot: ROOT,
        fileSystem: fsSync,
        mutationGuard: guard,
      });

      const error = thrown(() => namespace.mutationGuard?.(intents, apply));

      expect(error).toMatchObject({ code, path: '/' });
      expectPublicDiagnostic(error);
      expect(guardCalls).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
      expect(text(fsSync.readFileBytesSync(`${ROOT}/keep.txt`))).toBe('project bytes');
      expect(fsSync.statSync(ROOT).isDirectory).toBe(true);
    },
  );

  it('maps a logical root-replacement transaction to the owner guard', async () => {
    const fsSync = seededProject();
    const apply = vi.fn(() => fsSync.writeFileSync(`${ROOT}/keep.txt`, bytes('changed')));
    const { calls: guardCalls, guard } = trackedApplyingGuard();
    const namespace = createProjectTerminalNamespace({
      projectRoot: ROOT,
      fileSystem: fsSync,
      mutationGuard: guard,
    });

    await namespace.mutationGuard?.([{ kind: 'replace', path: '/' }], apply);

    expect(guardCalls).toHaveBeenCalledWith(
      [{ kind: 'replace', path: ROOT }],
      expect.any(Function),
    );
    expect(apply).toHaveBeenCalledOnce();
    expect(text(fsSync.readFileBytesSync(`${ROOT}/keep.txt`))).toBe('changed');
    expect(fsSync.statSync(ROOT).isDirectory).toBe(true);
  });

  it('removes owner roots from VfsError, generic Error, and AggregateError diagnostics', () => {
    const fsSync = seededProject();
    const namespace = createProjectTerminalNamespace({ projectRoot: ROOT, fileSystem: fsSync });
    const ownerVfsError = new VfsError(
      'ENOENT',
      `${ROOT}/vfs.txt`,
      `ENOENT while reading ${ROOT}/vfs.txt`,
    );
    const ownerGenericError = Object.assign(new Error(`failed at ${ROOT}/generic.txt`), {
      code: 'EIO',
      path: `${ROOT}/generic.txt`,
    });
    const ownerAggregateError = new AggregateError(
      [ownerVfsError, ownerGenericError],
      `multiple failures below ${ROOT}`,
    );

    const vfsError = thrown(() => namespace.rethrowOwnerError(ownerVfsError));
    const genericError = thrown(() => namespace.rethrowOwnerError(ownerGenericError));
    const aggregateError = thrown(() => namespace.rethrowOwnerError(ownerAggregateError));

    expect(vfsError).toMatchObject({ code: 'ENOENT', path: '/vfs.txt' });
    expect(genericError).toMatchObject({ code: 'EIO', path: '/generic.txt' });
    expect(aggregateError).toBeInstanceOf(AggregateError);
    expectPublicDiagnostic(vfsError);
    expectPublicDiagnostic(genericError);
    expectPublicDiagnostic(aggregateError);
  });

  it('removes owner roots from child stdout and stderr diagnostics', () => {
    const fsSync = seededProject();
    const stdout: Array<string | Uint8Array> = [];
    const stderr: Array<string | Uint8Array> = [];
    const namespace = createProjectTerminalNamespace({ projectRoot: ROOT, fileSystem: fsSync });
    const owner = namespace.toOwnerContext({
      cwd: '/',
      env: {},
      stdout: { write: (chunk) => stdout.push(chunk) },
      stderr: { write: (chunk) => stderr.push(chunk) },
      fileSystem: namespace.fileSystem,
    });

    owner.stdout.write(`compiled ${ROOT}/src/main.js`);
    owner.stderr.write(`failed ${ROOT}/src/broken.js`);

    expect(stdout).toEqual(['compiled /src/main.js']);
    expect(stderr).toEqual(['failed /src/broken.js']);
    expect(String(stdout[0])).not.toContain(ROOT);
    expect(String(stderr[0])).not.toContain(ROOT);
  });
});
