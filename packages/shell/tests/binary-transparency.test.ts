/**
 * Byte transparency of the shell data plane (review 2026-07-05): `cat` of a
 * binary file through `>`/`>>`/`|` must be byte-identical. The old pipeline
 * decoded every chunk to a JS string and re-encoded — each invalid-UTF-8 byte
 * became U+FFFD (EF BF BD), permanently corrupting the payload. The display
 * plane (RunResult.stdout, onChunk) stays string-typed; only capture, pipes
 * and redirects carry bytes end-to-end (ADR-0198).
 */
import { syncMirror } from '@riftydev/vfs';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Shell } from '../src/index.ts';

/** Every byte value once — 0x80..0xFF are invalid UTF-8 lead/continuation mixes. */
function allBytes(): Uint8Array {
  const b = new Uint8Array(256);
  for (let i = 0; i < 256; i++) b[i] = i;
  return b;
}

describe('shell binary transparency (ADR-0198)', () => {
  beforeEach(() => {
    setSyncMirror(new MemoryFsSync());
    syncMirror().writeFileSync('/bin.dat', allBytes());
  });
  afterEach(() => resetSyncMirror());

  it('cat > copy is byte-identical for a binary file', async () => {
    const sh = new Shell();
    const res = await sh.run('cat /bin.dat > /copy.dat');
    expect(res.exitCode).toBe(0);
    expect(Array.from(syncMirror().readFileBytesSync('/copy.dat'))).toEqual(Array.from(allBytes()));
  });

  it('cat >> appends bytes without re-encoding', async () => {
    syncMirror().writeFileSync('/copy2.dat', new Uint8Array([1, 2, 3]));
    const sh = new Shell();
    const res = await sh.run('cat /bin.dat >> /copy2.dat');
    expect(res.exitCode).toBe(0);
    const got = syncMirror().readFileBytesSync('/copy2.dat');
    expect(Array.from(got.subarray(0, 3))).toEqual([1, 2, 3]);
    expect(Array.from(got.subarray(3))).toEqual(Array.from(allBytes()));
  });

  it('cat | wc -c counts the ORIGINAL bytes, not a re-encoded string', async () => {
    const sh = new Shell();
    const res = await sh.run('cat /bin.dat | wc -c');
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe('256');
  });

  it('pipe hand-off between two cats stays byte-identical', async () => {
    const sh = new Shell();
    const res = await sh.run('cat /bin.dat | cat > /piped.dat');
    expect(res.exitCode).toBe(0);
    expect(Array.from(syncMirror().readFileBytesSync('/piped.dat'))).toEqual(
      Array.from(allBytes()),
    );
  });
});
