import { describe, expect, it } from 'vitest';
import { Duplex } from './duplex.ts';
import { PassThrough } from './pass-through.ts';
import { Readable } from './readable.ts';
import { Transform } from './transform.ts';
import { Writable } from './writable.ts';

/**
 * Bare streams are LOUD like Node (`ERR_METHOD_NOT_IMPLEMENTED`), never silent
 * stubs; subclass PROTOTYPE methods are real implementations (Node dispatches
 * them — an own-property probe does not). Parity twin:
 * `tools/node-parity-runner/cases/stream/bare-stream-contract.case.ts`.
 */

const settle = (): Promise<void> => new Promise((res) => setTimeout(res, 1));

function codeOf(err: unknown): string {
  return (err as { code?: string }).code ?? 'no-code';
}

describe('bare streams are loud (Node ERR_METHOD_NOT_IMPLEMENTED)', () => {
  it('bare Readable: read() returns null, destroys with an error EVENT (never a silent stall)', async () => {
    const r = new Readable();
    let evCode: string | null = null;
    r.on('error', (e) => {
      evCode = codeOf(e);
    });
    expect(r.read(1)).toBeNull(); // no sync throw — Node reports via destroy
    await settle();
    expect(evCode).toBe('ERR_METHOD_NOT_IMPLEMENTED');
    expect(r.destroyed).toBe(true);
  });

  it('direct bare _read(size) throws synchronously', () => {
    expect(() => new Readable()._read(1)).toThrowError(/The _read\(\) method is not implemented/);
  });

  it('bare Writable: write() throws SYNCHRONOUSLY (Node writeOrBuffer path)', () => {
    const w = new Writable();
    w.on('error', () => {});
    let code = 'none';
    try {
      w.write('x');
    } catch (e) {
      code = codeOf(e);
    }
    expect(code).toBe('ERR_METHOD_NOT_IMPLEMENTED');
  });

  it('direct bare _write() throws synchronously', () => {
    expect(() => new Writable()._write('x', 'utf8', () => {})).toThrowError(
      /The _write\(\) method is not implemented/,
    );
  });

  it('corked bare Writable buffers the write; uncork() throws at flush (Node clearBuffer timing)', () => {
    const w = new Writable();
    w.on('error', () => {});
    w.cork();
    expect(() => w.write('x')).not.toThrow();
    expect(() => w.uncork()).toThrowError(/The _write\(\) method is not implemented/);
  });

  it('bare Transform: write() throws SYNCHRONOUSLY with the _transform message (no identity lie)', () => {
    const t = new Transform();
    t.on('error', () => {});
    let msg = 'none';
    try {
      t.write('x');
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toBe('The _transform() method is not implemented');
  });

  it('bare Duplex: write() throws SYNCHRONOUSLY; read() destroys with an error event', async () => {
    const d = new Duplex();
    let evCode: string | null = null;
    d.on('error', (e) => {
      evCode = codeOf(e);
    });
    expect(() => d.write('x')).toThrowError(/The _write\(\) method is not implemented/);
    d.read(1);
    await settle();
    expect(evCode).toBe('ERR_METHOD_NOT_IMPLEMENTED');
    expect(d.destroyed).toBe(true);
  });
});

describe('subclass prototype methods are the implementation (Node dispatch)', () => {
  it('Writable subclass with ONLY _writev: a single write routes through it', async () => {
    const batches: string[][] = [];
    class WV extends Writable {
      override _writev(chunks: { chunk: unknown }[], cb: (err?: Error | null) => void): void {
        batches.push(chunks.map((c) => String(c.chunk)));
        cb();
      }
    }
    const wv = new WV();
    expect(() => wv.write('a')).not.toThrow();
    await settle();
    expect(batches).toEqual([['a']]);
  });

  it('Duplex subclass prototype _write receives chunks (own-property probe missed it → silent drop)', async () => {
    const got: string[] = [];
    class DW extends Duplex {
      override _read(): void {}
      _write(chunk: unknown, _enc: string, cb: (err?: Error | null) => void): void {
        got.push(String(chunk));
        cb();
      }
    }
    const dw = new DW();
    dw.write('zz');
    await settle();
    expect(got).toEqual(['zz']);
  });

  it('Duplex subclass prototype _final runs on end()', async () => {
    let finalCalled = false;
    class DF extends Duplex {
      override _read(): void {}
      _write(_c: unknown, _e: string, cb: (err?: Error | null) => void): void {
        cb();
      }
      _final(cb: (err?: Error | null) => void): void {
        finalCalled = true;
        cb();
      }
    }
    const df = new DF();
    df.end('x');
    await settle();
    expect(finalCalled).toBe(true);
  });

  it('Duplex subclass with ONLY prototype _writev writes through it', async () => {
    const batches: string[][] = [];
    class DV extends Duplex {
      override _read(): void {}
      _writev(chunks: { chunk: unknown }[], cb: (err?: Error | null) => void): void {
        batches.push(chunks.map((c) => String(c.chunk)));
        cb();
      }
    }
    const dv = new DV();
    expect(() => dv.write('q')).not.toThrow();
    await settle();
    expect(batches).toEqual([['q']]);
  });

  it('Transform subclass prototype _transform + _flush dispatch (was: silent identity)', async () => {
    class TT extends Transform {
      override _transform(
        chunk: unknown,
        _enc: string,
        cb: (err?: Error | null, v?: unknown) => void,
      ): void {
        cb(null, String(chunk).toUpperCase());
      }
      _flush(cb: (err?: Error | null) => void): void {
        this.push('END');
        cb();
      }
    }
    const tt = new TT();
    const seen: string[] = [];
    tt.on('data', (c) => seen.push(String(c)));
    tt.write('ab');
    tt.end();
    await new Promise<void>((res) => tt.on('end', () => res()));
    expect(seen).toEqual(['AB', 'END']);
  });

  it('PassThrough stays the identity transform', async () => {
    const pt = new PassThrough();
    const seen: string[] = [];
    pt.on('data', (c) => seen.push(String(c)));
    pt.write('ok');
    pt.end();
    await settle();
    expect(seen).toEqual(['ok']);
  });
});
