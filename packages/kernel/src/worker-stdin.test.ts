import { describe, expect, it } from 'vitest';
import { WORKER_INPUT_CAPACITY, WorkerInput } from './worker-stdin.ts';

describe('physical worker input ownership', () => {
  it('keeps a large write pending until bounded input is consumed, then preserves EOF', async () => {
    const input = new WorkerInput(() => {});
    const bytes = Uint8Array.from({ length: WORKER_INPUT_CAPACITY + 3 }, (_, i) => i % 251);
    let written = false;
    input.write(bytes, () => {
      written = true;
    });
    expect(written).toBe(false);
    const prefix = await input.read(3, true);
    expect(prefix).toEqual(bytes.slice(0, 3));
    expect(written).toBe(true);
    input.end();
    const chunks: number[] = [...prefix!];
    for (;;) {
      const chunk = await input.read(WORKER_INPUT_CAPACITY, true);
      if (!chunk?.length) break;
      chunks.push(...chunk);
    }
    expect(Uint8Array.from(chunks)).toEqual(bytes);
    expect(await input.read(1, true)).toEqual(new Uint8Array());
  });
  it('readiness is not a second byte owner and an awaited read sees the next write', async () => {
    let signals = 0;
    const input = new WorkerInput(() => {
      signals++;
    });
    expect(input.read(2, false)).toBe(null);
    const read = input.read(2, true);
    input.write(new Uint8Array([1, 2, 3]), () => {});
    expect(await read).toEqual(new Uint8Array([1, 2]));
    expect(await input.read(2, false)).toEqual(new Uint8Array([3]));
    expect(input.read(1, false)).toBe(null);
    expect(signals).toBe(1);
  });
  it('peer close settles both kinds of pending operation loudly', async () => {
    const reading = new WorkerInput(() => {});
    const read = reading.read(1, true);
    const rejection = expect(read).rejects.toMatchObject({ code: 'EBADF' });
    reading.close();
    await rejection;
    const writing = new WorkerInput(() => {});
    let error: unknown;
    writing.write(new Uint8Array(WORKER_INPUT_CAPACITY + 1), (e) => {
      error = e;
    });
    writing.close();
    expect(error).toMatchObject({ code: 'EPIPE' });
    expect(() => writing.read(1, false)).toThrow(/EBADF/);
  });
});
