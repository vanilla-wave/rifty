import { afterEach, describe, expect, it } from 'vitest';
import {
  Readable,
  Writable,
  addAbortSignal,
  getDefaultHighWaterMark,
  isDisturbed,
  isErrored,
  isReadable,
  isWritable,
  setDefaultHighWaterMark,
} from './index.ts';

const settle = (ms = 5): Promise<void> => new Promise((res) => setTimeout(res, ms));

describe('stream predicates', () => {
  it('isReadable: true for a fresh Readable, null for non-streams', () => {
    expect(isReadable(new Readable({ read() {} }))).toBe(true);
    // Node's exact shape: non-Readable input → null (never throws).
    expect(isReadable({})).toBeNull();
    expect(isReadable(null)).toBeNull();
    expect(isReadable(42)).toBeNull();
    // A pure Writable has no readable side → null.
    expect(
      isReadable(
        new Writable({
          write(_c, _e, cb) {
            cb();
          },
        }),
      ),
    ).toBeNull();
  });

  it('isReadable: false once destroyed', async () => {
    const r = new Readable({ read() {} });
    r.destroy();
    await settle();
    expect(isReadable(r)).toBe(false);
  });

  it('isReadable: stays true after push(null) until buffered data drains and end emits', () => {
    const r = new Readable({ read() {} });
    r.push('tail');
    r.push(null);
    expect(r._readableState.ended).toBe(true);
    expect(r._readableState.endEmitted).toBe(false);
    expect(isReadable(r)).toBe(true);
  });

  it('isWritable: true fresh, false ended/destroyed, null for non-Writable', async () => {
    const w = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    expect(isWritable(w)).toBe(true);
    w.end();
    await settle();
    expect(isWritable(w)).toBe(false);
    expect(isWritable(new Readable({ read() {} }))).toBeNull();
    expect(isWritable('str')).toBeNull();
  });

  it('isErrored: true once errored, false otherwise and for non-streams', async () => {
    const r = new Readable({ read() {} });
    expect(isErrored(r)).toBe(false);
    r.on('error', () => {});
    r.destroy(new Error('boom'));
    await settle();
    expect(isErrored(r)).toBe(true);
    expect(isErrored({})).toBe(false);
    expect(isErrored(null)).toBe(false);
  });

  it('isDisturbed: false fresh, true after a read, true after destroy, false non-stream', async () => {
    const fresh = new Readable({ read() {} });
    expect(isDisturbed(fresh)).toBe(false);

    const read1 = new Readable({ read() {} });
    read1.push('x');
    read1.read();
    expect(isDisturbed(read1)).toBe(true);

    // Destroyed → disturbed even without a read.
    const destroyed = new Readable({ read() {} });
    destroyed.destroy();
    await settle();
    expect(isDisturbed(destroyed)).toBe(true);

    expect(isDisturbed({})).toBe(false);
    expect(isDisturbed(42)).toBe(false);
  });

  it('isDisturbed: true after flowing-mode consumption', async () => {
    const r = new Readable({ read() {} });
    r.on('data', () => {});
    r.push('hello');
    await settle(10);
    expect(isDisturbed(r)).toBe(true);
  });
});

describe('default high-water-mark accessors', () => {
  afterEach(() => {
    // Restore the module-level defaults so cases don't leak (in-process).
    setDefaultHighWaterMark(false, 65536);
    setDefaultHighWaterMark(true, 16);
  });

  it('returns the byte/object defaults', () => {
    expect(getDefaultHighWaterMark(false)).toBe(65536);
    expect(getDefaultHighWaterMark(true)).toBe(16);
  });

  it('a ctor with no explicit HWM observes the current default', () => {
    expect(new Readable({ read() {} }).readableHighWaterMark).toBe(65536);
    setDefaultHighWaterMark(false, 1024);
    expect(new Readable({ read() {} }).readableHighWaterMark).toBe(1024);
    expect(
      new Writable({
        write(_c, _e, cb) {
          cb();
        },
      }).writableHighWaterMark,
    ).toBe(1024);
  });

  it('an explicit { highWaterMark } still wins over the default', () => {
    setDefaultHighWaterMark(false, 1024);
    expect(new Readable({ read() {}, highWaterMark: 7 }).readableHighWaterMark).toBe(7);
  });

  it('object-mode default is independent of the byte default', () => {
    setDefaultHighWaterMark(false, 1024);
    expect(getDefaultHighWaterMark(true)).toBe(16);
    expect(new Readable({ read() {}, objectMode: true }).readableHighWaterMark).toBe(16);
  });

  it('rejects an invalid value like Node (type + range)', () => {
    expect(() => setDefaultHighWaterMark(false, '5' as unknown as number)).toThrow(TypeError);
    expect(() => setDefaultHighWaterMark(false, -1)).toThrow(RangeError);
    expect(() => setDefaultHighWaterMark(false, 1.5)).toThrow(RangeError);
    // 0 is valid (Node accepts it).
    expect(() => setDefaultHighWaterMark(false, 0)).not.toThrow();
  });
});

describe('addAbortSignal', () => {
  it('returns the stream and destroys it with an AbortError on abort', async () => {
    const ac = new AbortController();
    const r = new Readable({ read() {} });
    expect(addAbortSignal(ac.signal, r)).toBe(r);
    const errors: Array<Error & { code?: string }> = [];
    r.on('error', (err) => errors.push(err as Error & { code?: string }));
    ac.abort();
    await settle();
    expect(r.destroyed).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.name).toBe('AbortError');
    expect(errors[0]?.code).toBe('ABORT_ERR');
  });

  it('an already-aborted signal destroys the stream synchronously', () => {
    const ac = new AbortController();
    ac.abort();
    const r = new Readable({ read() {} });
    r.on('error', () => {});
    addAbortSignal(ac.signal, r);
    expect(r.destroyed).toBe(true);
  });
});
