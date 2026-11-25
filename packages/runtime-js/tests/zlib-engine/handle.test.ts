/**
 * Handle paths no Node-observable surface shows (ADR-0573): zlib state freed by Node's own
 * sequences — `onerror` → `close()` inside a sync write (CompressionStream's pending close) and
 * `close()` while an async write is queued.
 */
import zlib from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { ZlibEngine } from '../../src/zlib-engine/engine';
import { createZlibBinding } from '../../src/zlib-engine/handle';
import { zlibWasmBytes } from '../../src/zlib-engine/wasm-bytes';

const INFLATE = 2;
const Z_FINISH = 4;

/** The real engine with `inflateEnd` counted. */
function countingEngine() {
  const engine = new ZlibEngine(zlibWasmBytes());
  const ends = { n: 0 };
  const x = engine.x;
  Object.defineProperty(engine, 'x', {
    value: {
      ...x,
      inflateEnd: (s: number) => {
        ends.n++;
        return x.inflateEnd(s);
      },
    },
  });
  return { engine, ends };
}

const BAD = Buffer.from(zlib.deflateSync(Buffer.alloc(4096, 'a')));
BAD[2]! ^= 0xff;
/** What real Node reports for BAD. */
const NODE_ERROR = (() => {
  try {
    zlib.inflateSync(BAD);
  } catch (e) {
    const x = e as Error & { code: string; errno: number };
    return `${x.code} ${x.errno} ${x.message}`;
  }
  throw new Error('BAD inflated');
})();

describe('zlib-engine handle frees zlib state on Node’s close paths', () => {
  it('onerror → close() during writeSync is deferred, then frees the state once', () => {
    const { engine, ends } = countingEngine();
    const binding = createZlibBinding(() => engine, setImmediate);
    const h = new binding.Zlib(INFLATE);
    const seen: string[] = [];
    h.onerror = (message, errno, code) => {
      seen.push(`${code} ${errno} ${message}`);
      h.close(); // lib/zlib.js: zlibOnError → destroy → _close
      seen.push(`ends inside onerror: ${ends.n}`);
    };
    h.init(0, -1, 8, 0, new Uint32Array(2), () => {}, undefined);
    const out = Buffer.alloc(1024);
    h.writeSync(Z_FINISH, BAD, 0, BAD.length, out, 0, out.length);
    expect(seen).toEqual([NODE_ERROR, 'ends inside onerror: 0']);
    expect(ends.n).toBe(1);
  });

  it('close() while an async write is queued runs after its callback', async () => {
    const { engine, ends } = countingEngine();
    const binding = createZlibBinding(() => engine, setImmediate);
    const h = new binding.Zlib(INFLATE);
    const state = new Uint32Array(2);
    const good = zlib.deflateSync(Buffer.from('hello'));
    const out = Buffer.alloc(64);
    const done = new Promise<number>((res) => {
      h.init(0, -1, 8, 0, state, () => res(ends.n), undefined);
    });
    h.writeSync(0, good, 0, 0, out, 0, out.length); // zlib state allocated
    h.write(Z_FINISH, good, 0, good.length, out, 0, out.length);
    h.close();
    expect(ends.n).toBe(0);
    expect(await done).toBe(0);
    expect(ends.n).toBe(1);
    expect(out.subarray(0, out.length - state[0]!).toString()).toBe('hello');
  });
});

/** The real engine whose `deflate` throws once (a stand-in for a wasm trap), optionally after `before()`. */
function trappingEngine(before: () => void = () => {}) {
  const engine = new ZlibEngine(zlibWasmBytes());
  const x = engine.x;
  let armed = true;
  Object.defineProperty(engine, 'x', {
    value: {
      ...x,
      deflate: (s: number, flush: number) => {
        if (!armed) return x.deflate(s, flush);
        armed = false;
        before();
        throw new Error('injected trap');
      },
    },
  });
  return engine;
}

describe('an internal failure in a write is a loud exception, not onerror', () => {
  const DEFLATE = 1;
  for (const async of [false, true])
    for (const closeDuring of [false, true])
      it(`${async ? 'async' : 'sync'}${closeDuring ? ', close() pending' : ''}: thrown, the write ends`, () => {
        const queue: (() => void)[] = [];
        let h: ReturnType<typeof open>['h'] | null = null;
        const engine = trappingEngine(() => {
          if (closeDuring) h?.close(); // pending: the write is in progress
        });
        const binding = createZlibBinding(
          () => engine,
          (run) => queue.push(run),
        );
        const opened = open(binding);
        h = opened.h;
        const out = Buffer.alloc(64);
        const call = () => {
          (async ? h!.write : h!.writeSync).call(h, Z_FINISH, Buffer.from('x'), 0, 1, out, 0, 64);
          if (async) queue.shift()?.();
        };
        expect(call).toThrow('injected trap');
        expect(opened.events).toEqual([]);
        if (closeDuring)
          expect(() => h!.writeSync(Z_FINISH, Buffer.from('x'), 0, 1, out, 0, 64)).toThrow(
            /already finalized/,
          );
        else {
          h.writeSync(Z_FINISH, Buffer.from('x'), 0, 1, out, 0, 64); // not left in progress
          expect(zlib.inflateSync(out.subarray(0, 64 - opened.state[0]!)).toString()).toBe('x');
          h.close();
        }
      });

  it('a pending close that throws too: the write’s exception still propagates, the close’s is raised after', () => {
    let h: ReturnType<typeof open>['h'] | null = null;
    const engine = trappingEngine(() => h?.close());
    const x = engine.x;
    Object.defineProperty(engine, 'x', {
      value: {
        ...x,
        deflateEnd: () => {
          throw new Error('injected close failure');
        },
      },
    });
    const later: (() => void)[] = [];
    const spy = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((f) => later.push(f));
    try {
      const opened = open(createZlibBinding(() => engine, setImmediate));
      h = opened.h;
      const out = Buffer.alloc(64);
      expect(() => h!.writeSync(Z_FINISH, Buffer.from('x'), 0, 1, out, 0, 64)).toThrow(
        'injected trap',
      );
    } finally {
      spy.mockRestore();
    }
    expect(later.length).toBe(1);
    expect(later[0]).toThrow('injected close failure');
  });

  function open(binding: ReturnType<typeof createZlibBinding>) {
    const h = new binding.Zlib(DEFLATE);
    const state = new Uint32Array(2);
    const events: unknown[] = [];
    h.onerror = (...a) => events.push(a);
    h.init(15, -1, 8, 0, state, () => {}, undefined);
    return { h, state, events };
  }
});
