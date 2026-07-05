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

  it('onChunk flushes a trailing incomplete multibyte sequence instead of dropping it', async () => {
    // 'hi' + the first 2 bytes of '€' (E2 82) — the streaming display decoder
    // holds them waiting for a continuation that never comes.
    syncMirror().writeFileSync('/partial.bin', new Uint8Array([0x68, 0x69, 0xe2, 0x82]));
    const sh = new Shell();
    let out = '';
    const res = await sh.run('cat /partial.bin', {
      onChunk: (c, s) => {
        if (s === 'stdout') out += c;
      },
    });
    expect(res.exitCode).toBe(0);
    expect(out).toBe('hi�');
  });

  it('captures a byte chunk snapshot even if the command reuses its buffer', async () => {
    const sh = new Shell();
    sh.registerCommand('mutate', async (_args, ctx) => {
      const bytes = new Uint8Array([0x41]);
      ctx.stdout.write(bytes);
      bytes[0] = 0x42;
      return 0;
    });
    const res = await sh.run('mutate > /mutated.bin');
    expect(res.exitCode).toBe(0);
    expect(Array.from(syncMirror().readFileBytesSync('/mutated.bin'))).toEqual([0x41]);
  });

  it('keeps onChunk display order aligned when byte and string writes share one decoder', async () => {
    const sh = new Shell();
    sh.registerCommand('mixed', async (_args, ctx) => {
      ctx.stdout.write(new Uint8Array([0xe2, 0x82]));
      ctx.stdout.write('x');
      return 0;
    });
    let out = '';
    const res = await sh.run('mixed', {
      onChunk: (c, s) => {
        if (s === 'stdout') out += c;
      },
    });
    expect(res.stdout).toBe('�x');
    expect(out).toBe('�x');
  });

  it('RunResult.stderr keeps a trailing incomplete multibyte from a byte-writing command', async () => {
    const sh = new Shell();
    sh.registerCommand('errbytes', async (_args, ctx) => {
      ctx.stderr.write(new Uint8Array([0x68, 0x69, 0xe2, 0x82]));
      return 1;
    });
    let err = '';
    const res = await sh.run('errbytes', {
      onChunk: (c, s) => {
        if (s === 'stderr') err += c;
      },
    });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toBe('hi�');
    expect(err).toBe('hi�');
  });
});
