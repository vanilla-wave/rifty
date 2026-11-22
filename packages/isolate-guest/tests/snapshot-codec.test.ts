/**
 * Format v1 and its reader over hostile bytes (ADR-0567 §1–§7, goal
 * `isolate-host-fs-snapshot` I1–I5), in the consumer's Node realm over rifty
 * `MemoryFs`. `encode` below is an independent writer of the ADR's byte layout
 * (CRC from `node:zlib`): it pins the format and forges blobs a correct writer
 * never makes. RED until the codec lands (`red` = `it.fails`), then plain `it`.
 */
import { crc32 } from 'node:zlib';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import {
  FsSnapshotError,
  type SnapshotOptions,
  type SnapshotTemplate,
  restoreFs,
  snapshotFs,
} from '../src/index.ts';
import { listFs } from './snapshot-support.ts';

const red = it.fails;

interface Rec {
  kind: number;
  path: string;
  times?: readonly [number, number, number, number];
  bytes?: Uint8Array;
  size?: number;
}

const OPTIONS: SnapshotOptions = { template: null, maxBytes: 1 << 24 };
const MAGIC = [0x52, 0x49, 0x46, 0x54, 0x59, 0x46, 0x53, 0x00];

/** ADR-0567 §1, written by hand. `tail` lands between `end` and the CRC. */
function encode(
  recs: readonly Rec[],
  {
    template = null,
    version = 1,
    tail = [],
    crc,
  }: {
    template?: SnapshotTemplate | null;
    version?: number;
    tail?: readonly number[];
    crc?: number;
  } = {},
): Uint8Array {
  const out: number[] = [...MAGIC];
  const u8 = (v: number) => out.push(v & 0xff);
  const u16 = (v: number) => out.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0);
    out.push(...b);
  };
  const f64 = (v: number) => {
    const b = Buffer.alloc(8);
    b.writeDoubleLE(v);
    out.push(...b);
  };
  const units = (s: string) => {
    for (let i = 0; i < s.length; i++) u16(s.charCodeAt(i));
  };
  u32(version);
  if (template === null) u8(0);
  else {
    u8(1);
    u16(template.id.length);
    units(template.id);
    u16(template.version.length);
    units(template.version);
  }
  for (const r of recs) {
    u8(r.kind);
    u32(r.path.length);
    units(r.path);
    for (const t of r.times ?? [10, 20, 30, 40]) f64(t);
    if (r.kind === 2) {
      const bytes = r.bytes ?? new Uint8Array(0);
      f64(r.size ?? bytes.length);
      out.push(...bytes);
    }
  }
  u8(0);
  out.push(...tail);
  const body = Buffer.from(out);
  const sum = Buffer.alloc(4);
  sum.writeUInt32LE(crc ?? crc32(body));
  return new Uint8Array(Buffer.concat([body, sum]));
}

const root: Rec = { kind: 1, path: '/' };
const dir = (path: string): Rec => ({ kind: 1, path });
const file = (path: string, text = ''): Rec => ({
  kind: 2,
  path,
  bytes: new Uint8Array(Buffer.from(text)),
});

/** A target with content of its own, to prove a refusal leaves it untouched. */
function target() {
  const fs = createMemoryFs().fsSync;
  fs.mkdirSync('/workspace/keep', { recursive: true });
  fs.writeFileSync('/workspace/keep/a.txt', new Uint8Array([7, 8]));
  return fs;
}

/** `bytes` is refused with `code`, the message carries no blob text, the target is unchanged. */
function refused(bytes: Uint8Array, code: string, options: SnapshotOptions = OPTIONS): void {
  const fs = target();
  const before = listFs(fs);
  let caught: unknown;
  try {
    restoreFs(fs, bytes, options);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(FsSnapshotError);
  const error = caught as FsSnapshotError;
  expect(error.code).toBe(code);
  expect(error.message).toMatch(new RegExp(`^${code}: [ -~]+$`));
  expect(error.message).not.toContain('SECRET');
  expect(listFs(fs)).toEqual(before);
}

describe('format v1 layout (ADR-0567 §1, §2)', () => {
  red(
    'a tree writes exactly the ADR bytes: root first, pre-order, code-unit order, full stat',
    () => {
      const fs = createMemoryFs().fsSync;
      fs.mkdirSync('/b', { recursive: false });
      fs.writeFileSync('/a', new Uint8Array([1, 2, 3]));
      fs.writeFileSync('/b/\uD800', new Uint8Array(0));
      const template = { id: 'tpl', version: 'v1' };
      const rec = (path: string): Rec => {
        const s = fs.statSync(path);
        const times = [s.mtime, s.atime, s.metadata?.ctime, s.metadata?.birthtime] as [
          number,
          number,
          number,
          number,
        ];
        return s.isDirectory
          ? { kind: 1, path, times }
          : { kind: 2, path, times, bytes: fs.readFileBytesSync(path) };
      };
      const expected = encode([rec('/'), rec('/a'), rec('/b'), rec('/b/\uD800')], { template });
      expect(Buffer.from(snapshotFs(fs, { template, maxBytes: 1 << 20 })).toString('hex')).toBe(
        Buffer.from(expected).toString('hex'),
      );
    },
  );

  red(
    'the same tree gives the same bytes, whatever the creation order; snapshot changes nothing (I5)',
    () => {
      const build = (order: readonly string[]) => {
        const fs = createMemoryFs().fsSync;
        for (const name of order) fs.writeFileSync(`/${name}`, new Uint8Array(Buffer.from(name)));
        for (const name of order)
          fs.restoreStatSync(`/${name}`, {
            mtimeMs: 1,
            atimeMs: 2,
            ctimeMs: 3,
            birthtimeMs: 4,
          });
        fs.restoreStatSync('/', { mtimeMs: 1, atimeMs: 2, ctimeMs: 3, birthtimeMs: 4 });
        return fs;
      };
      const one = build(['b', 'a', 'é', 'B']);
      const two = build(['é', 'B', 'a', 'b']);
      const before = listFs(one);
      const first = snapshotFs(one, OPTIONS);
      expect(listFs(one)).toEqual(before);
      // Only content and stat decide: `ino` is not in the format, times are set alike.
      expect(Buffer.from(snapshotFs(one, OPTIONS)).equals(Buffer.from(first))).toBe(true);
      expect(Buffer.from(snapshotFs(two, OPTIONS)).equals(Buffer.from(first))).toBe(true);
    },
  );

  red(
    'restore replaces the whole target with exactly the snapshot tree, stat included (I1)',
    () => {
      const source = createMemoryFs().fsSync;
      source.mkdirSync('/workspace/empty', { recursive: true });
      source.writeFileSync(
        '/workspace/bin',
        new Uint8Array(Array.from({ length: 256 }, (_, i) => i)),
      );
      source.utimes('/workspace/bin', 1.5, 2.25);
      const fs = target();
      restoreFs(fs, snapshotFs(source, OPTIONS), OPTIONS);
      expect(listFs(fs)).toEqual(listFs(source));
    },
  );

  red('100 000 siblings round-trip: no quadratic pass over a directory (I3)', () => {
    const wide = createMemoryFs().fsSync;
    for (let i = 0; i < 100_000; i++) wide.writeFileSync(`/f${i}`, new Uint8Array(0));
    const options = { template: null, maxBytes: 1 << 30 };
    const bytes = snapshotFs(wide, options);
    const back = createMemoryFs().fsSync;
    restoreFs(back, bytes, options);
    expect(Buffer.from(snapshotFs(back, options)).equals(Buffer.from(bytes))).toBe(true);
  });
});

describe('limits (ADR-0567 §7, I4)', () => {
  red(
    'snapshot: a blob of exactly maxBytes passes, one byte less is refused before allocating',
    () => {
      const fs = createMemoryFs().fsSync;
      fs.writeFileSync('/big', new Uint8Array(10_000));
      const size = snapshotFs(fs, OPTIONS).length;
      expect(snapshotFs(fs, { template: null, maxBytes: size }).length).toBe(size);
      expect(() => snapshotFs(fs, { template: null, maxBytes: size - 1 })).toThrow(
        /^ERR_FS_SNAPSHOT_TOO_LARGE: /,
      );
    },
  );

  red('restore: length over maxBytes is refused first, even for garbage', () => {
    refused(new Uint8Array(100).fill(0x41), 'ERR_FS_SNAPSHOT_TOO_LARGE', {
      template: null,
      maxBytes: 99,
    });
  });

  red('a claimed file size past the bytes present is refused, not allocated', () => {
    const bytes = encode([root, { kind: 2, path: '/f', size: 2 ** 50 }]);
    refused(bytes, 'ERR_FS_SNAPSHOT_CORRUPT');
  });

  red('invalid options are TypeErrors', () => {
    const fs = createMemoryFs().fsSync;
    for (const options of [
      { template: null, maxBytes: 0 },
      { template: null, maxBytes: 1.5 },
      { template: null, maxBytes: Number.NaN },
      { template: { id: 1, version: 'v' } },
      { template: { id: '', version: 'v' }, maxBytes: 10 },
      { template: { id: 'x'.repeat(65_536), version: 'v' }, maxBytes: 10 },
      { maxBytes: 10 },
    ] as unknown as SnapshotOptions[]) {
      expect(() => snapshotFs(fs, options)).toThrow(TypeError);
      expect(() => restoreFs(fs, new Uint8Array(0), options)).toThrow(TypeError);
    }
  });
});

describe('hostile bytes (ADR-0567 §5, I2, I3)', () => {
  const valid = () => encode([root, dir('/w'), file('/w/a', 'SECRET-a')]);

  red('every truncation is refused', () => {
    const bytes = valid();
    for (let n = 0; n < bytes.length; n++) refused(bytes.subarray(0, n), 'ERR_FS_SNAPSHOT_CORRUPT');
  });

  red('every flipped bit is refused; in the version field as a version', () => {
    const bytes = valid();
    for (let i = 0; i < bytes.length; i++) {
      for (let bit = 0; bit < 8; bit++) {
        const copy = bytes.slice();
        copy[i] = (copy[i] as number) ^ (1 << bit);
        refused(copy, i >= 8 && i < 12 ? 'ERR_FS_SNAPSHOT_VERSION' : 'ERR_FS_SNAPSHOT_CORRUPT');
      }
    }
  });

  red('a wrong checksum, a foreign magic and an empty blob are corrupt', () => {
    refused(encode([root], { crc: 0 }), 'ERR_FS_SNAPSHOT_CORRUPT');
    const foreign = valid();
    foreign[0] = 0x50;
    refused(foreign, 'ERR_FS_SNAPSHOT_CORRUPT');
    refused(new Uint8Array(0), 'ERR_FS_SNAPSHOT_CORRUPT');
  });

  red('another format version names both numbers', () => {
    const fs = target();
    expect(() => restoreFs(fs, encode([root], { version: 2 }), OPTIONS)).toThrow(
      /^ERR_FS_SNAPSHOT_VERSION: .*\b2\b.*\b1\b/,
    );
    refused(encode([root], { version: 0 }), 'ERR_FS_SNAPSHOT_VERSION');
  });

  red('another template, none, or one where none was expected', () => {
    const t = { id: 'tpl', version: '1' };
    // The blob's own template is guest text: never echoed.
    const guestT = encode([root], { template: { id: 'SECRET-id', version: 'SECRET-v' } });
    refused(guestT, 'ERR_FS_SNAPSHOT_TEMPLATE');
    refused(guestT, 'ERR_FS_SNAPSHOT_TEMPLATE', { template: t, maxBytes: 1 << 20 });
    const withT = encode([root], { template: t });
    refused(withT, 'ERR_FS_SNAPSHOT_TEMPLATE');
    refused(withT, 'ERR_FS_SNAPSHOT_TEMPLATE', {
      template: { id: 'tpl', version: '2' },
      maxBytes: 1 << 20,
    });
    refused(withT, 'ERR_FS_SNAPSHOT_TEMPLATE', {
      template: { id: 'other', version: '1' },
      maxBytes: 1 << 20,
    });
    refused(encode([root]), 'ERR_FS_SNAPSHOT_TEMPLATE', { template: t, maxBytes: 1 << 20 });
    const fs = createMemoryFs().fsSync;
    restoreFs(fs, withT, { template: t, maxBytes: 1 << 20 });
  });

  const structural: readonly (readonly [string, readonly Rec[], (readonly number[])?])[] = [
    ['no root entry', [dir('/w')]],
    ['root as a file', [file('/')]],
    ['root twice', [root, dir('/')]],
    ['duplicate path', [root, file('/SECRET'), file('/SECRET')]],
    ['dir and file at one path', [root, dir('/x'), file('/x')]],
    ['relative path', [root, file('SECRET')]],
    ['.. segment', [root, dir('/w'), file('/w/../SECRET')]],
    ['. segment', [root, dir('/w'), file('/w/./SECRET')]],
    ['empty segment', [root, dir('/w'), file('/w//SECRET')]],
    ['trailing slash', [root, dir('/w/')]],
    ['NUL in a name', [root, file('/SECRET\0x')]],
    ['parent missing', [root, file('/nope/SECRET')]],
    ['parent is a file', [root, file('/f'), file('/f/SECRET')]],
    ['child before its parent', [root, file('/w/SECRET'), dir('/w')]],
    ['unknown kind (no symlinks in v1)', [root, { kind: 3, path: '/link' }]],
    ['NaN time', [root, { ...file('/a'), times: [Number.NaN, 0, 0, 0] }]],
    ['infinite time', [root, { ...file('/a'), times: [0, 0, Number.POSITIVE_INFINITY, 0] }]],
    ['size not an integer', [root, { ...file('/a', 'xy'), size: 1.5 }]],
    ['negative size', [root, { ...file('/a'), size: -1 }]],
    ['bytes after end', [root], [0x53, 0x45, 0x43]],
  ];
  for (const [label, recs, tail] of structural) {
    red(`${label} — refused, nothing written`, () => {
      refused(encode(recs, { tail }), 'ERR_FS_SNAPSHOT_CORRUPT');
    });
  }

  red('a path or template length past the end is refused', () => {
    const bytes = encode([root, file('/a')]);
    // Header 13 B, root record 1 + 4 + 2 + 32 = 39 B: the second path length is at 53.
    const view = new DataView(bytes.buffer);
    expect(bytes[52]).toBe(2);
    view.setUint32(53, 0x7fffffff, true);
    const body = bytes.subarray(0, bytes.length - 4);
    view.setUint32(bytes.length - 4, crc32(body), true);
    refused(bytes, 'ERR_FS_SNAPSHOT_CORRUPT');
    const t = { id: 'tpl', version: '1' };
    const withT = encode([root], { template: t });
    const tv = new DataView(withT.buffer);
    tv.setUint16(13, 0xffff, true);
    tv.setUint32(withT.length - 4, crc32(withT.subarray(0, withT.length - 4)), true);
    refused(withT, 'ERR_FS_SNAPSHOT_CORRUPT', { template: t, maxBytes: 1 << 20 });
  });
});
