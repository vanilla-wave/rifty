import type { ParityCase } from '../../src/types.ts';

/**
 * Raw ArrayBuffer/SharedArrayBuffer input aliases its backing store while a
 * TypedArray input copies. WebAssembly consumers rely on that ownership split:
 * writes made after Buffer creation must remain visible through the raw-store
 * view. Omitted length tracks resizable/growable stores; explicit length stays
 * fixed. Offset/length coercion and bounds errors are pinned at the same boundary.
 */
const c: ParityCase = {
  code: `
    const { Buffer, isAscii, isUtf8 } = require('node:buffer');

    const ab = Uint8Array.from([0, 1, 2, 3, 4]).buffer;
    const raw = new Uint8Array(ab);
    const aliased = Buffer.from(ab, 1, 3);
    raw[1] = 9;
    aliased[1] = 8;
    console.log('ab', aliased.buffer === ab, aliased.byteOffset, aliased.toString('hex'), Array.from(raw).join(','));

    const typed = new Uint8Array([1, 2, 3]);
    const copied = Buffer.from(typed);
    typed[0] = 9;
    copied[1] = 8;
    console.log('typed', copied.buffer === typed.buffer, Array.from(typed).join(','), copied.toString('hex'));

    const resizable = new ArrayBuffer(4, { maxByteLength: 8 });
    new Uint8Array(resizable).set([1, 2, 3, 4]);
    const tracked = Buffer.from(resizable);
    const trackedOffset = Buffer.from(resizable, 1);
    const fixed = Buffer.from(resizable, 0, 4);
    console.log('rab-initial', tracked.length, trackedOffset.length, fixed.length);
    resizable.resize(8);
    new Uint8Array(resizable).set([5, 6, 7, 8], 4);
    console.log('rab-grown', tracked.length, trackedOffset.length, fixed.length, tracked.toString('hex'), fixed.toString('hex'));
    resizable.resize(2);
    console.log('rab-shrunk', tracked.length, trackedOffset.length, fixed.length, tracked.toString('hex'));

    const growable = new SharedArrayBuffer(4, { maxByteLength: 8 });
    const trackedShared = Buffer.from(growable);
    const fixedShared = Buffer.from(growable, 0, 4);
    growable.grow(8);
    console.log('gsab-grown', trackedShared.length, fixedShared.length);

    const shared = new SharedArrayBuffer(5);
    const sharedRaw = new Uint8Array(shared);
    sharedRaw.set([0, 1, 2, 3, 4]);
    const sharedView = Buffer.from(shared, 1, 3);
    sharedRaw[1] = 9;
    sharedView[1] = 8;
    console.log('sab', sharedView.buffer === shared, sharedView.byteOffset, sharedView.toString('hex'), Array.from(sharedRaw).join(','));
    console.log('sab-predicates', isUtf8(shared), isAscii(shared));

    const memory = new WebAssembly.Memory({ initial: 1 });
    const wasmView = Buffer.from(memory.buffer, 0, 3);
    new Uint8Array(memory.buffer, 0, 3).set([0x61, 0x62, 0x63]);
    console.log('wasm', wasmView.buffer === memory.buffer, wasmView.toString());

    const growMemory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
    const beforeGrow = growMemory.buffer;
    const growView = Buffer.from(beforeGrow, 0, 3);
    growMemory.grow(1);
    console.log('wasm-grow', beforeGrow.byteLength, growMemory.buffer.byteLength, growView.buffer === beforeGrow, growView.buffer === growMemory.buffer, growView.length, growView.toString());

    try {
      const sharedMemory = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
      const beforeSharedGrow = sharedMemory.buffer;
      const sharedGrowView = Buffer.from(beforeSharedGrow, 1, 3);
      new Uint8Array(beforeSharedGrow).set([0, 1, 2, 3]);
      const oldPages = sharedMemory.grow(1);
      new Uint8Array(sharedMemory.buffer)[1] = 9;
      console.log('shared-grow', oldPages, beforeSharedGrow.byteLength, sharedMemory.buffer.byteLength, sharedGrowView.buffer === beforeSharedGrow, sharedGrowView.buffer === sharedMemory.buffer, sharedGrowView.length, sharedGrowView.toString('hex'));
    } catch (error) {
      console.log('shared-grow', 'UNSUPPORTED', error.constructor.name);
    }

    const detached = new ArrayBuffer(4);
    const detachedView = Buffer.from(detached);
    structuredClone(detached, { transfer: [detached] });
    console.log('detached-view', detached.byteLength, detachedView.buffer === detached, detachedView.length, detachedView.toString('hex'));
    try { Buffer.from(detached); console.log('detached-new', 'NO_THROW'); }
    catch (error) { console.log('detached-new', error.constructor.name, error.code); }

    console.log('coerce', Buffer.from(ab, '1').byteOffset, Buffer.from(ab, NaN).byteOffset, Buffer.from(ab, -0.2).byteOffset, Buffer.from(ab, 1.9).byteOffset, Buffer.from(ab, 0, 1.9).length, Buffer.from(ab, 0, -1).length);
    for (const [name, fn] of [
      ['offset-negative', () => Buffer.from(ab, -1)],
      ['offset', () => Buffer.from(ab, 6)],
      ['offset-fraction-past', () => Buffer.from(ab, 5.2)],
      ['length', () => Buffer.from(ab, 4, 2)],
      ['length-fraction-window', () => Buffer.from(ab, 4.2, 1)],
    ]) {
      try { fn(); console.log(name, 'NO_THROW'); }
      catch (error) { console.log(name, error.constructor.name, error.code, error.message); }
    }
  `,
};

export default c;
