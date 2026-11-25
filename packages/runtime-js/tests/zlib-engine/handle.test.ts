/**
 * Handle paths no Node-observable surface shows (ADR-0573): zlib state freed by Node's own
 * sequences — `onerror` → `close()` inside a sync write (CompressionStream's pending close) and
 * `close()` while an async write is queued.
 */
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
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
