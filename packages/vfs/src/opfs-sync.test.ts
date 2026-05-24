import { NotImplementedError } from '@rifty/io';
/**
 * Unit tests for `OpfsFsSync` (ADR-0013).
 *
 * The Node test env has no `FileSystemSyncAccessHandle` and no Worker
 * scope, so the only thing we can exercise here is the realm gate. The
 * round-trip behaviour (read your writes, persistence across reload) is
 * checked in browser e2e (Playwright + Worker) — those cases are marked
 * `.skip` below with the explicit reason.
 */
import { describe, expect, it } from 'vitest';
import { OpfsFsSync } from './opfs-sync.ts';

describe('OpfsFsSync (Node test env)', () => {
  it('isSupported() is false outside a Worker realm with createSyncAccessHandle', () => {
    expect(OpfsFsSync.isSupported()).toBe(false);
  });

  it('constructor throws NotImplementedError outside a Worker realm', () => {
    const fakeRoot = {} as unknown as FileSystemDirectoryHandle;
    expect(() => new OpfsFsSync(fakeRoot)).toThrow(NotImplementedError);
    expect(() => new OpfsFsSync(fakeRoot)).toThrow(
      /sync OPFS only available inside a Web Worker realm/,
    );
  });

  it('init() rejects with NotImplementedError outside a Worker realm', async () => {
    await expect(OpfsFsSync.init()).rejects.toThrow(NotImplementedError);
  });

  // Round-trip OPFS behaviour requires a browser Worker context with
  // `FileSystemSyncAccessHandle`. Covered by Playwright e2e in M11
  // follow-up; impossible to fake in Node without writing a stub that
  // would mask real bugs.
  it.skip('reads its own writes through a sync access handle (browser Worker only)', () => {});

  it.skip('directory ops throw NotImplementedError with the documented hint', () => {
    // In a real Worker we still expect:
    //   readdirSync / mkdirSync / rmSync → NotImplementedError
    //     ('OpfsFsSync.<method>',
    //      'directory ops require an async bootstrap; use OpfsVfs for those')
    // Covered indirectly by code review until the e2e harness exists.
  });
});
