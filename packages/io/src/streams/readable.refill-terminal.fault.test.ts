import { describe, expect, it } from 'vitest';
import { Buffer } from '../buffer.ts';
import { Duplex } from './duplex.ts';
import { Readable } from './readable.ts';

function phase(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function waitForEnd(source: Readable, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Readable did not end: ${label}`)), 250);
    source.once('end', () => {
      clearTimeout(timer);
      resolve();
    });
    source.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

const filteredChunks = [
  { label: 'undefined', chunk: undefined },
  { label: 'empty string', chunk: '' },
  { label: 'empty Uint8Array', chunk: new Uint8Array(0) },
] as const;

describe('Readable bounded filtered refill', () => {
  it.each(
    filteredChunks.flatMap(({ label, chunk }) =>
      ([0, 1] as const).map((highWaterMark) => ({
        label: `${label} / HWM ${highWaterMark}`,
        chunk,
        highWaterMark,
      })),
    ),
  )('$label stops after a finite no-progress refill', async ({ chunk, highWaterMark }) => {
    let calls = 0;
    const source = new Readable({
      highWaterMark,
      read(): void {
        calls += 1;
        // Finite fault injection: an unbounded implementation reaches EOF
        // instead of hanging this test; Node stops before the sixth call.
        if (calls <= 5) this.push(chunk);
        else this.push(null);
      },
    });

    source.read(0);
    await phase();
    await phase();
    await phase();
    await phase();

    expect({
      calls,
      ended: source._readableState.ended,
      reading: source._readableState.reading,
      length: source.readableLength,
      bufferedEntries: source._readableState.buffer.length,
    }).toEqual({
      calls: highWaterMark === 0 ? 1 : 2,
      ended: false,
      reading: false,
      length: 0,
      bufferedEntries: 0,
    });
    source.destroy();
  });

  it('coalesces multiple filtered pushes from one hook into one refill turn', async () => {
    let calls = 0;
    const source = new Readable({
      highWaterMark: 1,
      read(): void {
        calls += 1;
        if (calls <= 5) {
          this.push(undefined);
          this.push('');
          this.push(new Uint8Array(0));
        } else {
          this.push(null);
        }
      },
    });

    source.read(0);
    await phase();
    await phase();
    await phase();
    await phase();

    expect({
      calls,
      ended: source._readableState.ended,
      reading: source._readableState.reading,
      length: source.readableLength,
      bufferedEntries: source._readableState.buffer.length,
    }).toEqual({ calls: 2, ended: false, reading: false, length: 0, bufferedEntries: 0 });
    source.destroy();
  });

  it.each([0, 1])(
    'keeps flowing demand alive through a filtered chunk at HWM %i',
    async (highWaterMark) => {
      let calls = 0;
      const source = new Readable({
        highWaterMark,
        read(): void {
          calls += 1;
          if (calls === 1) this.push('');
          else if (calls === 2) this.push('x');
          else this.push(null);
        },
      });
      const seen: unknown[] = [];
      source.on('data', (chunk) => seen.push(chunk));

      await waitForEnd(source, `flowing filtered HWM ${highWaterMark}`);

      expect({
        calls,
        seen: seen.map((chunk) => String(chunk)),
        ended: source.readableEnded,
        length: source.readableLength,
      }).toEqual({ calls: 3, seen: ['x'], ended: true, length: 0 });
    },
  );

  it.each(['EOF', 'destroy'] as const)(
    'terminal %s preempts an already queued filtered refill',
    async (terminal) => {
      let calls = 0;
      const events: string[] = [];
      const overflow = new Error('unexpected second terminal-race read');
      const source = new Readable({
        highWaterMark: 1,
        read(): void {
          calls += 1;
          if (calls === 1) this.push('');
          else throw overflow;
        },
      });
      source.on('end', () => events.push('end'));
      source.on('error', (error) => events.push(error === overflow ? 'error:overflow' : 'error'));
      source.on('close', () => events.push('close'));

      source.read(0);
      if (terminal === 'EOF') source.push(null);
      else source.destroy();
      await phase();
      await phase();

      expect({
        calls,
        events,
        destroyed: source.destroyed,
        ended: source._readableState.ended,
        endEmitted: source._readableState.endEmitted,
        reading: source._readableState.reading,
      }).toEqual(
        terminal === 'EOF'
          ? {
              calls: 1,
              events: [],
              destroyed: false,
              ended: true,
              endEmitted: false,
              reading: false,
            }
          : {
              calls: 1,
              events: ['close'],
              destroyed: true,
              ended: false,
              endEmitted: false,
              reading: false,
            },
      );
      if (!source.destroyed) source.destroy();
    },
  );

  it('destroys once with raw identity when the queued refill hook throws', async () => {
    const marker = { fault: 'queued-refill' };
    let calls = 0;
    const events: string[] = [];
    let emittedError: unknown;
    const source = new Readable({
      highWaterMark: 1,
      read(): void {
        calls += 1;
        if (calls === 1) this.push('');
        else throw marker;
      },
    });
    source.on('error', (error) => {
      emittedError = error;
      events.push('error');
    });
    source.on('close', () => events.push('close'));

    source.read(0);
    await phase();
    await phase();

    expect({
      calls,
      events,
      destroyed: source.destroyed,
      reading: source._readableState.reading,
      erroredIdentity: (source._readableState.errored as unknown) === marker,
      emittedIdentity: emittedError === marker,
    }).toEqual({
      calls: 2,
      events: ['error', 'close'],
      destroyed: true,
      reading: true,
      erroredIdentity: true,
      emittedIdentity: true,
    });
  });
});

describe('Readable demand capacity guard', () => {
  it('does not dispatch read(0) while the object buffer is at HWM', () => {
    let calls = 0;
    const source = new Readable({
      objectMode: true,
      highWaterMark: 1,
      read(): void {
        calls += 1;
        this.push('generated');
      },
    });
    source.push('prebuffered');

    expect(source.read(0)).toBeNull();

    expect({
      calls,
      length: source.readableLength,
      reading: source._readableState.reading,
    }).toEqual({
      calls: 0,
      length: 1,
      reading: false,
    });
    source.destroy();
  });

  it('does not dispatch from a non-draining readable listener while the buffer is at HWM', async () => {
    let calls = 0;
    let readableEvents = 0;
    const source = new Readable({
      objectMode: true,
      highWaterMark: 1,
      read(): void {
        calls += 1;
        this.push('generated');
      },
    });
    source.push('prebuffered');
    source.on('readable', () => {
      readableEvents += 1;
    });

    await phase();

    expect({
      calls,
      readableEvents,
      length: source.readableLength,
      reading: source._readableState.reading,
    }).toEqual({ calls: 0, readableEvents: 1, length: 1, reading: false });
    source.destroy();
  });

  it('does not issue another fromWeb reader read when a readable observer sees a full buffer', async () => {
    let readerCalls = 0;
    let controller!: ReadableStreamDefaultController<unknown>;
    const web = new ReadableStream<unknown>(
      {
        start(next): void {
          controller = next;
        },
      },
      { highWaterMark: 0 },
    );
    const getReader = web.getReader.bind(web);
    Object.defineProperty(web, 'getReader', {
      value: (): ReadableStreamDefaultReader<unknown> => {
        const reader = getReader();
        return {
          closed: reader.closed,
          read(): Promise<ReadableStreamReadResult<unknown>> {
            readerCalls += 1;
            return reader.read();
          },
          cancel(reason?: unknown): Promise<void> {
            return reader.cancel(reason);
          },
          releaseLock(): void {
            reader.releaseLock();
          },
        } as ReadableStreamDefaultReader<unknown>;
      },
    });
    const source = Readable.fromWeb(web, { highWaterMark: 1 });

    source.read(0);
    controller.enqueue(new Uint8Array([1]));
    await phase();
    const before = {
      readerCalls,
      length: source.readableLength,
      reading: source._readableState.reading,
    };

    let readableEvents = 0;
    source.on('readable', () => {
      readableEvents += 1;
    });
    await phase();
    const after = {
      readerCalls,
      length: source.readableLength,
      reading: source._readableState.reading,
    };
    source.destroy();
    await phase();

    expect({ before, after, readableEvents }).toEqual({
      before: { readerCalls: 1, length: 1, reading: false },
      after: { readerCalls: 1, length: 1, reading: false },
      readableEvents: 1,
    });
  });
});

describe('Readable plain Uint8Array admission aliasing', () => {
  it('wraps an offset view in a distinct Buffer over the same backing store', () => {
    const backing = new ArrayBuffer(6);
    const input = new Uint8Array(backing, 2, 2);
    input.set([7, 8]);
    const source = new Readable({ read(): void {} });

    source.push(input);
    input[0] = 9;
    const admitted = source.read(2);

    expect(admitted).toBeInstanceOf(Uint8Array);
    const view = admitted as Uint8Array;
    expect({
      isBuffer: Buffer.isBuffer(view),
      distinctWrapper: view !== input,
      sharedBacking: view.buffer === backing,
      byteOffset: view.byteOffset,
      bytes: Array.from(view),
    }).toEqual({
      isBuffer: true,
      distinctWrapper: true,
      sharedBacking: true,
      byteOffset: 2,
      bytes: [9, 8],
    });

    view[1] = 10;
    expect(input[1]).toBe(10);
    source.destroy();
  });

  it.each(['Readable', 'Duplex'] as const)(
    '%s.fromWeb preserves the offset view backing through core push admission',
    async (adapter) => {
      const backing = new ArrayBuffer(6);
      const input = new Uint8Array(backing, 2, 2);
      input.set([7, 8]);
      const web = new ReadableStream<Uint8Array>({
        start(controller): void {
          controller.enqueue(input);
          controller.close();
        },
      });
      const source =
        adapter === 'Readable'
          ? Readable.fromWeb(web)
          : Duplex.fromWeb({ readable: web, writable: new WritableStream() });

      expect(source.read(2)).toBeNull();
      await phase();
      input[0] = 9;
      const admitted = source.read(2) as Uint8Array;

      expect({
        isBuffer: Buffer.isBuffer(admitted),
        distinctWrapper: admitted !== input,
        sharedBacking: admitted.buffer === backing,
        byteOffset: admitted.byteOffset,
        bytes: Array.from(admitted),
      }).toEqual({
        isBuffer: true,
        distinctWrapper: true,
        sharedBacking: true,
        byteOffset: 2,
        bytes: [9, 8],
      });
      admitted[1] = 10;
      expect(input[1]).toBe(10);
      source.destroy();
    },
  );
});

describe('Readable EOF and destroy terminal order', () => {
  it('push after EOF destroys with the coded error and suppresses end', async () => {
    const source = new Readable({ read(): void {} });
    const events: string[] = [];
    let emittedError: unknown;
    source.on('end', () => events.push('end'));
    source.on('error', (error) => {
      emittedError = error;
      events.push(`error:${errorCode(error)}`);
    });
    source.on('close', () => events.push('close'));

    source.push(null);
    const returned = source.push(new Uint8Array([1]));
    await phase();

    expect({
      returned,
      events,
      destroyed: source.destroyed,
      ended: source._readableState.ended,
      endEmitted: source._readableState.endEmitted,
      erroredCode: errorCode(source._readableState.errored),
      erroredIdentity: source._readableState.errored === emittedError,
    }).toEqual({
      returned: false,
      events: ['error:ERR_STREAM_PUSH_AFTER_EOF', 'close'],
      destroyed: true,
      ended: true,
      endEmitted: false,
      erroredCode: 'ERR_STREAM_PUSH_AFTER_EOF',
      erroredIdentity: true,
    });
  });

  it('push(null) followed by destroy emits close without end', async () => {
    const source = new Readable({ read(): void {} });
    const events: string[] = [];
    source.on('end', () => events.push('end'));
    source.on('close', () => events.push('close'));

    source.push(null);
    source.destroy();
    await phase();

    expect({
      events,
      destroyed: source.destroyed,
      ended: source._readableState.ended,
      endEmitted: source._readableState.endEmitted,
      erroredCode: errorCode(source._readableState.errored),
    }).toEqual({
      events: ['close'],
      destroyed: true,
      ended: true,
      endEmitted: false,
      erroredCode: undefined,
    });
  });

  it('destroy followed by push(null) emits close without end', async () => {
    const source = new Readable({ read(): void {} });
    const events: string[] = [];
    source.on('end', () => events.push('end'));
    source.on('close', () => events.push('close'));

    source.destroy();
    const returned = source.push(null);
    await phase();

    expect({
      returned,
      events,
      destroyed: source.destroyed,
      ended: source._readableState.ended,
      endEmitted: source._readableState.endEmitted,
      erroredCode: errorCode(source._readableState.errored),
    }).toEqual({
      returned: false,
      events: ['close'],
      destroyed: true,
      ended: true,
      endEmitted: false,
      erroredCode: undefined,
    });
  });
});
