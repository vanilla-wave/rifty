/**
 * Acceptance carrier, goal `isolate-host-fs-snapshot` (scenario steps 1–4,
 * I1–I6): the built guest bundle in real isolated-vm 7.0.2 and rifty
 * `MemoryFs` in this Node realm, no sandbox API.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { afterAll, describe, expect, it } from 'vitest';
import { FsSnapshotError, restoreFs, snapshotFs } from '../src/index.ts';
import { BUILD_TREE, LIST_TREE, type Row, drive, listFs, withoutMode } from './snapshot-support.ts';

const carrier = it;

const TEMPLATE = { id: 'docs-libs', version: '2026.11.1' };
const OPTIONS = { template: TEMPLATE, maxBytes: 1 << 20 };
const MiB = 1 << 20;
const rows = (stdout: string | undefined): Row[] => JSON.parse(stdout ?? 'null') as Row[];
const shape = (list: readonly Row[]) =>
  list.map(({ path, kind, names }) => ({ path, kind, names }));
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const unb64 = (text: string | undefined): Uint8Array =>
  new Uint8Array(Buffer.from(text ?? '', 'base64'));
const work = mkdtempSync(join(tmpdir(), 'isolate-guest-snapshot-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('guest FS snapshot — scenario', () => {
  carrier('steps 1–2: written in one isolate, seen identically in a fresh one (I1, I6)', () => {
    const [, before, snap] = drive([
      { op: 'isolate' },
      // Build and list in the one run of this isolate; the listing is the reference.
      { op: 'run', code: BUILD_TREE + LIST_TREE },
      { op: 'snapshot', options: OPTIONS },
    ]);
    expect(before?.exitCode).toBe(0);
    expect(snap?.error).toBeUndefined();
    // An honest snapshot crosses the ivm boundary as an exact-length buffer.
    expect(snap).toMatchObject({ type: '[object Uint8Array]', exact: true });
    const [, restored, after] = drive([
      { op: 'isolate' },
      { op: 'restore', bytes: snap?.bytes ?? '', options: OPTIONS },
      { op: 'run', code: LIST_TREE },
    ]);
    expect(restored).toMatchObject({ ok: true });
    expect(rows(after?.stdout)).toEqual(rows(before?.stdout));
  });

  carrier('step 3: isolate ⇄ consumer realm, both directions (I1, I5)', () => {
    const [, listed, snap] = drive([
      { op: 'isolate' },
      { op: 'run', code: BUILD_TREE + LIST_TREE },
      { op: 'snapshot', options: OPTIONS },
    ]);
    const isolateBytes = unb64(snap?.bytes);
    // Isolate → Node: the same tree, and the same bytes back (determinism across realms).
    const node = createMemoryFs().fsSync;
    restoreFs(node, isolateBytes, OPTIONS);
    expect(listFs(node)).toEqual(withoutMode(rows(listed?.stdout)));
    expect(Buffer.from(snapshotFs(node, OPTIONS)).equals(Buffer.from(isolateBytes))).toBe(true);
    // Node → isolate: a tree built here restores there.
    const built = createMemoryFs().fsSync;
    built.mkdirSync('/workspace/out', { recursive: true });
    built.writeFileSync('/workspace/out/report.pdf', new Uint8Array([37, 80, 68, 70, 0, 255]));
    built.utimes('/workspace/out/report.pdf', 5000, 6000);
    const [, ok, seen] = drive([
      { op: 'isolate' },
      { op: 'restore', bytes: b64(snapshotFs(built, OPTIONS)), options: OPTIONS },
      { op: 'run', code: LIST_TREE },
    ]);
    expect(ok).toMatchObject({ ok: true });
    expect(withoutMode(rows(seen?.stdout))).toEqual(listFs(built));
  });

  carrier('step 4: refused bytes leave the FS as it was, in both realms (I2, I3)', () => {
    const [, , snap] = drive([
      { op: 'isolate' },
      { op: 'run', code: BUILD_TREE },
      { op: 'snapshot', options: OPTIONS },
    ]);
    const good = unb64(snap?.bytes);
    const flipped = good.slice();
    const mid = Math.floor(flipped.length / 2);
    flipped[mid] = (flipped[mid] as number) ^ 0x01;
    const cases: readonly [string, Uint8Array, unknown, string][] = [
      ['truncated', good.subarray(0, good.length - 1), OPTIONS, 'ERR_FS_SNAPSHOT_CORRUPT'],
      ['flipped byte', flipped, OPTIONS, 'ERR_FS_SNAPSHOT_CORRUPT'],
      [
        'over maxBytes',
        good,
        { ...OPTIONS, maxBytes: good.length - 1 },
        'ERR_FS_SNAPSHOT_TOO_LARGE',
      ],
      [
        'other template',
        good,
        { ...OPTIONS, template: { ...TEMPLATE, version: '2026.11.2' } },
        'ERR_FS_SNAPSHOT_TEMPLATE',
      ],
      ['no template', good, { ...OPTIONS, template: null }, 'ERR_FS_SNAPSHOT_TEMPLATE'],
    ];
    const [, freshListing] = drive([{ op: 'isolate' }, { op: 'run', code: LIST_TREE }]);
    for (const [label, bytes, options, code] of cases) {
      const [, refused, listing] = drive([
        { op: 'isolate' },
        { op: 'restore', bytes: b64(bytes), options },
        { op: 'run', code: LIST_TREE },
      ]);
      expect(refused?.error, label).toMatch(new RegExp(`^${code}: `));
      // The fresh tree, untouched (its own times: another isolate).
      expect(shape(rows(listing?.stdout)), label).toEqual(shape(rows(freshListing?.stdout)));
      const node = createMemoryFs().fsSync;
      node.writeFileSync('/marker', new Uint8Array([1]));
      const before = listFs(node);
      expect(() => restoreFs(node, bytes, options as typeof OPTIONS), label).toThrow(
        FsSnapshotError,
      );
      expect(listFs(node), label).toEqual(before);
    }
  });

  carrier('snapshot over maxBytes is refused before the blob is allocated (I4)', () => {
    // 50 MiB of files under a 96 MiB isolate: a second copy would not fit.
    const [, built, tooBig, fits] = drive([
      { op: 'isolate', memoryLimit: 96 },
      {
        op: 'run',
        code: "require('fs').writeFileSync('/workspace/big', new Uint8Array(50 * 1024 * 1024))",
      },
      { op: 'snapshot', options: { ...OPTIONS, maxBytes: MiB } },
      { op: 'snapshot', options: { ...OPTIONS, maxBytes: 1 << 30 } },
    ]);
    expect(built?.exitCode).toBe(0);
    expect(tooBig?.error).toMatch(/^ERR_FS_SNAPSHOT_TOO_LARGE: /);
    // Control: the same tree within the limit does need the second copy.
    expect(fits?.error).toBeDefined();
  });

  carrier(
    'restore that runs out of memory while writing leaves an unusable isolate (I3, I4)',
    () => {
      // An honest 40 MB blob of two 20 MiB files under a 64 MiB isolate: the
      // blob fits, a file's copy does not — the failure comes after the write
      // phase began (the old tree is already gone).
      const fs = createMemoryFs().fsSync;
      fs.mkdirSync('/workspace', { recursive: false });
      fs.writeFileSync('/workspace/a', new Uint8Array(20 * MiB).fill(1));
      fs.writeFileSync('/workspace/b', new Uint8Array(20 * MiB).fill(2));
      const options = { ...OPTIONS, maxBytes: 1 << 30 };
      const file = join(work, 'two-files.blob');
      writeFileSync(file, snapshotFs(fs, options));
      const [, refused, ran, snap, again] = drive([
        { op: 'isolate', memoryLimit: 64 },
        { op: 'restore', file, options },
        { op: 'run', code: LIST_TREE },
        { op: 'snapshot', options },
        { op: 'restore', file, options },
      ]);
      expect(refused?.error).toMatch(/^ERR_FS_SNAPSHOT_INCOMPLETE: /);
      expect(ran?.error).toMatch(/^ERR_FS_SNAPSHOT_INCOMPLETE: /);
      expect(snap?.error).toMatch(/^ERR_FS_SNAPSHOT_INCOMPLETE: /);
      expect(again?.error).toMatch(/^ERR_FS_SNAPSHOT_INCOMPLETE: /);
    },
  );

  carrier('a tree the format cannot carry is refused at snapshot, by name (I3)', () => {
    for (const code of [
      "fs.utimesSync('/workspace/f', new Date(NaN), new Date(NaN))",
      'fs.utimesSync("/workspace/f", 1e306, 1e306)',
      "fs.writeFileSync('/workspace/a\\0b', 'x')",
    ]) {
      const [, ran, snap] = drive([
        { op: 'isolate' },
        {
          op: 'run',
          code: `const fs = require('fs'); fs.writeFileSync('/workspace/f', 'x'); ${code}`,
        },
        { op: 'snapshot', options: OPTIONS },
      ]);
      expect(ran?.exitCode, code).toBe(0);
      expect(snap?.error, code).toMatch(/^ERR_FS_SNAPSHOT_UNREPRESENTABLE: /);
    }
  });

  carrier(
    'the densest blob within maxBytes restores under 2 × maxBytes of isolate memory (I4)',
    () => {
      // Empty directories with short names: the most entries a 32 MiB budget admits.
      const budget = 32 * MiB;
      const options = { template: null, maxBytes: budget };
      const fs = createMemoryFs().fsSync;
      let n = 0;
      for (;;) {
        fs.mkdirSync(`/${n.toString(36)}`, { recursive: false });
        n++;
        if (n % 1000 === 0) {
          try {
            snapshotFs(fs, options);
          } catch {
            break;
          }
        }
      }
      for (let i = n - 1000; i < n; i++) fs.rmSync(`/${i.toString(36)}`, { recursive: true });
      const file = join(work, 'dense.blob');
      writeFileSync(file, snapshotFs(fs, options));
      const [, restored, listed] = drive([
        { op: 'isolate', memoryLimit: 2 * 32 + 16 },
        { op: 'restore', file, options },
        { op: 'run', code: "console.log(require('fs').readdirSync('/').length)" },
      ]);
      expect(n).toBeGreaterThan(60_000);
      expect(restored).toMatchObject({ ok: true });
      expect(listed?.stdout).toBe(`${n - 1000}\n`);
    },
  );

  carrier(
    'a snapshot dense in long two-byte names fits 2 × maxBytes + 16 MiB of isolate memory (I4)',
    () => {
      // Empty files with 16 383-unit names of a two-byte character: 390 fill a 64 MiB
      // budget (~32 KB of bytes + 8 per path unit, per entry and per level).
      const options = { ...OPTIONS, maxBytes: 64 * MiB };
      const build = `const fs = require('fs'); const tail = 'ж'.repeat(16_379);
      for (let i = 0; i < 390; i++) fs.writeFileSync('/workspace/' + String(i).padStart(4, '0') + tail, '');`;
      const [, built, snap] = drive([
        { op: 'isolate', memoryLimit: 2 * 64 + 16 },
        { op: 'run', code: build },
        { op: 'snapshot', options },
      ]);
      expect(built?.exitCode).toBe(0);
      expect(snap?.error).toBeUndefined();
      expect(snap?.exact).toBe(true);
    },
  );

  carrier(
    'a snapshot that runs out of isolate memory is a named error; the FS is intact (I4)',
    () => {
      // A budget larger than the memory limit allows (the README's sizing broken):
      // a 50 MiB tree fits a 96 MiB isolate, its blob does not.
      const options = { ...OPTIONS, maxBytes: 1 << 30 };
      const [, built, snap, again] = drive([
        { op: 'isolate', memoryLimit: 96 },
        {
          op: 'run',
          code: "require('fs').writeFileSync('/workspace/big', new Uint8Array(50 * 1024 * 1024))",
        },
        { op: 'snapshot', options },
        // The FS is still there: the same refusal again, not a broken realm.
        { op: 'snapshot', options },
      ]);
      expect(built?.exitCode).toBe(0);
      expect(snap?.error).toMatch(/^ERR_FS_SNAPSHOT_TOO_LARGE: out of memory/);
      expect(again?.error).toMatch(/^ERR_FS_SNAPSHOT_TOO_LARGE: out of memory/);
    },
  );

  carrier('restore over maxBytes is refused before the blob is read (I4)', () => {
    const file = join(work, 'big.blob');
    writeFileSync(file, Buffer.alloc(60 * MiB, 0x41));
    const [, refused, listing] = drive([
      { op: 'isolate', memoryLimit: 96 },
      { op: 'restore', file, options: { ...OPTIONS, maxBytes: MiB } },
      { op: 'run', code: LIST_TREE },
    ]);
    expect(refused?.error).toMatch(/^ERR_FS_SNAPSHOT_TOO_LARGE: /);
    expect(listing?.exitCode).toBe(0);
  });

  carrier('restore during or after guest code is refused; snapshot after it works (I4)', () => {
    // A valid blob: refused for freshness alone.
    const valid = b64(snapshotFs(createMemoryFs().fsSync, OPTIONS));
    const [, , during, settled, after, late] = drive([
      { op: 'isolate' },
      { op: 'run', code: `${BUILD_TREE}; setTimeout(() => {}, 300)`, wait: false },
      { op: 'restore', bytes: valid, options: OPTIONS },
      { op: 'settle' },
      { op: 'snapshot', options: OPTIONS },
      { op: 'restore', bytes: valid, options: OPTIONS },
    ]);
    expect(during?.error).toMatch(/^ERR_FS_SNAPSHOT_NOT_FRESH: /);
    expect(settled?.exitCode).toBe(0);
    expect(after).toMatchObject({ exact: true });
    expect(late?.error).toMatch(/^ERR_FS_SNAPSHOT_NOT_FRESH: /);
  });

  carrier(
    'a snapshot from a realm the guest altered is only bytes to the consumer (I3, I4)',
    () => {
      // Intrinsics a writer may use, replaced by guest code before the snapshot.
      const poisons = [
        'DataView.prototype.setFloat64 = function () {}',
        'DataView.prototype.setUint32 = function () { throw new Error("SECRET") }',
        'Uint8Array.prototype.set = function () {}',
        'Array.prototype.sort = function () { return this.reverse() }',
        'String.prototype.charCodeAt = function () { return 47 }',
        'globalThis.Uint8Array = function () { return new Proxy({}, {}) }',
      ];
      // Control: the unaltered realm's snapshot restores.
      const [, , control] = drive([
        { op: 'isolate' },
        { op: 'run', code: BUILD_TREE },
        { op: 'snapshot', options: OPTIONS },
      ]);
      restoreFs(createMemoryFs().fsSync, unb64(control?.bytes), OPTIONS);
      for (const poison of poisons) {
        const [, ran, snap] = drive([
          { op: 'isolate' },
          { op: 'run', code: `${BUILD_TREE}; ${poison}` },
          { op: 'snapshot', options: OPTIONS },
        ]);
        expect(ran?.exitCode, poison).toBe(0);
        if (snap?.bytes === undefined) continue;
        const node = createMemoryFs().fsSync;
        try {
          restoreFs(node, unb64(snap.bytes), OPTIONS);
          // Accepted only as a consistent tree: it snapshots again.
          expect(() => snapshotFs(node, { ...OPTIONS, maxBytes: 1 << 30 }), poison).not.toThrow();
        } catch (error) {
          expect(error, poison).toBeInstanceOf(FsSnapshotError);
          expect(String(error), poison).not.toContain('SECRET');
        }
      }
    },
  );
});
