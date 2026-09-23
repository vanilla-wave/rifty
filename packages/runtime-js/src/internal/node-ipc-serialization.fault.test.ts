import { Buffer } from '@riftydev/io';
import { describe, expect, it } from 'vitest';
import { serializeNodeIpcMessage } from './node-ipc-serialization.ts';

function advanced(message: unknown): unknown {
  return Reflect.apply(serializeNodeIpcMessage, undefined, [message, 'advanced']);
}

describe('advanced Node IPC serialization faults', () => {
  it('preserves the structured-clone graph without JSON conversion', () => {
    const value: {
      date: Date;
      map: Map<string, number>;
      missing: undefined[];
      bytes: Uint8Array;
      set: Set<string>;
      regexp: RegExp;
      error: Error;
      self?: unknown;
    } = {
      date: new Date('2020-01-02T03:04:05.000Z'),
      map: new Map([['key', 7]]),
      missing: [undefined],
      bytes: new Uint8Array([0, 128, 255]),
      set: new Set(['a', 'b']),
      regexp: /ab+/gi,
      error: new Error('boom', { cause: 'root' }),
    };
    value.self = value;

    const result = advanced(value) as typeof value;
    expect(result).not.toBe(value);
    expect(result.date instanceof Date).toBe(true);
    expect(result.map instanceof Map).toBe(true);
    expect(result.missing).toEqual([undefined]);
    expect([...result.bytes]).toEqual([0, 128, 255]);
    expect(result.set instanceof Set).toBe(true);
    expect([...result.set]).toEqual(['a', 'b']);
    expect(result.regexp.toString()).toBe('/ab+/gi');
    expect(result.error instanceof Error).toBe(true);
    expect(result.error.message).toBe('boom');
    expect(result.error.cause).toBe('root');
    expect(result.self).toBe(result);
  });

  it('rejects a nested uncloneable function without poisoning later messages', () => {
    expect(() => advanced({ fn() {} })).toThrow(/could not be cloned/i);
    expect(advanced({ after: true })).toEqual({ after: true });
  });

  it('rejects top-level BigInt while admitting nested BigInt', () => {
    expect(() => advanced(9n)).toThrow(
      expect.objectContaining({ name: 'TypeError', code: 'ERR_INVALID_ARG_TYPE' }) as Error,
    );
    expect(advanced({ big: 9n })).toEqual({ big: 9n });
  });

  it('rejects a nested Buffer rather than silently changing its brand', () => {
    expect(() => advanced({ nested: [Buffer.from([1, 2])] })).toThrow(
      /child_process\.serialization\.advanced\.Buffer/u,
    );
  });

  it('rejects accessors without invoking a getter during validation', () => {
    let calls = 0;
    const value = {
      get nested(): Uint8Array {
        calls++;
        return new Uint8Array([1]);
      },
    };
    expect(() => advanced(value)).toThrow(/child_process\.serialization\.advanced\.accessor/u);
    expect(calls).toBe(0);
  });

  it('rejects SharedArrayBuffer like Node and unknown host objects loudly', () => {
    expect(() => advanced({ shared: new SharedArrayBuffer(4) })).toThrow(
      /SharedArrayBuffer.*could not be cloned/u,
    );
    expect(() => advanced({ blob: new Blob(['x']) })).toThrow(
      /child_process\.serialization\.advanced\.host-object/u,
    );
    expect(advanced({ after: true })).toEqual({ after: true });
  });

  it('rejects SAB-backed typed arrays and DataViews instead of retaining shared backing', () => {
    const backing = new SharedArrayBuffer(4);
    new Uint8Array(backing).set([1, 2, 3, 4]);
    expect(() => advanced({ typed: new Uint8Array(backing, 1, 2) })).toThrow(
      /child_process\.serialization\.advanced\.shared-view/u,
    );
    expect(() => advanced({ view: new DataView(backing, 1, 2) })).toThrow(
      /child_process\.serialization\.advanced\.shared-view/u,
    );
    const ordinary = advanced({ view: new DataView(new ArrayBuffer(2)) }) as {
      view: DataView;
    };
    expect(ordinary.view.buffer instanceof ArrayBuffer).toBe(true);
  });

  it('classifies view backing from its internal slot, not an own buffer property', () => {
    const spoofed = new Uint8Array(new SharedArrayBuffer(4), 1, 2);
    Object.defineProperty(spoofed, 'buffer', { value: new ArrayBuffer(4) });
    expect(() => advanced({ spoofed })).toThrow(
      /child_process\.serialization\.advanced\.shared-view/u,
    );
    const dataView = new DataView(new SharedArrayBuffer(4), 1, 2);
    Object.defineProperty(dataView, 'buffer', { value: new ArrayBuffer(4) });
    expect(() => advanced({ dataView })).toThrow(
      /child_process\.serialization\.advanced\.shared-view/u,
    );
  });

  it('reads Map internal entries despite an own iterator override', () => {
    const map = new Map<string, unknown>([['key', 7]]);
    Object.defineProperty(map, Symbol.iterator, {
      value: () => {
        throw new Error('user iterator called');
      },
    });
    const result = advanced({ map }) as { map: Map<string, unknown> };
    expect(result.map.get('key')).toBe(7);
  });

  it('reads Set internal entries despite an own iterator override', () => {
    const set = new Set<unknown>([7]);
    Object.defineProperty(set, Symbol.iterator, {
      value: () => {
        throw new Error('user iterator called');
      },
    });
    const result = advanced({ set }) as { set: Set<unknown> };
    expect(result.set.has(7)).toBe(true);
  });

  it('does not let Map or Set own iterators hide Buffer or raw SAB entries', () => {
    const map = new Map<string, unknown>([['key', Buffer.from([1, 2])]]);
    const set = new Set<unknown>([Buffer.from([3, 4])]);
    for (const container of [map, set]) {
      Object.defineProperty(container, Symbol.iterator, { value: () => [][Symbol.iterator]() });
      Object.defineProperty(container, 'forEach', {
        value: () => {
          throw new Error('user forEach called');
        },
      });
    }
    expect(() => advanced({ map })).toThrow(/child_process\.serialization\.advanced\.Buffer/u);
    expect(() => advanced({ set })).toThrow(/child_process\.serialization\.advanced\.Buffer/u);

    map.set('key', new SharedArrayBuffer(2));
    expect(() => advanced({ map })).toThrow(/SharedArrayBuffer.*could not be cloned/u);
  });

  it('rejects a raw SharedArrayBuffer after its prototype is replaced', () => {
    const shared = new SharedArrayBuffer(2);
    Object.setPrototypeOf(shared, Object.prototype);
    expect(() => advanced({ shared })).toThrow(/could not be cloned/u);
  });

  it('inspects Map internal entries after its prototype is replaced', () => {
    const map = new Map<string, unknown>([['key', Buffer.from([1, 2])]]);
    Object.setPrototypeOf(map, Object.prototype);
    expect(() => advanced({ map })).toThrow(/child_process\.serialization\.advanced\.Buffer/u);
  });

  it('inspects Set internal entries after its prototype is replaced', () => {
    const set = new Set<unknown>([new SharedArrayBuffer(2)]);
    Object.setPrototypeOf(set, Object.prototype);
    expect(() => advanced({ set })).toThrow(/could not be cloned/u);
  });

  it('rejects an ordinary typed array after its prototype is replaced', () => {
    const typed = new Uint8Array([1, 2]);
    Object.setPrototypeOf(typed, Object.prototype);
    expect(() => advanced({ typed })).toThrow(
      /child_process\.serialization\.advanced\.host-object/u,
    );
  });

  it('rejects a Buffer with a replaced prototype instead of sending Uint8Array', () => {
    const buffer = Buffer.from([1, 2]);
    Object.setPrototypeOf(buffer, Object.prototype);
    expect(() => advanced({ buffer })).toThrow(
      /child_process\.serialization\.advanced\.host-object/u,
    );
  });

  it('rejects an ordinary DataView after its prototype is replaced', () => {
    const ordinaryView = new DataView(new ArrayBuffer(2));
    Object.setPrototypeOf(ordinaryView, Object.prototype);
    expect(() => advanced({ ordinaryView })).toThrow(
      /child_process\.serialization\.advanced\.host-object/u,
    );
  });

  it('keeps a shared DataView named loud after its prototype is replaced', () => {
    const sharedView = new DataView(new SharedArrayBuffer(2));
    Object.setPrototypeOf(sharedView, Object.prototype);
    expect(() => advanced({ sharedView })).toThrow(
      /child_process\.serialization\.advanced\.shared-view/u,
    );
  });

  it('rejects explicit ArrayBuffer/view aliases instead of retaining shared mutations', () => {
    const backing = new ArrayBuffer(8);
    const view = new Uint8Array(backing, 2, 3);
    for (const payload of [
      { backing, view },
      { view, backing },
      new Map<string, unknown>([
        ['backing', backing],
        ['view', view],
      ]),
    ]) {
      expect(() => advanced(payload)).toThrow(
        /child_process\.serialization\.advanced\.arraybuffer-view-alias/u,
      );
    }
    const standalone = advanced({ view: new Uint8Array([1, 2]) }) as {
      view: Uint8Array;
    };
    expect([...standalone.view]).toEqual([1, 2]);
  });
});
