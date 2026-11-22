/**
 * Acceptance carrier, goal `isolate-host-fs-snapshot` (scenario steps 1–4,
 * I1–I5): the built guest bundle in real isolated-vm 7.0.2 and rifty
 * `MemoryFs` in this Node realm, no sandbox API. RED until the codec lands
 * (`carrier` = `it.fails`), then plain `it`.
 */
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { FsSnapshotError, restoreFs, snapshotFs } from '../src/index.ts';
import { BUILD_TREE, LIST_TREE, type Row, drive, listFs, withoutMode } from './snapshot-support.ts';

const carrier = it.fails;

const TEMPLATE = { id: 'docs-libs', version: '2026.11.1' };
const OPTIONS = { template: TEMPLATE, maxBytes: 1 << 20 };
const rows = (stdout: string | undefined): Row[] => JSON.parse(stdout ?? 'null') as Row[];
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const unb64 = (text: string | undefined): Uint8Array =>
  new Uint8Array(Buffer.from(text ?? '', 'base64'));

describe('guest FS snapshot — scenario', () => {
  carrier('steps 1–2: written in one isolate, seen identically in a fresh one (I1)', () => {
    const [, built, before, snap] = drive([
      { op: 'isolate' },
      { op: 'run', code: BUILD_TREE },
      // Listed after the build run ended, in the same isolate: the reference.
      { op: 'run', code: LIST_TREE },
      { op: 'snapshot', options: OPTIONS },
    ]);
    expect(built?.exitCode).toBe(0);
    expect(snap?.error).toBeUndefined();
    // Crossed the ivm boundary as an exact-length buffer (I6).
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
    const [, , listed, snap] = drive([
      { op: 'isolate' },
      { op: 'run', code: BUILD_TREE },
      { op: 'run', code: LIST_TREE },
      { op: 'snapshot', options: OPTIONS },
    ]);
    const isolateBytes = unb64(snap?.bytes);
    // Isolate → Node: the same tree, and the same bytes back (determinism across realms).
    const node = createMemoryFs().fsSync;
    restoreFs(node, isolateBytes, OPTIONS);
    expect(listFs(node)).toEqual(withoutMode(rows(listed?.stdout)));
    expect(b64(snapshotFs(node, OPTIONS))).toBe(snap?.bytes);
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
      // The fresh tree, untouched; ino/times of a fresh FS are its own.
      expect(
        rows(listing?.stdout).map((r) => r.path),
        label,
      ).toEqual(rows(freshListing?.stdout).map((r) => r.path));
      const node = createMemoryFs().fsSync;
      node.writeFileSync('/marker', new Uint8Array([1]));
      const before = listFs(node);
      expect(() => restoreFs(node, bytes, options as typeof OPTIONS), label).toThrow(
        FsSnapshotError,
      );
      expect(listFs(node), label).toEqual(before);
    }
  });

  carrier(
    'a tree over maxBytes is refused at snapshot; restore after guest code is refused (I4)',
    () => {
      // A valid blob: refused for freshness alone.
      const valid = b64(snapshotFs(createMemoryFs().fsSync, OPTIONS));
      const [, , tooBig, after, late] = drive([
        { op: 'isolate' },
        { op: 'run', code: BUILD_TREE },
        { op: 'snapshot', options: { ...OPTIONS, maxBytes: 64 } },
        { op: 'snapshot', options: OPTIONS },
        { op: 'restore', bytes: valid, options: OPTIONS },
      ]);
      expect(after?.exact).toBe(true);
      expect(tooBig?.error).toMatch(/^ERR_FS_SNAPSHOT_TOO_LARGE: /);
      expect(late?.error).toMatch(/^ERR_FS_SNAPSHOT_NOT_FRESH: /);
    },
  );
});
