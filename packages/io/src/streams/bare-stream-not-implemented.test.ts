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
      override _write(chunk: unknown, _enc: string, cb: (err?: Error | null) => void): void {
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
      override _write(_c: unknown, _e: string, cb: (err?: Error | null) => void): void {
        cb();
      }
      override _final(cb: (err?: Error | null) => void): void {
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
      override _writev(chunks: { chunk: unknown }[], cb: (err?: Error | null) => void): void {
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
      override _flush(cb: (err?: Error | null) => void): void {
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

// Node mechanism (probed v24.16.0): ctor assigns option hooks onto the INSTANCE
// (`this._write = options.write`), so an option shadows a subclass PROTOTYPE
// method. Parity twin rows live in stream/bare-stream-contract.case.ts.
describe('option-vs-prototype hook precedence (options assign to the instance)', () => {
  it('Writable: write OPTION wins over subclass prototype _write', async () => {
    const calls: string[] = [];
    class W extends Writable {
      override _write(_c: unknown, _e: string, cb: (err?: Error | null) => void): void {
        calls.push('proto');
        cb();
      }
    }
    const w = new W({
      write(_c, _e, cb) {
        calls.push('option');
        cb();
      },
    });
    w.write('x');
    await settle();
    expect(calls).toEqual(['option']);
  });

  it('Duplex: write OPTION wins over subclass prototype _write', async () => {
    const calls: string[] = [];
    class D extends Duplex {
      override _read(): void {}
      override _write(_c: unknown, _e: string, cb: (err?: Error | null) => void): void {
        calls.push('proto');
        cb();
      }
    }
    const d = new D({
      write(_c, _e, cb) {
        calls.push('option');
        cb();
      },
    });
    d.write('x');
    await settle();
    expect(calls).toEqual(['option']);
  });

  it('Duplex: final OPTION wins over subclass prototype _final', async () => {
    const calls: string[] = [];
    class D extends Duplex {
      override _read(): void {}
      override _write(_c: unknown, _e: string, cb: (err?: Error | null) => void): void {
        cb();
      }
      override _final(cb: (err?: Error | null) => void): void {
        calls.push('proto');
        cb();
      }
    }
    const d = new D({
      final(cb) {
        calls.push('option');
        cb();
      },
    });
    d.end('x');
    await settle();
    expect(calls).toEqual(['option']);
  });

  it('Transform: transform OPTION wins over subclass prototype _transform', async () => {
    const calls: string[] = [];
    class T extends Transform {
      override _transform(
        _c: unknown,
        _e: string,
        cb: (err?: Error | null, v?: unknown) => void,
      ): void {
        calls.push('proto');
        cb(null, _c);
      }
    }
    const t = new T({
      transform(c, _e, cb) {
        calls.push('option');
        cb(null, c);
      },
    });
    t.on('data', () => {});
    t.write('x');
    await settle();
    expect(calls).toEqual(['option']);
  });

  it('Transform: write OPTION bypasses the transform machinery (instance _write shadows Transform.prototype._write)', async () => {
    const calls: string[] = [];
    const t = new Transform({
      transform(_c, _e, cb) {
        calls.push('transform');
        cb(null, _c);
      },
      write(_c, _e, cb) {
        calls.push('write-option');
        cb();
      },
    });
    t.on('data', () => {});
    t.write('x');
    await settle();
    expect(calls).toEqual(['write-option']);
  });

  it('Duplex writev option is called with the DUPLEX as `this` (not the embedded writable side)', async () => {
    let thisIsDuplex: boolean | null = null;
    const d = new Duplex({
      read(): void {},
      writev(_chunks, cb): void {
        // The option interface types `this` as Writable; the RUNTIME binding is
        // the Duplex — the identity check below is the contract under test.
        thisIsDuplex = (this as unknown) === d;
        cb();
      },
    });
    // Pile-up while a write is in flight batches via _writev (no public cork on Duplex).
    d.write('a');
    d.write('b');
    await settle();
    expect(thisIsDuplex).toBe(true);
  });

  it('PassThrough: transform OPTION wins over the identity (identity lives on the prototype like Node)', async () => {
    const seen: string[] = [];
    const pt = new PassThrough({
      transform(c, _e, cb) {
        cb(null, `OPT:${String(c)}`);
      },
    });
    pt.on('data', (c) => seen.push(String(c)));
    pt.write('ab');
    await settle();
    expect(seen).toEqual(['OPT:ab']);
  });

  it('PassThrough: subclass prototype _transform wins over the identity', async () => {
    const seen: string[] = [];
    class PT extends PassThrough {
      override _transform(
        c: unknown,
        _e: string,
        cb: (err?: Error | null, v?: unknown) => void,
      ): void {
        cb(null, String(c).toUpperCase());
      }
    }
    const pt = new PT();
    pt.on('data', (c) => seen.push(String(c)));
    pt.write('ab');
    await settle();
    expect(seen).toEqual(['AB']);
  });
});

// Node (probed v24.16.0): `end(chunk)` reaches writeOrBuffer synchronously, so a
// bare stream throws SYNC out of end() — but destroy/end state is checked FIRST
// (a destroyed bare stream reports ERR_STREAM_DESTROYED via the callback, no throw).
describe('end(chunk) on a bare stream', () => {
  it('bare Duplex.end(chunk) throws ERR_METHOD_NOT_IMPLEMENTED synchronously', () => {
    const d = new Duplex();
    d.on('error', () => {});
    expect(() => d.end('x')).toThrowError(/The _write\(\) method is not implemented/);
  });

  it('bare Transform.end(chunk) throws the _transform message synchronously', () => {
    const t = new Transform();
    t.on('error', () => {});
    expect(() => t.end('x')).toThrowError(/The _transform\(\) method is not implemented/);
  });

  it('bare Writable.end(chunk) throws synchronously (via the write() guard)', () => {
    const w = new Writable();
    w.on('error', () => {});
    expect(() => w.end('x')).toThrowError(/The _write\(\) method is not implemented/);
  });

  it('DESTROYED bare Duplex: write(chunk) does NOT throw — the callback owns the error', async () => {
    const d = new Duplex();
    d.on('error', () => {});
    d.destroy();
    let cbErr: Error | null | undefined;
    expect(() =>
      d.write('x', (err) => {
        cbErr = err;
      }),
    ).not.toThrow();
    await settle();
    expect(cbErr).toBeInstanceOf(Error);
  });

  it('DESTROYED bare Duplex: end(chunk) does NOT throw', () => {
    const d = new Duplex();
    d.on('error', () => {});
    d.destroy();
    expect(() => d.end('x')).not.toThrow();
  });
});

// Node (probed v24.16.0): user `final` rides the Writable _final slot; the
// transform flush + EOF run AFTER it. Observable order on a flowing transform:
// data → final → flush → flush-data → end → finish. A final error skips flush.
describe('Transform final/flush order', () => {
  it('user final option runs BEFORE flush; EOF follows the flush data (final|flush|flush-data|END|finish)', async () => {
    const order: string[] = [];
    const t = new Transform({
      transform(c, _e, cb) {
        cb(null, c);
      },
      flush(cb) {
        order.push('flush');
        this.push('FLUSH-DATA');
        cb();
      },
      final(cb) {
        order.push('final');
        cb();
      },
    });
    t.on('data', (c) => order.push(`data:${String(c)}`));
    t.on('end', () => order.push('END'));
    t.on('finish', () => order.push('finish'));
    t.end('x');
    await settle();
    expect(order).toEqual(['data:x', 'final', 'flush', 'data:FLUSH-DATA', 'END', 'finish']);
  });

  it('subclass prototype _final + _flush follow the same order', async () => {
    const order: string[] = [];
    class T extends Transform {
      override _transform(
        c: unknown,
        _e: string,
        cb: (err?: Error | null, v?: unknown) => void,
      ): void {
        cb(null, c);
      }
      override _flush(cb: (err?: Error | null, v?: unknown) => void): void {
        order.push('flush');
        cb(null, 'TAIL');
      }
      override _final(cb: (err?: Error | null) => void): void {
        order.push('final');
        cb();
      }
    }
    const t = new T();
    t.on('data', (c) => order.push(`data:${String(c)}`));
    t.on('end', () => order.push('END'));
    t.on('finish', () => order.push('finish'));
    t.end('x');
    await settle();
    expect(order).toEqual(['data:x', 'final', 'flush', 'data:TAIL', 'END', 'finish']);
  });

  it('user final error skips flush and surfaces as error (no finish, no end)', async () => {
    const order: string[] = [];
    const t = new Transform({
      transform(c, _e, cb) {
        cb(null, c);
      },
      flush(cb) {
        order.push('flush');
        cb();
      },
      final(cb) {
        order.push('final');
        cb(new Error('final-err'));
      },
    });
    t.on('data', () => {});
    t.on('error', (e) => order.push(`error:${(e as Error).message}`));
    t.on('finish', () => order.push('finish'));
    t.on('end', () => order.push('END'));
    t.end('x');
    await settle();
    expect(order).toEqual(['final', 'error:final-err']);
  });
});

// Node (probed v24.16.0): a value thrown from _read reaches 'error' RAW —
// a primitive stays a primitive, never wrapped into an Error.
describe('_read throw identity', () => {
  it('a thrown primitive string arrives at error unchanged', async () => {
    let got: unknown = 'unset';
    const r = new Readable({
      read(): void {
        throw 'prim-str';
      },
    });
    r.on('error', (e) => {
      got = e;
    });
    r.read(1);
    await settle();
    expect(got).toBe('prim-str');
    expect(r.destroyed).toBe(true);
  });

  it('a thrown number arrives at error unchanged', async () => {
    let got: unknown = 'unset';
    const r = new Readable({
      read(): void {
        throw 42;
      },
    });
    r.on('error', (e) => {
      got = e;
    });
    r.read(1);
    await settle();
    expect(got).toBe(42);
  });
});
