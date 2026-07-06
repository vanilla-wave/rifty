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

const enc = new TextEncoder();

function ascii(text: string): Uint8Array {
  return enc.encode(text);
}

function concat(...chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, chunk) => n + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
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

  it('cat transform modes preserve non-UTF-8 bytes while inserting ASCII markers', async () => {
    // payload lines: [0x80 \t A] / [] / [0xff B]. GNU -v notation: 0x80 →
    // 'M-^@', 0xff → 'M-^?' — under -A (=-vET) the high bytes RENDER, they do
    // not pass through raw (the old golden froze that unverified assumption;
    // review 2026-07-06 finding #10). -E/-n/-b stay byte-transparent.
    const payload = new Uint8Array([0x80, 0x09, 0x41, 0x0a, 0x0a, 0xff, 0x42, 0x0a]);
    const line1 = new Uint8Array([0x80, 0x09, 0x41]);
    const line3 = new Uint8Array([0xff, 0x42]);
    const cases: ReadonlyArray<{
      readonly args: string;
      readonly out: string;
      readonly expected: Uint8Array;
    }> = [
      {
        args: '-E',
        out: '/cat-E.dat',
        expected: concat(line1, ascii('$\n'), ascii('$\n'), line3, ascii('$\n')),
      },
      {
        args: '-A',
        out: '/cat-A.dat',
        expected: concat(ascii('M-^@^IA$\n'), ascii('$\n'), ascii('M-^?B$\n')),
      },
      {
        args: '-v',
        out: '/cat-v.dat',
        expected: concat(ascii('M-^@'), new Uint8Array([0x09]), ascii('A\n\nM-^?B\n')),
      },
      {
        args: '-e',
        out: '/cat-e.dat',
        expected: concat(ascii('M-^@'), new Uint8Array([0x09]), ascii('A$\n$\nM-^?B$\n')),
      },
      {
        args: '-t',
        out: '/cat-t.dat',
        expected: concat(ascii('M-^@^IA\n\nM-^?B\n')),
      },
      {
        args: '-T',
        out: '/cat-T.dat',
        expected: concat(new Uint8Array([0x80]), ascii('^IA\n\n'), line3, ascii('\n')),
      },
      {
        args: '-n',
        out: '/cat-n.dat',
        expected: concat(
          ascii('     1\t'),
          line1,
          ascii('\n     2\t\n     3\t'),
          line3,
          ascii('\n'),
        ),
      },
      {
        args: '-b',
        out: '/cat-b.dat',
        expected: concat(ascii('     1\t'), line1, ascii('\n\n     2\t'), line3, ascii('\n')),
      },
    ];

    const sh = new Shell();
    for (const c of cases) {
      syncMirror().writeFileSync('/bin.dat', payload);
      const res = await sh.run(`cat ${c.args} /bin.dat > ${c.out}`);
      expect(res.exitCode).toBe(0);
      expect(Array.from(syncMirror().readFileBytesSync(c.out))).toEqual(Array.from(c.expected));
    }
  });

  it('cat -v renders the control range like GNU (^X, ^?, M-)', async () => {
    // 0x01 → ^A, 0x1f → ^_, 0x7f → ^?, 0x9b (128+27) → M-^[, 0xe9 → M-i;
    // \t and \n stay raw under plain -v.
    syncMirror().writeFileSync(
      '/ctl.dat',
      new Uint8Array([0x01, 0x1f, 0x7f, 0x9b, 0xe9, 0x09, 0x0a]),
    );
    const sh = new Shell();
    const res = await sh.run('cat -v /ctl.dat > /ctl-v.dat');
    expect(res.exitCode).toBe(0);
    expect(Array.from(syncMirror().readFileBytesSync('/ctl-v.dat'))).toEqual(
      Array.from(concat(ascii('^A^_^?M-^[M-i'), new Uint8Array([0x09, 0x0a]))),
    );
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

  it('display decoding preserves a leading UTF-8 BOM like Node Buffer.toString', async () => {
    syncMirror().writeFileSync('/bom.bin', new Uint8Array([0xef, 0xbb, 0xbf, 0x78]));
    const sh = new Shell();
    let streamed = '';
    const res = await sh.run('cat /bom.bin', {
      onChunk: (c, s) => {
        if (s === 'stdout') streamed += c;
      },
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe('\uFEFFx');
    expect(streamed).toBe('\uFEFFx');
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

  it('snapshots Buffer chunks too — Buffer#slice() ALIASES, unlike Uint8Array#slice()', async () => {
    // Node programs hand Buffers to Writer.write; a subclass slice() that
    // returns a view would let post-write mutation corrupt the captured bytes
    // (review 2026-07-05 handoff r3). Real Node Buffer is the canonical case.
    const sh = new Shell();
    sh.registerCommand('mutbuf', async (_args, ctx) => {
      const buf = Buffer.from([0x41, 0x41, 0x41]);
      ctx.stdout.write(buf);
      buf.fill(0x42);
      return 0;
    });
    const res = await sh.run('mutbuf > /mutbuf.bin');
    expect(res.exitCode).toBe(0);
    expect(Array.from(syncMirror().readFileBytesSync('/mutbuf.bin'))).toEqual([0x41, 0x41, 0x41]);
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
