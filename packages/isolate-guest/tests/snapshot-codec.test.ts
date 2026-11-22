/**
 * Format v1 and its reader over hostile bytes (ADR-0567 §1–§7, goal
 * `isolate-host-fs-snapshot` I1–I5), in the consumer's Node realm over rifty
 * `MemoryFs`. `encode` below is an independent writer of the ADR's byte layout
 * (CRC from `node:zlib`): it pins the format and forges blobs a correct writer
 * never makes.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
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

const carrier = it;

interface Rec {
  kind: number;
  path: string;
  times?: readonly [number, number, number, number];
  bytes?: Uint8Array;
  size?: number;
}

const OPTIONS: SnapshotOptions = { template: null, maxBytes: 1 << 24 };
/** Budget an entry takes from `maxBytes` beyond its bytes (ADR-0567 §7). */
const ENTRY_COST = 384;
/** The golden blob's tree (listFs form), fixed when the fixture was written. */
const GOLDEN_TREE = JSON.parse(
  readFileSync(new URL('./fixtures/snapshot-v1.json', import.meta.url), 'utf8'),
) as unknown;
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
  carrier(
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

  carrier(
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

  carrier(
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

  carrier('a restore changes nothing outside its target (I3)', () => {
    const other = createMemoryFs().fsSync;
    other.writeFileSync('/mine', new Uint8Array([9]));
    const before = listFs(other);
    const blob = encode([root, dir('/w'), file('/w/a', 'x'), file('/w/b', 'y')]);
    other.writeFileSync('/probe1', new Uint8Array(0));
    const first = other.statSync('/probe1').metadata?.ino as number;
    restoreFs(target(), blob, OPTIONS);
    other.writeFileSync('/probe2', new Uint8Array(0));
    // v1 carries no `ino`, so no blob value can reach the realm's counter by construction;
    // it moves only by the nodes created: target() 4 (its root too), restore 3, probe2 1.
    expect(other.statSync('/probe2').metadata?.ino).toBe(first + 8);
    other.rmSync('/probe1', {});
    other.rmSync('/probe2', {});
    expect(listFs(other).map(({ path, bytes }) => ({ path, bytes }))).toEqual(
      before.map(({ path, bytes }) => ({ path, bytes })),
    );
  });

  carrier('100 000 siblings round-trip: no quadratic pass over a directory (I3)', () => {
    const wide = createMemoryFs().fsSync;
    for (let i = 0; i < 100_000; i++) wide.writeFileSync(`/f${i}`, new Uint8Array(0));
    const options = { template: null, maxBytes: 1 << 30 };
    const bytes = snapshotFs(wide, options);
    const back = createMemoryFs().fsSync;
    restoreFs(back, bytes, options);
    expect(Buffer.from(snapshotFs(back, options)).equals(Buffer.from(bytes))).toBe(true);
  });
});

describe('long names (ADR-0567 §5, I3)', () => {
  carrier('restore: a blob name of 16 383 code units is accepted, 16 384 refused', () => {
    restoreFs(createMemoryFs().fsSync, encode([root, file(`/${'n'.repeat(16_383)}`)]), OPTIONS);
    refused(encode([root, file(`/${'n'.repeat(16_384)}`)]), 'ERR_FS_SNAPSHOT_CORRUPT');
  });

  carrier('a name of 16 383 code units round-trips; a longer one is refused at snapshot', () => {
    const fs = createMemoryFs().fsSync;
    fs.writeFileSync(`/${'n'.repeat(16_383)}`, new Uint8Array([1]));
    const back = createMemoryFs().fsSync;
    restoreFs(back, snapshotFs(fs, OPTIONS), OPTIONS);
    expect(listFs(back)).toEqual(listFs(fs));
    fs.writeFileSync(`/${'m'.repeat(16_384)}`, new Uint8Array([1]));
    expect(() => snapshotFs(fs, OPTIONS)).toThrow(/^ERR_FS_SNAPSHOT_UNREPRESENTABLE: /);
  });

  carrier('equal-length paths over 16 383 units decode in linear time (no hash flooding)', () => {
    // V8 hashes strings over 16 383 units by length only: a Map keyed by such
    // paths is quadratic. A linear reader doubles its time with the entries;
    // a quadratic one quadruples it (measured: 2000 entries 1.7 s, 4000 5.4 s).
    const deep = `/${'d'.repeat(16_380)}`;
    const blob = (n: number) =>
      encode([
        root,
        dir(deep),
        ...Array.from({ length: n }, (_, i) => file(`${deep}/f${String(i).padStart(4, '0')}`)),
      ]);
    const options = { template: null, maxBytes: 1 << 30 };
    const best = (bytes: Uint8Array) => {
      let ms = Number.POSITIVE_INFINITY;
      for (let r = 0; r < 3; r++) {
        const started = performance.now();
        restoreFs(createMemoryFs().fsSync, bytes, options);
        ms = Math.min(ms, performance.now() - started);
      }
      return ms;
    };
    const one = best(blob(1000));
    const two = best(blob(2000));
    expect(two / one).toBeLessThan(3);
  });
});

describe('the writer never emits what the reader refuses (ADR-0567 §5, I3)', () => {
  // States rifty's FS holds that the format cannot carry (Node never produces them:
  // NaN/huge times and NUL: aligned with Node by the sandbox goal, PR #419).
  const odd: readonly [string, (fs: ReturnType<typeof createMemoryFs>['fsSync']) => void][] = [
    ['NaN time', (fs) => fs.utimes('/a', Number.NaN, 1)],
    ['infinite time', (fs) => fs.utimes('/a', 1, Number.POSITIVE_INFINITY)],
    ['time 1e306', (fs) => fs.utimes('/a', 1e306, 1)],
    ['time past the Date range', (fs) => fs.utimes('/a', 1, 8.64e15 + 1)],
    ['NUL in a name', (fs) => fs.writeFileSync('/a\0b', new Uint8Array(0))],
    [
      'a name over 16 383 code units',
      (fs) => fs.writeFileSync(`/${'n'.repeat(16_384)}`, new Uint8Array(0)),
    ],
    ['the Date range edge', (fs) => fs.utimes('/a', -8.64e15, 8.64e15)],
    [
      'negative zero and sub-ms times',
      (fs) =>
        fs.restoreStatSync('/a', { mtimeMs: -0, atimeMs: 1.25, ctimeMs: 0.5, birthtimeMs: -1.5 }),
    ],
  ];
  for (const [label, alter] of odd) {
    carrier(`${label}: snapshot refuses by name, or its blob restores`, () => {
      const fs = createMemoryFs().fsSync;
      fs.writeFileSync('/a', new Uint8Array([1]));
      alter(fs);
      let bytes: Uint8Array | undefined;
      try {
        bytes = snapshotFs(fs, OPTIONS);
      } catch (error) {
        expect(error).toBeInstanceOf(FsSnapshotError);
        expect((error as FsSnapshotError).code).toBe('ERR_FS_SNAPSHOT_UNREPRESENTABLE');
        return;
      }
      const back = createMemoryFs().fsSync;
      restoreFs(back, bytes, OPTIONS);
      expect(listFs(back)).toEqual(listFs(fs));
    });
  }

  carrier('the states the format cannot carry are refused, the edge ones restore', () => {
    const outcome = (alter: (fs: ReturnType<typeof createMemoryFs>['fsSync']) => void) => {
      const fs = createMemoryFs().fsSync;
      fs.writeFileSync('/a', new Uint8Array([1]));
      alter(fs);
      try {
        snapshotFs(fs, OPTIONS);
        return 'ok';
      } catch (error) {
        return (error as FsSnapshotError).code;
      }
    };
    expect(odd.map(([label, alter]) => [label, outcome(alter)])).toEqual([
      ['NaN time', 'ERR_FS_SNAPSHOT_UNREPRESENTABLE'],
      ['infinite time', 'ERR_FS_SNAPSHOT_UNREPRESENTABLE'],
      ['time 1e306', 'ERR_FS_SNAPSHOT_UNREPRESENTABLE'],
      ['time past the Date range', 'ERR_FS_SNAPSHOT_UNREPRESENTABLE'],
      ['NUL in a name', 'ERR_FS_SNAPSHOT_UNREPRESENTABLE'],
      ['a name over 16 383 code units', 'ERR_FS_SNAPSHOT_UNREPRESENTABLE'],
      ['the Date range edge', 'ok'],
      ['negative zero and sub-ms times', 'ok'],
    ]);
  });
});

describe('restore input (ADR-0567 §6)', () => {
  carrier('file bytes are owned copies, also from a Buffer blob', () => {
    const fs = createMemoryFs().fsSync;
    fs.writeFileSync('/a', new Uint8Array([1, 2, 3]));
    const blob = Buffer.from(snapshotFs(fs, OPTIONS));
    const back = createMemoryFs().fsSync;
    restoreFs(back, blob, OPTIONS);
    blob.fill(0);
    const data = back.readFileBytesSync('/a');
    expect([...data]).toEqual([1, 2, 3]);
    expect(data.buffer.byteLength).toBe(3);
  });

  carrier('a Uint8Array from another realm is accepted; a non-Uint8Array is a TypeError', () => {
    const fs = createMemoryFs().fsSync;
    fs.writeFileSync('/a', new Uint8Array([4]));
    const bytes = snapshotFs(fs, OPTIONS);
    const foreign = runInNewContext(
      '(b) => new Uint8Array(b)',
      {},
    )(Array.from(bytes)) as Uint8Array;
    const back = createMemoryFs().fsSync;
    restoreFs(back, foreign, OPTIONS);
    expect([...back.readFileBytesSync('/a')]).toEqual([4]);
    for (const wrong of [new Uint16Array(4), new DataView(new ArrayBuffer(4)), [1, 2], 'x'])
      expect(() => restoreFs(createMemoryFs().fsSync, wrong as never, OPTIONS)).toThrow(TypeError);
  });

  carrier(
    'dense blobs: each entry counts ENTRY_COST against maxBytes, checked before writing',
    () => {
      // 50 000 empty dirs: ~2.5 MB of bytes, ~19 MB of budget.
      const fs = createMemoryFs().fsSync;
      for (let i = 0; i < 50_000; i++) fs.mkdirSync(`/${i.toString(36)}`, { recursive: false });
      const blob = snapshotFs(fs, { template: null, maxBytes: 1 << 30 });
      const budget = blob.length + 50_001 * ENTRY_COST;
      expect(() => snapshotFs(fs, { template: null, maxBytes: budget - 1 })).toThrow(
        /^ERR_FS_SNAPSHOT_TOO_LARGE: /,
      );
      refused(blob, 'ERR_FS_SNAPSHOT_TOO_LARGE', { template: null, maxBytes: budget - 1 });
      restoreFs(createMemoryFs().fsSync, blob, { template: null, maxBytes: budget });
    },
  );
});

describe('golden v1 blob (ADR-0567 §3: every later reader reads it)', () => {
  // Written by the v1 writer on 2026-11-22. Never regenerate: a reader that fails here broke v1.
  const golden = new Uint8Array(
    readFileSync(new URL('./fixtures/snapshot-v1.bin', import.meta.url)),
  );
  const template = { id: 'golden', version: '1' };

  carrier('restores to its recorded tree', () => {
    const fs = createMemoryFs().fsSync;
    restoreFs(fs, golden, { template, maxBytes: 1 << 20 });
    expect(listFs(fs)).toEqual(GOLDEN_TREE);
  });
});

describe('limits (ADR-0567 §7, I4)', () => {
  carrier(
    'snapshot: a blob of exactly maxBytes passes, one byte less is refused before allocating',
    () => {
      const fs = createMemoryFs().fsSync;
      fs.writeFileSync('/big', new Uint8Array(10_000));
      // The budget is the blob's bytes plus ENTRY_COST per entry (ADR-0567 §7): root + /big.
      const size = snapshotFs(fs, OPTIONS).length;
      const budget = size + 2 * ENTRY_COST;
      expect(snapshotFs(fs, { template: null, maxBytes: budget }).length).toBe(size);
      expect(() => snapshotFs(fs, { template: null, maxBytes: budget - 1 })).toThrow(
        /^ERR_FS_SNAPSHOT_TOO_LARGE: /,
      );
      const blob = snapshotFs(fs, OPTIONS);
      restoreFs(createMemoryFs().fsSync, blob, { template: null, maxBytes: budget });
      refused(blob, 'ERR_FS_SNAPSHOT_TOO_LARGE', { template: null, maxBytes: budget - 1 });
    },
  );

  carrier('restore: length over maxBytes is refused first, even for garbage', () => {
    refused(new Uint8Array(100).fill(0x41), 'ERR_FS_SNAPSHOT_TOO_LARGE', {
      template: null,
      maxBytes: 99,
    });
  });

  carrier('a claimed file size past the bytes present is refused, not allocated', () => {
    const bytes = encode([root, { kind: 2, path: '/f', size: 2 ** 50 }]);
    refused(bytes, 'ERR_FS_SNAPSHOT_CORRUPT');
  });

  carrier('invalid options are TypeErrors', () => {
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

  carrier('every truncation is refused', () => {
    const bytes = valid();
    for (let n = 0; n < bytes.length; n++) refused(bytes.subarray(0, n), 'ERR_FS_SNAPSHOT_CORRUPT');
  });

  carrier('every flipped bit is refused; in the version field as a version', () => {
    const bytes = valid();
    for (let i = 0; i < bytes.length; i++) {
      for (let bit = 0; bit < 8; bit++) {
        const copy = bytes.slice();
        copy[i] = (copy[i] as number) ^ (1 << bit);
        // Version 1 with its low bit flipped is version 0: never released, not a snapshot.
        const version = i >= 8 && i < 12 && !(i === 8 && bit === 0);
        refused(copy, version ? 'ERR_FS_SNAPSHOT_VERSION' : 'ERR_FS_SNAPSHOT_CORRUPT');
      }
    }
  });

  carrier('a wrong checksum, a foreign magic and an empty blob are corrupt', () => {
    refused(encode([root], { crc: 0 }), 'ERR_FS_SNAPSHOT_CORRUPT');
    const foreign = valid();
    foreign[0] = 0x50;
    refused(foreign, 'ERR_FS_SNAPSHOT_CORRUPT');
    refused(new Uint8Array(0), 'ERR_FS_SNAPSHOT_CORRUPT');
  });

  carrier('another format version names both numbers', () => {
    const fs = target();
    expect(() => restoreFs(fs, encode([root], { version: 2 }), OPTIONS)).toThrow(
      /^ERR_FS_SNAPSHOT_VERSION: .*\b2\b.*\b1\b/,
    );
    // No version 0 was ever released: not a snapshot.
    refused(encode([root], { version: 0 }), 'ERR_FS_SNAPSHOT_CORRUPT');
  });

  carrier('another template, none, or one where none was expected', () => {
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

  // [label, records, bytes after `end`, the refusal's detail when another check would also refuse]
  const structural: readonly (readonly [
    string,
    readonly Rec[],
    (readonly number[] | undefined)?,
    RegExp?,
  ])[] = [
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
    ['parent missing', [root, file('/nope/SECRET')], undefined, /outside its parent directory/],
    ['parent is a file', [root, file('/f'), file('/f/SECRET')]],
    ['child before its parent', [root, file('/w/SECRET'), dir('/w')]],
    ['siblings out of code-unit order', [root, file('/b'), file('/a')]],
    ['back into a closed directory', [root, dir('/a'), dir('/b'), file('/a/x')]],
    ['a name over 16 383 code units', [root, file(`/${'n'.repeat(16_384)}`)]],
    ['unknown kind (no symlinks in v1)', [root, { kind: 3, path: '/link' }]],
    ['NaN time', [root, { ...file('/a'), times: [Number.NaN, 0, 0, 0] }]],
    ['infinite time', [root, { ...file('/a'), times: [0, 0, Number.POSITIVE_INFINITY, 0] }]],
    ['size not an integer', [root, { ...file('/a', 'xy'), size: 1.5 }], undefined, /bad file size/],
    [
      'time past the Date range',
      [root, { ...file('/a'), times: [8.64e15 + 1, 0, 0, 0] }],
      undefined,
      /time/,
    ],
    ['negative size', [root, { ...file('/a'), size: -1 }]],
    ['bytes after end', [root], [0x53, 0x45, 0x43]],
  ];
  for (const [label, recs, tail, detail] of structural) {
    carrier(`${label} — refused, nothing written`, () => {
      refused(encode(recs, { tail }), 'ERR_FS_SNAPSHOT_CORRUPT');
      if (detail)
        expect(() => restoreFs(target(), encode(recs, { tail }), OPTIONS)).toThrow(detail);
    });
  }

  carrier('a path or template length past the end is refused', () => {
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
