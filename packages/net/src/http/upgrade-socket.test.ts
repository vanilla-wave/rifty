import { describe, expect, it } from 'vitest';
import {
  type WebSocketBridgeFrame,
  WebSocketClientSocket,
  WebSocketUpgradeSocket,
} from './upgrade-socket.ts';

const HANDSHAKE_101 =
  'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n';

function acceptedUpgradeSocket(opts: { readonly maxPayload?: number } = {}): {
  socket: WebSocketUpgradeSocket;
  data: Buffer[];
  bridge: WebSocketBridgeFrame[];
} {
  const bridge: WebSocketBridgeFrame[] = [];
  const socket = new WebSocketUpgradeSocket({
    cid: 'c1',
    url: 'ws://example/socket',
    protocols: [],
    maxPayload: opts.maxPayload,
    sendBridgeFrame: (f) => bridge.push(f),
  });
  const data: Buffer[] = [];
  socket.on('data', (d) => data.push(d as Buffer));
  socket.write(Buffer.from(HANDSHAKE_101, 'latin1'));
  return { socket, data, bridge };
}

/** Capture the first frame the egress socket writes toward the real `ws` client. */
function closeFrameFor(code: number, reason = ''): Buffer {
  const socket = new WebSocketClientSocket({ cid: 'c1', sendBridgeFrame: () => {} });
  const frames: Buffer[] = [];
  socket.on('data', (d) => frames.push(d as Buffer));
  socket._receiveBridgeClose(code, reason);
  return frames[0] ?? Buffer.alloc(0);
}

function bridgeCloseFromServerFrames(
  frames: readonly Buffer[],
  opts: { readonly maxPayload?: number } = {},
): WebSocketBridgeFrame | undefined {
  const { socket, bridge } = acceptedUpgradeSocket(opts);
  socket.on('error', () => {});
  bridge.length = 0;
  for (const frame of frames) socket.write(frame);
  return bridge.find((frame) => frame.type === 'close');
}

function bridgeCloseFromClientFrames(
  frames: readonly Buffer[],
  opts: { readonly maxPayload?: number } = {},
): WebSocketBridgeFrame | undefined {
  const bridge: WebSocketBridgeFrame[] = [];
  const socket = new WebSocketClientSocket({
    cid: 'c1',
    maxPayload: opts.maxPayload,
    sendBridgeFrame: (frame) => bridge.push(frame),
  });
  socket.on('error', () => {});
  for (const frame of frames) socket.write(frame);
  return bridge.find((frame) => frame.type === 'close');
}

function encodeTestFrame(
  opcode: number,
  payload: Buffer,
  opts: {
    readonly fin?: boolean;
    readonly masked?: boolean;
    readonly rsv?: number;
    readonly declaredLength?: number;
  } = {},
): Buffer {
  const declaredLength = opts.declaredLength ?? payload.length;
  const first = (opts.fin === false ? 0 : 0x80) | (opts.rsv ?? 0) | opcode;
  const lengthBytes =
    declaredLength < 126
      ? Buffer.from([declaredLength])
      : declaredLength <= 0xffff
        ? Buffer.from([126, (declaredLength >>> 8) & 0xff, declaredLength & 0xff])
        : (() => {
            const out = Buffer.alloc(9);
            out[0] = 127;
            out.writeBigUInt64BE(BigInt(declaredLength), 1);
            return out;
          })();
  if (!opts.masked) return Buffer.concat([Buffer.from([first]), lengthBytes, payload]);
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] = masked[i]! ^ mask[i % 4]!;
  lengthBytes[0] = lengthBytes[0]! | 0x80;
  return Buffer.concat([Buffer.from([first]), lengthBytes, mask, masked]);
}

describe('WebSocketClientSocket close-code egress to a real ws client', () => {
  it('sends a bodyless close for reserved codes that MUST NOT appear on the wire', () => {
    // 1004/1005/1006/1015 are reserved (RFC6455 §7.4.1) — a 2-byte body with
    // these codes is rejected by real `ws` as WS_ERR_INVALID_CLOSE_CODE.
    for (const reserved of [1005, 1015, 1004]) {
      const frame = closeFrameFor(reserved, 'x');
      expect(frame[0]! & 0x0f, `opcode for ${reserved}`).toBe(0x8); // close opcode
      expect(frame[1]! & 0x7f, `payload length for ${reserved}`).toBe(0); // bodyless
    }
  });

  it('still sends a 2-byte status body for sendable close codes', () => {
    const frame = closeFrameFor(1001, 'bye');
    expect(frame[0]! & 0x0f).toBe(0x8);
    expect(frame[1]! & 0x7f).toBe(2 + Buffer.byteLength('bye'));
    expect((frame[2]! << 8) | frame[3]!).toBe(1001);
  });
});

describe('WebSocketUpgradeSocket completes the closing handshake with the ws server', () => {
  it('echoes a Close frame back to the server when the server initiates close', () => {
    const { socket, data, bridge } = acceptedUpgradeSocket();
    data.length = 0;

    // Server sends Close 1001 (unmasked, no reason): [0x88, 0x02, 0x03, 0xE9].
    socket.write(Buffer.from([0x88, 0x02, 0x03, 0xe9]));

    expect(bridge.some((f) => f.type === 'close' && f.from === 'server' && f.code === 1001)).toBe(
      true,
    );
    // Without a Close echo the ws server would conclude 1006 from socket EOF;
    // the transport must send a Close back to finish the handshake cleanly.
    const echo = data.find((d) => (d[0]! & 0x0f) === 0x8);
    expect(echo, 'must echo a Close frame to the ws server').toBeDefined();
    expect((echo![1]! & 0x80) !== 0).toBe(true); // client→server frames are masked
  });
});

describe('RFC6455 malformed frame handling', () => {
  const serverCases: Array<{
    readonly name: string;
    readonly frames: readonly Buffer[];
    readonly code: number;
    readonly reason: string;
  }> = [
    {
      name: 'rejects RSV bits without negotiated extensions',
      frames: [encodeTestFrame(0x1, Buffer.from('x'), { rsv: 0x40 })],
      code: 1002,
      reason: 'extensions are not negotiated',
    },
    {
      name: 'rejects invalid UTF-8 text frames',
      frames: [encodeTestFrame(0x1, Buffer.from([0xff]))],
      code: 1007,
      reason: 'invalid utf-8 websocket text frame',
    },
    {
      name: 'rejects one-byte close payloads',
      frames: [encodeTestFrame(0x8, Buffer.from([0x03]))],
      code: 1002,
      reason: 'invalid websocket close payload',
    },
    {
      name: 'rejects reserved received close codes',
      frames: [encodeTestFrame(0x8, Buffer.from([0x03, 0xee]))],
      code: 1002,
      reason: 'invalid websocket close code',
    },
    {
      name: 'rejects invalid UTF-8 close reasons',
      frames: [encodeTestFrame(0x8, Buffer.from([0x03, 0xe8, 0xff]))],
      code: 1007,
      reason: 'invalid utf-8 websocket close reason',
    },
    {
      name: 'rejects oversized control frames',
      frames: [encodeTestFrame(0x9, Buffer.alloc(126))],
      code: 1002,
      reason: 'websocket control frame too large',
    },
    {
      name: 'rejects fragmented control frames',
      frames: [encodeTestFrame(0x9, Buffer.from('x'), { fin: false })],
      code: 1002,
      reason: 'websocket control frame fragmented',
    },
    {
      name: 'rejects new data frames before a fragmented message completes',
      frames: [
        encodeTestFrame(0x1, Buffer.from('a'), { fin: false }),
        encodeTestFrame(0x1, Buffer.from('b')),
      ],
      code: 1002,
      reason: 'new websocket data frame before fragmented message completed',
    },
  ];

  for (const t of serverCases) {
    it(`server-to-client: ${t.name}`, () => {
      const close = bridgeCloseFromServerFrames(t.frames);

      expect(close?.code).toBe(t.code);
      expect(close?.reason).toContain(t.reason);
    });
  }

  it('client-to-server: rejects unmasked frames', () => {
    const close = bridgeCloseFromClientFrames([encodeTestFrame(0x1, Buffer.from('x'))]);

    expect(close?.code).toBe(1002);
    expect(close?.reason).toContain('unmasked websocket frame from client');
  });
});

describe('WebSocket upgrade sockets maxPayload', () => {
  it('closes 1009 when a declared server frame length exceeds maxPayload', () => {
    const close = bridgeCloseFromServerFrames(
      [encodeTestFrame(0x2, Buffer.alloc(0), { declaredLength: 6 })],
      { maxPayload: 5 },
    );

    expect(close?.code).toBe(1009);
    expect(close?.reason).toContain('websocket message too big');
  });

  it('closes 1009 when server fragments exceed maxPayload cumulatively', () => {
    const close = bridgeCloseFromServerFrames(
      [
        encodeTestFrame(0x1, Buffer.from('abc'), { fin: false }),
        encodeTestFrame(0x0, Buffer.from('def')),
      ],
      { maxPayload: 5 },
    );

    expect(close?.code).toBe(1009);
    expect(close?.reason).toContain('websocket message too big');
  });

  it('closes 1009 when client fragments exceed maxPayload cumulatively', () => {
    const close = bridgeCloseFromClientFrames(
      [
        encodeTestFrame(0x1, Buffer.from('abc'), { fin: false, masked: true }),
        encodeTestFrame(0x0, Buffer.from('def'), { masked: true }),
      ],
      { maxPayload: 5 },
    );

    expect(close?.code).toBe(1009);
    expect(close?.reason).toContain('websocket message too big');
  });

  it('treats maxPayload 0 as unlimited (ws semantics), not reject-everything', () => {
    // Real `ws` Receiver: maxPayload 0 disables the cap. A bare `len > 0` check
    // would invert this and close 1009 on any non-empty frame.
    const close = bridgeCloseFromServerFrames([encodeTestFrame(0x2, Buffer.alloc(64))], {
      maxPayload: 0,
    });

    expect(close).toBeUndefined();
  });
});

/**
 * Round-trip a text message through encodeFrame (server side) and parseFrame
 * (client side) so the 126/127 extended-length math is exercised on real bytes:
 * upgrade._receiveBridgeMessage → masked text frame → clientSocket.write parses
 * it → bridge 'msg'. Guards the off-by-one boundaries (125/126, 0xffff/0x10000).
 */
function roundTripText(message: string): string | undefined {
  const up = new WebSocketUpgradeSocket({
    cid: 'u',
    url: 'ws://example/socket',
    protocols: [],
    sendBridgeFrame: () => {},
  });
  const frames: Buffer[] = [];
  up.on('data', (d) => frames.push(d as Buffer));
  up._receiveBridgeMessage(message);

  let received: WebSocketBridgeFrame | undefined;
  const client = new WebSocketClientSocket({
    cid: 'c',
    sendBridgeFrame: (f) => {
      received = f;
    },
  });
  for (const f of frames) client.write(f);
  return received?.type === 'msg' ? (received.data as string) : undefined;
}

describe('RFC6455 extended payload length (126/127) round-trips', () => {
  for (const size of [125, 126, 65535, 65536, 70000]) {
    it(`round-trips a ${size}-byte text frame through encode + parse`, () => {
      const message = 'x'.repeat(size);
      expect(roundTripText(message)).toBe(message);
    });
  }
});

describe('WebSocketUpgradeSocket.setTimeout', () => {
  it('fires a timeout event for a non-zero timeout', async () => {
    const s = new WebSocketUpgradeSocket({
      cid: 'u',
      url: 'ws://example/socket',
      protocols: [],
      sendBridgeFrame: () => {},
    });
    const fired = await Promise.race([
      new Promise<boolean>((resolve) => s.setTimeout(15, () => resolve(true))),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
    ]);
    expect(fired).toBe(true);
    s.destroy();
  });

  it('setTimeout(0) disables the timer (no timeout event)', async () => {
    const s = new WebSocketUpgradeSocket({
      cid: 'u',
      url: 'ws://example/socket',
      protocols: [],
      sendBridgeFrame: () => {},
    });
    let fired = false;
    s.on('timeout', () => {
      fired = true;
    });
    s.setTimeout(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(fired).toBe(false);
    s.destroy();
  });
});
