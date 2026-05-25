import { NotImplementedError } from '@rifty/io';
import { MemoryVfs, joinPath } from '@rifty/vfs';
import { describe, expect, it } from 'vitest';
import { readExistingLockfile } from './installer-lockfile-reader.ts';
import { install } from './installer.ts';
import { RegistryClient } from './registry.ts';

/**
 * If `package-lock.json` exists but is not valid JSON, `install` previously
 * caught the parse error and silently fell back to a full live re-resolve.
 * That hides corruption from the operator. We now throw with `{ cause }`
 * carrying the original SyntaxError.
 */
describe('install — corrupt lockfile', () => {
  it('throws a clear error with cause when package-lock.json is unparseable', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(joinPath('/proj', 'package-lock.json'), '{not valid json');

    // Registry never gets hit because we should fail before that.
    const registry = new RegistryClient({
      baseUrl: '/never',
      fetch: async () => new Response('', { status: 599 }),
    });

    let caught: unknown;
    try {
      await install('root', '1.0.0', {}, { vfs, cwd: '/proj', registry });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error;
    expect(err.message).toContain('lockfile corrupt');
    expect(err.message).toContain('/proj/package-lock.json');
    // `cause` is the original JSON SyntaxError. Node typings expose it as unknown.
    expect((err as { cause?: unknown }).cause).toBeInstanceOf(Error);
  });
});

/**
 * lockfileVersion 1 (npm 5/6) and 2 (npm 7) use a different shape than v3
 * (npm 7+). Previously the reader silently returned `null` for those, which
 * caused `install` to do a full fresh resolve and overwrite the user's
 * lockfile with a v3. That's data loss disguised as caching. The reader now
 * throws `NotImplementedError('npm-client.lockfile.v{1,2}')` so the caller
 * sees the gap.
 */
describe('readExistingLockfile — legacy lockfileVersion', () => {
  it('throws NotImplementedError for lockfileVersion 1', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      joinPath('/proj', 'package-lock.json'),
      JSON.stringify({ name: 'root', version: '1.0.0', lockfileVersion: 1, dependencies: {} }),
    );

    let caught: unknown;
    try {
      await readExistingLockfile(vfs, '/proj');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NotImplementedError);
    const err = caught as NotImplementedError;
    expect(err.feature).toBe('npm-client.lockfile.v1');
  });

  it('throws NotImplementedError for lockfileVersion 2', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      joinPath('/proj', 'package-lock.json'),
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        lockfileVersion: 2,
        packages: {},
        dependencies: {},
      }),
    );

    let caught: unknown;
    try {
      await readExistingLockfile(vfs, '/proj');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NotImplementedError);
    const err = caught as NotImplementedError;
    expect(err.feature).toBe('npm-client.lockfile.v2');
  });

  it('propagates NotImplementedError through install()', async () => {
    const vfs = new MemoryVfs();
    await vfs.mkdir('/proj', { recursive: true });
    await vfs.writeFile(
      joinPath('/proj', 'package-lock.json'),
      JSON.stringify({ name: 'root', version: '1.0.0', lockfileVersion: 1, dependencies: {} }),
    );

    // Registry never gets hit; we should fail at the reader step.
    const registry = new RegistryClient({
      baseUrl: '/never',
      fetch: async () => new Response('', { status: 599 }),
    });

    let caught: unknown;
    try {
      await install('root', '1.0.0', {}, { vfs, cwd: '/proj', registry });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NotImplementedError);
    expect((caught as NotImplementedError).feature).toBe('npm-client.lockfile.v1');
  });
});
