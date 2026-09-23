import { afterEach, describe, expect, it } from 'vitest';
import { Buffer as RiftyBuffer } from '../../../packages/io/src/buffer.ts';
import { fork } from '../../../packages/runtime-js/src/builtins/child_process.ts';
import { resetSyncMirror } from '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts';
import { writeFileSync } from '../../../packages/runtime-js/src/builtins/fs.ts';

afterEach(() => resetSyncMirror());

describe('child_process.fork — advanced IPC', () => {
  it('rejects an unknown serialization discriminator before spawning', () => {
    writeFileSync('/advanced.js', '__process.send(1);');
    expect(() => fork('/advanced.js', [], { serialization: 'future' } as never)).toThrowError(
      expect.objectContaining({ name: 'TypeError', code: 'ERR_INVALID_ARG_VALUE' }),
    );
  });

  it('accepts the option and preserves structured-clone values from the child', async () => {
    writeFileSync(
      '/advanced.js',
      `__process.send({
        date: new Date('2020-01-02T03:04:05.000Z'),
        map: new Map([['key', 7]]),
        missing: [undefined],
        bytes: new Uint8Array([0, 128, 255]),
      });`,
    );
    const child = fork('/advanced.js', [], { serialization: 'advanced' });
    const messages: unknown[] = [];
    child.on('message', (message) => messages.push(message));
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));

    const result = messages[0] as {
      date: Date;
      map: Map<string, number>;
      missing: unknown[];
      bytes: Uint8Array;
    };
    expect(result.date instanceof Date).toBe(true);
    expect(result.date.toISOString()).toBe('2020-01-02T03:04:05.000Z');
    expect(result.map instanceof Map).toBe(true);
    expect(result.map.get('key')).toBe(7);
    expect(result.missing).toEqual([undefined]);
    expect(result.bytes instanceof Uint8Array).toBe(true);
    expect([...result.bytes]).toEqual([0, 128, 255]);
  });

  it('keeps the public channel usable after shared-view and hidden-Buffer ceilings', async () => {
    writeFileSync('/advanced.js', `__process.on('message', (message) => __process.send(message));`);
    const child = fork('/advanced.js', [], { serialization: 'advanced' });
    if (child.send === undefined) throw new Error('fork IPC send missing');
    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(() => child.send?.({ view: new Uint8Array(new SharedArrayBuffer(2)) })).toThrow(
        /child_process\.serialization\.advanced\.shared-view/u,
      );
      const map = new Map([['key', RiftyBuffer.from([1, 2])]]);
      Object.defineProperty(map, Symbol.iterator, { value: () => [][Symbol.iterator]() });
      expect(() => child.send?.({ map })).toThrow(
        /child_process\.serialization\.advanced\.Buffer/u,
      );

      const reply = new Promise<unknown>((resolve) => child.once('message', resolve));
      expect(child.send({ after: true })).toBe(true);
      expect(await reply).toEqual({ after: true });
    } finally {
      const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
      child.kill('SIGUSR2');
      await closed;
    }
  });
});
