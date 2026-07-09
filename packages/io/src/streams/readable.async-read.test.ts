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

  // Node contract (probed on real Node v24, parity case
  // stream/readable-async-read-contract): the RETURN VALUE of `_read` is
  // ignored — `reading` is cleared only by push(). A fulfilled no-push promise
  // must NOT re-trigger `_read`: the retrigger loop spun the realm's microtask
  // queue forever (starved timers + IPC — the PR-125 owner wedge).
  it('calls a no-push async _read once — no fulfilled-promise retrigger spin', async () => {
    let reads = 0;
    const readable = new Readable({
      objectMode: true,
      // The producer stops returning promises after 50 calls: an UNBOUNDED
      // no-push async read under the retrigger bug spins the microtask queue
      // forever and starves even vitest's own test timeout — the test must
      // fail on the call count, not wedge the worker.
      read() {
        reads += 1;
        if (reads > 50) return;
        return (async () => {})();
      },
    });
    readable.on('data', () => {});

    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 5);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(reads).toBe(1);
    expect(timerFired).toBe(true);
  });

  it('a chunk pushed while the promise is pending clears reading — next _read allowed', async () => {
    let reads = 0;
    const seen: unknown[] = [];
    const readable = new Readable({
      objectMode: true,
      read() {
        reads += 1;
        if (reads === 1) {
          this.push('a');
          return new Promise(() => {}); // pending forever — must not serialize reads
        }
      },
    });
    readable.on('data', (chunk) => seen.push(chunk));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seen).toEqual(['a']);
    expect(reads).toBe(2);
  });

  it('does NOT convert an async _read rejection into destroy/error (Node: unhandled rejection)', async () => {
    // The catch attaches IN THE SAME TURN the promise is created — the stream
    // must ignore the return value, so nothing else may observe the rejection
    // (on real Node an unobserved one crashes the process; in vitest it fails
    // the run as an unhandled error).
    let caught: string | null = null;
    const readable = new Readable({
      objectMode: true,
      read() {
        const p = (async () => {
          throw new Error('boom');
        })();
        p.catch((err) => {
          caught = (err as Error).message;
        });
        return p;
      },
    });
    let errorEmitted: string | null = null;
    readable.on('data', () => {});
    readable.on('error', (err) => {
      errorEmitted = (err as Error).message;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(caught).toBe('boom');
    expect(readable.destroyed).toBe(false);
    expect(errorEmitted).toBeNull();
  });

  it('a SYNC throw inside _read destroys with error — not thrown to the read() caller', async () => {
    const readable = new Readable({
      objectMode: true,
      read() {
        throw new Error('sync-boom');
      },
    });
    let errorEmitted: string | null = null;
    readable.on('error', (err) => {
      errorEmitted = (err as Error).message;
    });

    expect(() => readable.read(0)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(errorEmitted).toBe('sync-boom');
    expect(readable.destroyed).toBe(true);
  });
});
