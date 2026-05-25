import { MemoryVfs, joinPath } from '@rifty/vfs';
import { describe, expect, it } from 'vitest';
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
