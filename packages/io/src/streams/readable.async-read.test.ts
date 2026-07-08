import { describe, expect, it } from 'vitest';
import { Readable } from './readable.ts';

describe('Readable async _read()', () => {
  it('delivers chunks pushed after an awaited read implementation in flowing mode', async () => {
    let reads = 0;
    const readable = new Readable({
      objectMode: true,
      async read() {
        reads += 1;
        if (reads > 1) return;
        await Promise.resolve();
        this.push('src');
        this.push('main.js');
        this.push(null);
      },
    });

    const seen: unknown[] = [];
    const ended = new Promise<void>((resolve, reject) => {
      readable.on('data', (chunk) => seen.push(chunk));
      readable.on('end', () => resolve());
      readable.on('error', reject);
    });

    await ended;

    expect(seen).toEqual(['src', 'main.js']);
    expect(reads).toBe(1);
  });

  it('calls a subclass _read implementation when no read option is supplied', async () => {
    class ReaddirpLikeReadable extends Readable {
      readCount = 0;

      override async _read(_size: number) {
        this.readCount += 1;
        await Promise.resolve();
        this.push('src');
        this.push('src/main.js');
        this.push(null);
      }
    }

    const readable = new ReaddirpLikeReadable({ objectMode: true });
    const seen: unknown[] = [];
    let ended = false;
    readable.on('data', (chunk) => seen.push(chunk));
    readable.on('end', () => {
      ended = true;
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(seen).toEqual(['src', 'src/main.js']);
    expect(ended).toBe(true);
    expect(readable.readCount).toBe(1);
  });

  it('does not re-enter an async _read before the awaited producer pushes', async () => {
    let reads = 0;
    const readable = new Readable({
      objectMode: true,
      async read() {
        reads += 1;
        await Promise.resolve();
        this.push('src');
        this.push(null);
      },
    });

    readable.read(0);
    readable.read(0);
    await Promise.resolve();

    expect(reads).toBe(1);
  });
});
