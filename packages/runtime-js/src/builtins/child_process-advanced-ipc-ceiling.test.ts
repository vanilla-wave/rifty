/**
 * ADR-0448 explicit gaps: values Node's v8 serializer writes but a browser
 * structured clone cannot carry Node's way are named `NotImplementedError`s at
 * `send()`, never a silent different value. Node's own results for the same
 * values: evidence §Ceilings. The Chromium-only forms (platform objects the
 * browser clones or refuses) are `tests/browser-unit/advanced-ipc.spec.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Buffer } from './buffer.ts';
import { fork } from './child_process.ts';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';

afterEach(() => resetSyncMirror());

/** Detaches `buffer` (a view over it must exist first: construction then throws). */
function detach<T>(buffer: ArrayBuffer, holder: T): T {
  structuredClone(buffer, { transfer: [buffer] });
  return holder;
}

/**
 * Sends `value` to an echo child, then a plain `after` message: the refusal,
 * whether the next `send()` succeeds, and every label the child echoed back
 * (only `after` when the refused send posted nothing).
 */
async function refuseThenSend(value: () => unknown): Promise<{
  name: string;
  feature: unknown;
  sent: unknown;
  received: unknown[];
}> {
  writeFileSync(
    '/advanced-echo.js',
    "process.on('message', (message) => process.send(message.label));",
  );
  const child = fork('/advanced-echo.js', [], { serialization: 'advanced' });
  try {
    const received: unknown[] = [];
    const after = new Promise<void>((resolve) => {
      child.on('message', (label) => {
        received.push(label);
        if (label === 'after') resolve();
      });
    });
    let refusal = { name: 'no-throw', feature: null as unknown };
    try {
      child.send?.({ label: 'refused', value: value() });
    } catch (error) {
      refusal = { name: (error as Error).name, feature: (error as { feature?: unknown }).feature };
    }
    const sent = child.send?.({ label: 'after' });
    await after;
    return { ...refusal, sent, received };
  } finally {
    child.kill();
  }
}

const refusedByName = (feature: string) => ({
  name: 'NotImplementedError',
  feature: `child_process.serialization.advanced.${feature}`,
  sent: true,
  received: ['after'],
});

describe('advanced fork IPC ceilings (ADR-0448)', () => {
  it.each([
    ['a Blob', () => ({ blob: new Blob(['x']) })],
    ['a DOMException', () => ({ error: new DOMException('m', 'AbortError') })],
    ['a URL', () => ({ url: new URL('https://example.test/') })],
    ['an untransferred MessagePort', () => ({ port: new MessageChannel().port1 })],
  ])(
    'refuses %s as a host object, posts nothing, keeps the channel usable',
    async (_label, value) => {
      expect(await refuseThenSend(value)).toEqual(refusedByName('host-object'));
    },
  );

  it.each([
    [
      'a detached ArrayBuffer',
      () => {
        const buffer = new ArrayBuffer(4);
        return detach(buffer, { buffer });
      },
    ],
    [
      'a view over a detached ArrayBuffer',
      () => {
        const buffer = new ArrayBuffer(4);
        return detach(buffer, { view: new Uint8Array(buffer) });
      },
    ],
  ])('refuses %s by name (Node reports the two differently)', async (_label, value) => {
    expect(await refuseThenSend(value)).toEqual(refusedByName('detached-array-buffer'));
  });

  it.each([
    [
      'an own getter beside a Buffer',
      () => ({
        get count() {
          return 1;
        },
        data: Buffer.from('x'),
      }),
    ],
    [
      'a getter that returns a Buffer',
      () => ({
        get data() {
          return Buffer.from('x');
        },
      }),
    ],
    [
      'a getter beside a Float64Array',
      () => ({
        get count() {
          return 1;
        },
        numbers: new Float64Array([1]),
      }),
    ],
  ])('refuses %s: no Buffer brand is recoverable behind an accessor', async (_label, value) => {
    expect(await refuseThenSend(value)).toEqual(refusedByName('accessor-with-view'));
  });
});
