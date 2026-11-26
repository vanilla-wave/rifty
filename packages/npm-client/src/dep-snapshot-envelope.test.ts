import { describe, expect, it } from 'vitest';
import { DEP_SNAPSHOT_TAR_BLOCK as BLOCK, readDepSnapshotTar } from './internal/index.ts';

const enc = new TextEncoder();

/** One ustar header (`type` '0' file, '5' directory, 'x' PAX), its checksum filled in. */
function header(path: string, type: string, size: number): Uint8Array {
  const h = new Uint8Array(BLOCK);
  const octal = (at: number, width: number, value: number): void =>
    h.set(enc.encode(value.toString(8).padStart(width - 1, '0')), at);
  h.set(enc.encode(path), 0);
  octal(100, 8, 0o644);
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, size);
  octal(136, 12, 0);
  h[156] = type.charCodeAt(0);
  h.set(enc.encode('ustar\0' + '00'), 257);
  h.fill(32, 148, 156);
  const sum = h.reduce((a, b) => a + b, 0);
  h.set(enc.encode(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
  return h;
}

const record = (key: string, value: string): string => {
  const body = ` ${key}=${value}\n`;
  let n = body.length + 1;
  while (String(n).length + body.length !== n) n = String(n).length + body.length;
  return `${n}${body}`;
};

/** A minimal envelope; `pax` records go before `payload/node_modules/a.js`. */
function envelope(pax: Record<string, string>): Uint8Array {
  const blocks: Uint8Array[] = [];
  const add = (path: string, type: string, data = new Uint8Array()): void => {
    blocks.push(header(path, type, data.length), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad) blocks.push(new Uint8Array(pad));
  };
  for (const dir of ['payload/', 'payload/node_modules/', 'rifty/']) add(dir, '5');
  add('payload/package.json', '0', enc.encode('{}'));
  add('payload/package-lock.json', '0', enc.encode('{}'));
  add('rifty/manifest.json', '0', enc.encode('{}'));
  const records = Object.entries(pax)
    .map(([k, v]) => record(k, v))
    .join('');
  add('PaxHeaders/a', 'x', enc.encode(records));
  add('payload/node_modules/a.js', '0', enc.encode('1'));
  blocks.push(new Uint8Array(BLOCK * 2));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of blocks) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

describe('dependency snapshot envelope reader', () => {
  it('reads an entry time: the header seconds, or the PAX mtime', () => {
    const a = (tar: Uint8Array) =>
      readDepSnapshotTar(tar).find((e) => e.path === 'payload/node_modules/a.js');
    expect(a(envelope({}))?.mtimeMs).toBe(0);
    expect(a(envelope({ mtime: '1700000000.5' }))?.mtimeMs).toBe(1_700_000_000_500);
  });

  it('admits a signed PAX mtime (a file before 1970), as the reader always did', () => {
    const entry = readDepSnapshotTar(envelope({ mtime: '-1' })).find(
      (e) => e.path === 'payload/node_modules/a.js',
    );
    expect(entry?.mtimeMs).toBe(-1000);
  });
});
