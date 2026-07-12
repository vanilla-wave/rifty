import { describe, expect, it } from 'vitest';
import { Buffer } from '../buffer.ts';
import { Duplex } from './duplex.ts';
import { Transform } from './transform.ts';
import { Writable, type WritableOptions, type WriteChunk } from './writable.ts';

type Surface = 'Writable' | 'Duplex' | 'Transform';
type Target = Writable | Duplex | Transform;

interface SeenWrite {
  chunk: unknown;
  encoding: string;
}

function phase(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function chunkTag(chunk: unknown): string {
  if (typeof chunk === 'string') return `string:${chunk}`;
  if (Buffer.isBuffer(chunk)) {
    return `buffer:${Buffer.from(chunk as Uint8Array).toString('hex')}`;
  }
  if (chunk instanceof Uint8Array) return `uint8:${Buffer.from(chunk).toString('hex')}`;
  return `${typeof chunk}:${String(chunk)}`;
}

function makeTarget(surface: Surface, options: WritableOptions, seen: SeenWrite[]): Target {
  const observe = (chunk: unknown, encoding: string, callback: () => void): void => {
    seen.push({ chunk, encoding });
    callback();
  };
  if (surface === 'Writable') {
    return new Writable({ ...options, write: observe });
  }
  if (surface === 'Duplex') {
    return new Duplex({ ...options, read(): void {}, write: observe });
  }
  return new Transform({ ...options, transform: observe });
}

describe('Writable chunk and encoding admission', () => {
  it.each(
    (['Writable', 'Duplex', 'Transform'] as const).flatMap((surface) => [
      {
        label: `${surface} / byte / default`,
        surface,
        options: { objectMode: false },
        expectedChunk: 'buffer:e9',
        expectedEncoding: 'buffer',
      },
      {
        label: `${surface} / byte / decodeStrings false`,
        surface,
        options: { objectMode: false, decodeStrings: false },
        expectedChunk: 'string:é',
        expectedEncoding: 'latin1',
      },
      {
        label: `${surface} / object`,
        surface,
        options: { objectMode: true },
        expectedChunk: 'string:é',
        expectedEncoding: 'latin1',
      },
    ]),
  )('$label admits one Node chunk/encoding pair', async (row) => {
    const seen: SeenWrite[] = [];
    const target = makeTarget(row.surface, row.options, seen);

    target.write('é', 'latin1');
    await phase();

    expect(seen.map(({ chunk, encoding }) => ({ chunk: chunkTag(chunk), encoding }))).toEqual([
      { chunk: row.expectedChunk, encoding: row.expectedEncoding },
    ]);
    target.destroy();
  });

  it.each((['Writable', 'Duplex', 'Transform'] as const).map((surface) => ({ surface })))(
    '$surface accepts mixed-case byte encoding and reports buffer downstream',
    async ({ surface }) => {
      const seen: SeenWrite[] = [];
      const target = makeTarget(surface, { objectMode: false }, seen);

      target.write('é', 'UTF8');
      await phase();

      expect(seen.map(({ chunk, encoding }) => ({ chunk: chunkTag(chunk), encoding }))).toEqual([
        { chunk: 'buffer:c3a9', encoding: 'buffer' },
      ]);
      target.destroy();
    },
  );

  it.each(
    (['Writable', 'Duplex', 'Transform'] as const).flatMap((surface) => [
      {
        label: `${surface} / byte decodeStrings false`,
        surface,
        options: { objectMode: false, decodeStrings: false },
      },
      { label: `${surface} / object`, surface, options: { objectMode: true } },
    ]),
  )('$label preserves mixed-case encoding with the original string', async (row) => {
    const seen: SeenWrite[] = [];
    const target = makeTarget(row.surface, row.options, seen);

    target.write('é', 'UTF8');
    await phase();

    expect(seen.map(({ chunk, encoding }) => ({ chunk: chunkTag(chunk), encoding }))).toEqual([
      { chunk: 'string:é', encoding: 'UTF8' },
    ]);
    target.destroy();
  });

  it.each(
    (['Writable', 'Duplex', 'Transform'] as const).flatMap((surface) =>
      [undefined, false].map((decodeStrings) => ({
        label: `${surface} / ${decodeStrings === false ? 'false' : 'default'}`,
        surface,
        decodeStrings,
      })),
    ),
  )(
    '$label rejects an unknown byte encoding before dispatch',
    async ({ surface, decodeStrings }) => {
      const seen: SeenWrite[] = [];
      const target = makeTarget(
        surface,
        decodeStrings === undefined ? { objectMode: false } : { objectMode: false, decodeStrings },
        seen,
      );

      let thrown: unknown;
      try {
        target.write('x', 'wat');
      } catch (error) {
        thrown = error;
      }
      await phase();

      expect(thrown).toBeInstanceOf(TypeError);
      expect(thrown).toMatchObject({ code: 'ERR_UNKNOWN_ENCODING' });
      expect({ seen, length: target.writableLength }).toEqual({ seen: [], length: 0 });
      target.destroy();
    },
  );

  it.each((['Writable', 'Duplex', 'Transform'] as const).map((surface) => ({ surface })))(
    '$surface leaves object-mode unknown encoding untouched',
    async ({ surface }) => {
      const seen: SeenWrite[] = [];
      const target = makeTarget(surface, { objectMode: true }, seen);

      expect(() => target.write('x', 'wat')).not.toThrow();
      await phase();

      expect(seen.map(({ chunk, encoding }) => ({ chunk: chunkTag(chunk), encoding }))).toEqual([
        { chunk: 'string:x', encoding: 'wat' },
      ]);
      target.destroy();
    },
  );

  it.each((['Writable', 'Duplex'] as const).map((surface) => ({ surface })))(
    '$surface batches admitted pairs through one _writev',
    async ({ surface }) => {
      let batch: WriteChunk[] = [];
      let releaseFirst: (() => void) | undefined;
      const options: WritableOptions = {
        objectMode: false,
        write(_chunk, _encoding, callback): void {
          releaseFirst = callback;
        },
        writev(chunks, callback): void {
          batch = chunks;
          callback();
        },
      };
      const target =
        surface === 'Writable'
          ? new Writable(options)
          : new Duplex({ ...options, read(): void {} });

      target.write('hold', 'utf8');
      await phase();
      target.write('é', 'latin1');
      target.write('x', 'UTF8');
      releaseFirst?.();
      await phase();

      expect(batch.map(({ chunk, encoding }) => ({ chunk: chunkTag(chunk), encoding }))).toEqual([
        { chunk: 'buffer:e9', encoding: 'buffer' },
        { chunk: 'buffer:78', encoding: 'buffer' },
      ]);
      target.destroy();
    },
  );

  it.each(
    (['Writable', 'Duplex', 'Transform'] as const).flatMap((surface) =>
      [undefined, false].map((decodeStrings) => ({
        label: `${surface} / ${decodeStrings === false ? 'decodeStrings false' : 'default'}`,
        surface,
        decodeStrings,
      })),
    ),
  )(
    '$label wraps a byte-mode Uint8Array as a shared Buffer view',
    async ({ surface, decodeStrings }) => {
      const backing = new ArrayBuffer(6);
      const input = new Uint8Array(backing, 2, 2);
      input.set([1, 2]);
      const seen: SeenWrite[] = [];
      const target = makeTarget(
        surface,
        decodeStrings === undefined ? { objectMode: false } : { objectMode: false, decodeStrings },
        seen,
      );

      target.write(input, 'latin1');
      await phase();

      const admitted = seen[0]?.chunk as Uint8Array;
      expect({
        buffer: Buffer.isBuffer(admitted),
        distinct: admitted !== input,
        shared: admitted.buffer === input.buffer,
        offset: admitted.byteOffset,
        length: admitted.byteLength,
        bytes: Array.from(admitted),
        encoding: seen[0]?.encoding,
      }).toEqual({
        buffer: true,
        distinct: true,
        shared: true,
        offset: 2,
        length: 2,
        bytes: [1, 2],
        encoding: 'buffer',
      });
      input[0] = 9;
      expect(admitted[0]).toBe(9);
      admitted[1] = 8;
      expect(input[1]).toBe(8);
      target.destroy();
    },
  );

  it.each(
    (['Writable', 'Duplex', 'Transform'] as const).flatMap((surface) => [
      {
        label: `${surface} / byte Buffer`,
        surface,
        objectMode: false,
        decodeStrings: undefined,
        kind: 'Buffer' as const,
        expectedBuffer: true,
        expectedEncoding: 'buffer',
      },
      {
        label: `${surface} / byte Buffer / decodeStrings false`,
        surface,
        objectMode: false,
        decodeStrings: false,
        kind: 'Buffer' as const,
        expectedBuffer: true,
        expectedEncoding: 'buffer',
      },
      {
        label: `${surface} / object Buffer`,
        surface,
        objectMode: true,
        decodeStrings: undefined,
        kind: 'Buffer' as const,
        expectedBuffer: true,
        expectedEncoding: 'latin1',
      },
      {
        label: `${surface} / object Uint8Array`,
        surface,
        objectMode: true,
        decodeStrings: undefined,
        kind: 'Uint8Array' as const,
        expectedBuffer: false,
        expectedEncoding: 'latin1',
      },
    ]),
  )('$label preserves identity and Node encoding', async (row) => {
    const input = row.kind === 'Buffer' ? Buffer.from([1, 2]) : new Uint8Array([1, 2]);
    const seen: SeenWrite[] = [];
    const target = makeTarget(
      row.surface,
      row.decodeStrings === undefined
        ? { objectMode: row.objectMode }
        : { objectMode: row.objectMode, decodeStrings: row.decodeStrings },
      seen,
    );

    target.write(input, 'latin1');
    await phase();

    expect({
      same: seen[0]?.chunk === input,
      buffer: Buffer.isBuffer(seen[0]?.chunk),
      encoding: seen[0]?.encoding,
    }).toEqual({
      same: true,
      buffer: row.expectedBuffer,
      encoding: row.expectedEncoding,
    });
    target.destroy();
  });

  it.each(
    (['Writable', 'Duplex', 'Transform'] as const).flatMap((surface) =>
      [undefined, false].flatMap((decodeStrings) =>
        (['Buffer', 'Uint8Array'] as const).map((kind) => ({
          label: `${surface} / ${kind} / ${decodeStrings === false ? 'false' : 'default'}`,
          surface,
          decodeStrings,
          kind,
        })),
      ),
    ),
  )('$label validates byte encoding before non-string dispatch', async (row) => {
    const input = row.kind === 'Buffer' ? Buffer.from([1]) : new Uint8Array([1]);
    const seen: SeenWrite[] = [];
    const target = makeTarget(
      row.surface,
      row.decodeStrings === undefined
        ? { objectMode: false }
        : { objectMode: false, decodeStrings: row.decodeStrings },
      seen,
    );

    let thrown: unknown;
    try {
      target.write(input, 'wat');
    } catch (error) {
      thrown = error;
    }
    await phase();

    expect(thrown).toBeInstanceOf(TypeError);
    expect(thrown).toMatchObject({ code: 'ERR_UNKNOWN_ENCODING' });
    expect({ seen, length: target.writableLength }).toEqual({ seen: [], length: 0 });
    target.destroy();
  });

  it.each((['Writable', 'Duplex'] as const).map((adapter) => ({ label: adapter, adapter })))(
    '$label fromWeb inherits core encoding validation and admission',
    async ({ adapter }) => {
      const seen: unknown[] = [];
      const web = new WritableStream({ write: (chunk) => void seen.push(chunk) });
      const target =
        adapter === 'Writable'
          ? Writable.fromWeb(web)
          : Duplex.fromWeb({ readable: new ReadableStream(), writable: web });

      let thrown: unknown;
      try {
        target.write('x', 'wat');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TypeError);
      expect(thrown).toMatchObject({ code: 'ERR_UNKNOWN_ENCODING' });
      target.write('é', 'UTF8');
      await phase();

      expect(seen.map(chunkTag)).toEqual(['buffer:c3a9']);
      target.destroy();
    },
  );
});
