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
});
