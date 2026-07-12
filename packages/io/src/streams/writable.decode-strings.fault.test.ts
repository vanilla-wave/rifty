import { describe, expect, it } from 'vitest';
import { Buffer } from '../buffer.ts';
import { Duplex } from './duplex.ts';
import { Transform } from './transform.ts';
import { Writable, type WritableOptions } from './writable.ts';

function phase(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function sinkTag(value: unknown): string {
  if (typeof value === 'string') return `string:${value}`;
  if (Buffer.isBuffer(value)) {
    return `buffer:${Buffer.from(value as Uint8Array).toString('hex')}`;
  }
  return `${typeof value}:${String(value)}`;
}

const coreDecodeRows = [
  { setting: 'default', decodeStrings: undefined, state: true },
  { setting: 'true', decodeStrings: true, state: true },
  { setting: 'false', decodeStrings: false, state: false },
  { setting: 'zero', decodeStrings: 0, state: true },
  { setting: 'null', decodeStrings: null, state: true },
] as const;

const adapterDecodeRows = [
  { setting: 'default', decodeStrings: undefined, state: true },
  { setting: 'true', decodeStrings: true, state: true },
  { setting: 'false', decodeStrings: false, state: false },
] as const;

describe('Writable decodeStrings ownership', () => {
  it.each(
    (['Writable', 'Duplex', 'Transform'] as const).flatMap((stream) =>
      [true, false].flatMap((objectMode) =>
        coreDecodeRows.map((row) => ({
          label: `${stream} / ${objectMode ? 'object' : 'byte'} / ${row.setting}`,
          stream,
          objectMode,
          ...row,
        })),
      ),
    ),
  )(
    '$label normalizes before core HWM accounting',
    async ({ stream, objectMode, decodeStrings, state: expectedState }) => {
      let sinkValue: unknown;
      let release: (() => void) | undefined;
      const options = {
        highWaterMark: 2,
        objectMode,
        ...(decodeStrings === undefined ? {} : { decodeStrings }),
        write(value: unknown, _encoding: string, callback: () => void): void {
          sinkValue = value;
          release = callback;
        },
      } as unknown as WritableOptions;
      const target =
        stream === 'Writable'
          ? new Writable(options)
          : stream === 'Duplex'
            ? new Duplex({ ...options, read(): void {} })
            : new Transform({
                ...options,
                transform(value, _encoding, callback): void {
                  sinkValue = value;
                  release = callback;
                },
              });

      const returned = target.write('é', 'utf8');
      const length = target.writableLength;
      const stateDecodeStrings = (
        target._writableState as typeof target._writableState & { decodeStrings?: boolean }
      ).decodeStrings;
      await phase();

      const shouldDecode = !objectMode && expectedState;
      expect({ returned, length, stateDecodeStrings, sink: sinkTag(sinkValue) }).toEqual({
        returned: !shouldDecode,
        length: shouldDecode ? 2 : 1,
        stateDecodeStrings: expectedState,
        sink: shouldDecode ? 'buffer:c3a9' : 'string:é',
      });
      release?.();
      await phase();
      target.destroy();
    },
  );

  describe('fromWeb adapters', () => {
    it.each(
      (['Writable', 'Duplex'] as const).flatMap((adapter) =>
        [true, false].flatMap((objectMode) =>
          adapterDecodeRows.map((row) => ({
            label: `${adapter} / ${objectMode ? 'object' : 'byte'} / ${row.setting}`,
            adapter,
            objectMode,
            ...row,
          })),
        ),
      ),
    )(
      '$label normalizes before HWM accounting',
      async ({ adapter, objectMode, decodeStrings, state: expectedState }) => {
        let sinkValue: unknown;
        const writable = new WritableStream({
          write(value): void {
            sinkValue = value;
          },
        });
        const options = {
          highWaterMark: 2,
          objectMode,
          ...(decodeStrings === undefined ? {} : { decodeStrings }),
        };
        const target =
          adapter === 'Writable'
            ? Writable.fromWeb(writable, options)
            : Duplex.fromWeb(
                { readable: new ReadableStream({ start(): void {} }), writable },
                options,
              );
        let callbackError: unknown;

        const returned = target.write('é', 'utf8', (error) => {
          callbackError = error;
        });
        const length = target.writableLength;
        const stateDecodeStrings = (
          target._writableState as typeof target._writableState & { decodeStrings?: boolean }
        ).decodeStrings;
        await phase();

        const shouldDecode = !objectMode && expectedState;
        expect({
          returned,
          length,
          stateDecodeStrings,
          sink: sinkTag(sinkValue),
          callbackError,
        }).toEqual({
          returned: !shouldDecode,
          length: shouldDecode ? 2 : 1,
          stateDecodeStrings: expectedState,
          sink: shouldDecode ? 'buffer:c3a9' : 'string:é',
          callbackError: undefined,
        });
        target.destroy();
      },
    );

    it.each(['yes', 0, null])(
      'Writable.fromWeb rejects non-boolean decodeStrings=%j',
      (decodeStrings) => {
        expect(() => Writable.fromWeb(new WritableStream(), { decodeStrings } as never)).toThrow(
          TypeError,
        );
      },
    );

    it.each([0, null])(
      'Duplex.fromWeb coerces decodeStrings=%j to true in the core',
      async (decodeStrings) => {
        let sinkValue: unknown;
        const writable = new WritableStream({
          write(value): void {
            sinkValue = value;
          },
        });
        const target = Duplex.fromWeb({ readable: new ReadableStream(), writable }, {
          highWaterMark: 2,
          objectMode: false,
          decodeStrings,
        } as never);

        const returned = target.write('é', 'utf8');
        const length = target.writableLength;
        const stateDecodeStrings = (
          target._writableState as typeof target._writableState & { decodeStrings?: boolean }
        ).decodeStrings;
        await phase();

        expect({ returned, length, stateDecodeStrings, sink: sinkTag(sinkValue) }).toEqual({
          returned: false,
          length: 2,
          stateDecodeStrings: true,
          sink: 'buffer:c3a9',
        });
        target.destroy();
      },
    );
  });
});
