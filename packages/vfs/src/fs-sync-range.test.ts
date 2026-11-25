/**
 * ADR-0576 positional read: `readFileRangeSync` returns exactly the bytes of
 * its range from the store's authority, never the whole file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VfsError } from './errors.ts';
import type { FsSync } from './fs-sync.ts';
import { OpfsFsSync } from './opfs-sync.ts';
import { MemoryFsSync } from './sync-mirror.ts';

/** OPFS root whose disk never answers: the content cache is the only authority reachable. */
function unreachableDisk(): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: '',
    isSameEntry: () => Promise.resolve(false),
    getFileHandle: () => Promise.reject(new Error('disk not reached')),
    getDirectoryHandle: () => Promise.reject(new Error('disk not reached')),
    removeEntry: () => Promise.reject(new Error('disk not reached')),
    resolve: () => Promise.resolve([]),
    entries: () => {
      throw new Error('disk not reached');
    },
  } as unknown as FileSystemDirectoryHandle;
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as VfsError).code ?? (error as Error).name;
  }
  throw new Error('expected a throw');
}

const pattern = (size: number): Uint8Array =>
  Uint8Array.from({ length: size }, (_, index) => (index * 7) % 251);

const backends: ReadonlyArray<[string, () => FsSync]> = [
  ['MemoryFsSync', () => new MemoryFsSync()],
  ['OpfsFsSync', () => new OpfsFsSync(unreachableDisk())],
];

describe.each(backends)('%s readFileRangeSync (ADR-0576)', (_name, make) => {
  beforeEach(() => vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  it('returns exactly [position, min(size, position + length))', () => {
    const fs = make();
    const bytes = pattern(1000);
    fs.writeFileSync('/f.bin', bytes);
    expect(Array.from(fs.readFileRangeSync('/f.bin', 0, 10))).toEqual(
      Array.from(bytes.subarray(0, 10)),
    );
    expect(Array.from(fs.readFileRangeSync('/f.bin', 990, 64))).toEqual(
      Array.from(bytes.subarray(990)),
    );
    expect(fs.readFileRangeSync('/f.bin', 1000, 64).byteLength).toBe(0);
    expect(fs.readFileRangeSync('/f.bin', 5000, 64).byteLength).toBe(0);
    expect(fs.readFileRangeSync('/f.bin', 3, 0).byteLength).toBe(0);
  });

  it('serves the range as a view of its authority: no whole-file copy', () => {
    const fs = make();
    fs.writeFileSync('/big.bin', pattern(2 << 20));
    const whole = fs.readFileBytesSync('/big.bin');
    for (const position of [0, 65536, (2 << 20) - 10]) {
      const got = fs.readFileRangeSync('/big.bin', position, 65536);
      expect(got.buffer).toBe(whole.buffer);
      expect(got.byteOffset).toBe(whole.byteOffset + position);
      expect(got.byteLength).toBe(Math.min(65536, (2 << 20) - position));
    }
  });

  it('sees whole writes only: a later write replaces, an earlier result keeps its bytes', () => {
    const fs = make();
    fs.writeFileSync('/w.bin', new Uint8Array([1, 2, 3, 4]));
    const before = fs.readFileRangeSync('/w.bin', 1, 2).slice();
    fs.writeFileSync('/w.bin', new Uint8Array([9, 9]));
    expect(Array.from(before)).toEqual([2, 3]);
    expect(Array.from(fs.readFileRangeSync('/w.bin', 1, 2))).toEqual([9]);
    expect(fs.readFileRangeSync('/w.bin', 2, 2).byteLength).toBe(0);
  });

  it('errors as readFileBytesSync does', () => {
    const fs = make();
    fs.mkdirSync('/dir', { recursive: true });
    fs.writeFileSync('/file', new Uint8Array([1]));
    expect(code(() => fs.readFileRangeSync('/missing', 0, 1))).toBe('ENOENT');
    expect(code(() => fs.readFileRangeSync('/dir', 0, 1))).toBe('EISDIR');
    expect(code(() => fs.readFileRangeSync('/file/child', 0, 1))).toBe('ENOTDIR');
  });

  it.each([
    [-1, 1],
    [0.5, 1],
    [Number.NaN, 1],
    [Number.MAX_SAFE_INTEGER + 1, 1],
    [0, -1],
    [0, 1.5],
  ])('rejects position %s length %s with a TypeError', (position, length) => {
    const fs = make();
    fs.writeFileSync('/f', new Uint8Array([1, 2]));
    expect(() => fs.readFileRangeSync('/f', position, length)).toThrow(TypeError);
  });
});

describe('OpfsFsSync readFileRangeSync reads its content cache, not the disk', () => {
  beforeEach(() => vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  it('serves a write before its write-through reached the disk', () => {
    const fs = new OpfsFsSync(unreachableDisk());
    fs.writeFileSync('/fresh.bin', new Uint8Array([5, 6, 7]));
    expect(Array.from(fs.readFileRangeSync('/fresh.bin', 1, 8))).toEqual([6, 7]);
  });
});
