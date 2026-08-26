import { describe, expect, it } from 'vitest';
import { FRAME_BINARY, FRAME_JSON, decodeRequest, encodeRequest } from './sync-rpc.ts';

const enc = new TextEncoder();

function binaryFrame(method: string, payload: Uint8Array): Uint8Array {
  const methodBytes = enc.encode(method);
  const frame = new Uint8Array(3 + methodBytes.length + payload.length);
  frame[0] = FRAME_BINARY;
  new DataView(frame.buffer).setUint16(1, methodBytes.length, true);
  frame.set(methodBytes, 3);
  frame.set(payload, 3 + methodBytes.length);
  return frame;
}

function shared(bytes: Uint8Array): Uint8Array {
  const sab = new SharedArrayBuffer(bytes.length);
  const view = new Uint8Array(sab);
  view.set(bytes);
  return view;
}

describe('ADR-0366 SyncRpc v5 binary request envelope', () => {
  it('encodes the exact discriminator + u16LE method + raw payload bytes', async () => {
    const protocol = await import('./sync-rpc.ts');
    const encodeBinaryRequest = Reflect.get(protocol, 'encodeBinaryRequest');
    expect(encodeBinaryRequest).toBeTypeOf('function');
    const payload = Uint8Array.from([0xff, 0x00, 0x7f]);
    const encode = encodeBinaryRequest as (method: string, body: Uint8Array) => Uint8Array;
    expect(encode('fs.stat', payload)).toEqual(binaryFrame('fs.stat', payload));
    expect(encode('fs.stát.文件', payload)).toEqual(binaryFrame('fs.stát.文件', payload));
    expect(() => encode('', payload)).toThrow(/method.*empty|method.*byte/i);
    expect(() => encode('x'.repeat(65_536), payload)).toThrow(/method.*65535|method.*long/i);
  });

  it('decodes JSON and SAB-backed binary requests with an owned payload copy', () => {
    expect(decodeRequest(encodeRequest({ method: 'echo', payload: { n: 1 } }))).toEqual({
      method: 'echo',
      payload: { n: 1 },
    });
    const raw = binaryFrame('fs.readFileHead', Uint8Array.from([1, 2, 3]));
    const sharedRaw = shared(raw);
    const decoded = decodeRequest(sharedRaw);
    expect(decoded).toEqual({
      binary: true,
      method: 'fs.readFileHead',
      payload: Uint8Array.from([1, 2, 3]),
    });
    sharedRaw[sharedRaw.length - 1] = 99;
    expect(decoded.payload).toEqual(Uint8Array.from([1, 2, 3]));
  });

  it('rejects every malformed binary envelope before application decode', () => {
    const corrupt = [
      Uint8Array.from([FRAME_BINARY]),
      Uint8Array.from([FRAME_BINARY, 0, 0]),
      Uint8Array.from([FRAME_BINARY, 3, 0, 0x66, 0x73]),
      Uint8Array.from([FRAME_BINARY, 1, 0, 0xff]),
      Uint8Array.from([FRAME_BINARY, 0xff, 0xff, 0x66]),
    ];
    for (const frame of corrupt) {
      expect(() => decodeRequest(frame)).toThrow(/binary request|method/i);
    }
    expect(() => decodeRequest(Uint8Array.from([0x42, 9]))).toThrow(/discriminator 0x42/i);
    expect(binaryFrame('x', new Uint8Array(0))[0]).toBe(FRAME_BINARY);
    expect(encodeRequest({ method: 'x', payload: null })[0]).toBe(FRAME_JSON);
  });
});
