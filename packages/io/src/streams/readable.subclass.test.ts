import { describe, expect, it } from 'vitest';
import { Readable } from './readable.ts';

describe('Readable subclass producer hook', () => {
  it('drives a prototype _read override when no constructor read option is supplied', async () => {
    class EntryStream extends Readable {
      calls = 0;

      override _read(_size: number): void {
        this.calls += 1;
        this.push({ name: 'src' });
        this.push(null);
      }
    }

    const stream = new EntryStream({ objectMode: true });
    const entries: unknown[] = [];
    stream.on('data', (entry) => entries.push(entry));

    await new Promise<void>((resolve) => stream.on('end', () => resolve()));

    expect(stream.calls).toBe(1);
    expect(entries).toEqual([{ name: 'src' }]);
  });

  it('lets a constructor read option override the prototype hook', async () => {
    class EntryStream extends Readable {
      override _read(_size: number): void {
        this.push('prototype');
        this.push(null);
      }
    }

    const stream = new EntryStream({
      objectMode: true,
      read(): void {
        this.push('option');
        this.push(null);
      },
    });
    const entries: unknown[] = [];
    stream.on('data', (entry) => entries.push(entry));
    await new Promise<void>((resolve) => stream.on('end', () => resolve()));

    expect(entries).toEqual(['option']);
  });

  it('exposes Node-shaped loud failure when no producer hook exists', () => {
    const stream = new Readable();
    expect(() => stream._read(1)).toThrow(
      expect.objectContaining({
        code: 'ERR_METHOD_NOT_IMPLEMENTED',
        message: 'The _read() method is not implemented',
      }),
    );
  });
});
