import { describe, expect, it } from 'vitest';
import {
  type WebSocketBridgeFrame,
  WebSocketClientSocket,
  WebSocketUpgradeSocket,
} from './upgrade-socket.ts';

const HANDSHAKE_101 =
  'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n';

function acceptedUpgradeSocket(): {
  socket: WebSocketUpgradeSocket;
  data: Buffer[];
  bridge: WebSocketBridgeFrame[];
} {
  const bridge: WebSocketBridgeFrame[] = [];
  const socket = new WebSocketUpgradeSocket({
    cid: 'c1',
    url: 'ws://example/socket',
    protocols: [],
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
