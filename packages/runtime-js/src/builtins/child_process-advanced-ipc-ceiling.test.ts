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

function advancedChild(): ReturnType<typeof fork> {
  writeFileSync('/advanced-idle.js', "process.on('message', () => {});");
  return fork('/advanced-idle.js', [], { serialization: 'advanced' });
}

/** Detaches `buffer` (a view over it must exist first: construction then throws). */
function detach<T>(buffer: ArrayBuffer, holder: T): T {
  structuredClone(buffer, { transfer: [buffer] });
  return holder;
}

function refusal(send: () => unknown): { name: string; feature: unknown } {
  try {
    send();
  } catch (error) {
    return {
      name: (error as Error).name,
      feature: (error as { feature?: unknown }).feature,
    };
  }
  return { name: 'no-throw', feature: null };
}

describe('advanced fork IPC ceilings (ADR-0448)', () => {
  it.each([
    ['a Blob', () => ({ blob: new Blob(['x']) })],
    ['a DOMException', () => ({ error: new DOMException('m', 'AbortError') })],
    ['a URL', () => ({ url: new URL('https://example.test/') })],
    ['an untransferred MessagePort', () => ({ port: new MessageChannel().port1 })],
  ])('refuses %s as a host object and keeps the channel usable', (_label, value) => {
    const child = advancedChild();
    try {
      expect(refusal(() => child.send?.(value()))).toEqual({
        name: 'NotImplementedError',
        feature: 'child_process.serialization.advanced.host-object',
      });
      expect(child.send?.({ after: true })).toBe(true);
    } finally {
      child.kill();
    }
  });

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
  ])('refuses %s by name (Node reports the two differently)', (_label, value) => {
    const child = advancedChild();
    try {
      expect(refusal(() => child.send?.(value()))).toEqual({
        name: 'NotImplementedError',
        feature: 'child_process.serialization.advanced.detached-array-buffer',
      });
    } finally {
      child.kill();
    }
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
  ])('refuses %s: no Buffer brand is recoverable behind an accessor', (_label, value) => {
    const child = advancedChild();
    try {
      expect(refusal(() => child.send?.(value()))).toEqual({
        name: 'NotImplementedError',
        feature: 'child_process.serialization.advanced.accessor-with-view',
      });
    } finally {
      child.kill();
    }
  });
});
