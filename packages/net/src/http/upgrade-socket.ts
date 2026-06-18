import { Buffer, EventEmitter, NotImplementedError } from '@riftydev/io';
import type { WsMessage } from '../ws/in-process.ts';

export interface WebSocketBridgeFrame {
  type: 'open' | 'open-ack' | 'msg' | 'close';
  cid: string;
  data?: WsMessage;
  opcode?: number;
  code?: number;
  reason?: string;
  from?: 'client' | 'server';
  url?: string;
  key?: string;
  protocols?: readonly string[];
  protocol?: string;
}

export interface WebSocketUpgradeSocketOptions {
  readonly cid: string;
  readonly url: string;
  readonly protocols: readonly string[];
  readonly encrypted?: boolean;
  readonly sendBridgeFrame: (frame: WebSocketBridgeFrame) => void;
}

export interface WebSocketClientSocketOptions {
  readonly cid: string;
  readonly sendBridgeFrame: (frame: WebSocketBridgeFrame) => void;
}

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const textEncoder = new TextEncoder();

type ParsedFrame =
  | { kind: 'frame'; fin: boolean; opcode: number; payload: Buffer; byteLength: number }
  | { kind: 'need-more' }
  | { kind: 'protocol-error'; reason: string };

type FragmentedMessage = {
  opcode: 0x1 | 0x2;
  chunks: Buffer[];
};

export class WebSocketUpgradeSocket extends EventEmitter {
  readonly remoteAddress = '127.0.0.1';
  readonly localAddress = '127.0.0.1';
  readonly remotePort = 0;
  readonly localPort = 0;
  readonly encrypted: boolean;

  writable = true;
  readable = true;
  destroyed = false;
  _readableState = { endEmitted: false };
  // `length` mirrors the client socket: real ws `bufferedAmount` reads
  // `_socket._writableState.length` — without it the getter returns NaN. The
  // bridge keeps no send queue, so an honest 0 is correct.
  _writableState = { finished: false, errorEmitted: false, length: 0 };

  private readonly cid: string;
  private readonly protocols: readonly string[];
  private readonly sendBridgeFrame: (frame: WebSocketBridgeFrame) => void;
  private handshakeBuffer = Buffer.alloc(0);
  private serverFrameBuffer = Buffer.alloc(0);
  private handshakeState: 'pending' | 'accepted' | 'failed' = 'pending';
  private selectedProtocol = '';
  private closeEmitted = false;
  private closeFrameSent = false;
  private fragmentedMessage: FragmentedMessage | null = null;

  constructor(opts: WebSocketUpgradeSocketOptions) {
    super();
    this.cid = opts.cid;
    this.protocols = opts.protocols;
    this.encrypted = opts.encrypted ?? false;
    this.sendBridgeFrame = opts.sendBridgeFrame;
  }

  setTimeout(_timeout: number, cb?: () => void): this {
    if (cb) this.once('timeout', cb);
    return this;
  }

  setNoDelay(_noDelay = true): this {
    return this;
  }

  setKeepAlive(_enable = false, _initialDelay?: number): this {
    return this;
  }

  pause(): this {
    return this;
  }

  resume(): this {
    return this;
  }

  read(): null {
    return null;
  }

  cork(): void {}

  uncork(): void {}

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  write(chunk: string | Uint8Array, cb?: (err?: Error) => void): boolean {
    if (this.destroyed) {
      const err = Object.assign(new Error('write after destroy'), { code: 'ERR_STREAM_DESTROYED' });
      queueMicrotask(() => {
        cb?.(err);
        this.emit('error', err);
      });
      return false;
    }
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    if (this.handshakeState === 'pending') {
      this.consumeHandshakeBytes(bytes);
    } else if (this.handshakeState === 'accepted') {
      this.consumeServerFrameBytes(bytes);
    }
    queueMicrotask(() => cb?.());
    return true;
  }

  end(chunk?: string | Uint8Array, cb?: () => void): this {
    if (chunk !== undefined) this.write(chunk);
    this.destroy();
    cb?.();
    return this;
  }

  destroy(err?: Error): this {
    if (this.destroyed) return this;
    if (this.handshakeState === 'accepted' && !this.closeFrameSent) {
      this.sendBridgeClose(1006, err?.message ?? 'socket destroyed');
    }
    this.destroyed = true;
    this.writable = false;
    this.readable = false;
    this._readableState.endEmitted = true;
    this._writableState.finished = true;
    if (err) this._writableState.errorEmitted = true;
    if (err) this.emit('error', err);
    this.emitClose();
    return this;
  }

  destroySoon(): void {
    this.destroy();
  }

  address(): { address: string; family: 'IPv4'; port: number } {
    return { address: this.localAddress, family: 'IPv4', port: this.localPort };
  }

  _acceptKey(): string | null {
    // null only before _setRequestKey runs. The sole constructor (HttpServer
    // upgrade) always sets a valid key before any handshake byte, so the
    // Sec-WebSocket-Accept check in consumeHandshakeBytes is always enforced;
    // null would skip it, so _setRequestKey is a required precondition.
    const key = this._requestKey;
    if (!key) return null;
    return acceptKey(key);
  }

  _receiveBridgeMessage(data: WsMessage, opcode?: number): void {
    if (this.destroyed) return;
    const frameOpcode = opcode ?? (typeof data === 'string' ? 0x1 : 0x2);
    this.emit('data', encodeClientFrame(frameOpcode, normalisePayload(data)));
  }

  _receiveBridgeClose(code = 1000, reason = ''): void {
    if (this.destroyed) return;
    // 1006 (abnormal) has no on-wire close frame: tear the socket so the ws
    // server concludes 1006 from socket 'close'. closeFrameSent suppresses the
    // redundant close echo destroy() would otherwise post back to the peer.
    if (code === 1006) {
      this.closeFrameSent = true;
      this.destroy();
      return;
    }
    this.emit('data', encodeClientFrame(0x8, closeFrameBody(code, reason)));
  }

  private _requestKey = '';

  _setRequestKey(key: string): void {
    this._requestKey = key;
  }

  private consumeHandshakeBytes(bytes: Buffer): void {
    this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, bytes]);
    const sep = indexOfHeaderEnd(this.handshakeBuffer);
    if (sep === -1) return;
    const head = Buffer.from(this.handshakeBuffer.subarray(0, sep + 4)).toString('latin1');
    const tail = Buffer.from(this.handshakeBuffer.subarray(sep + 4));
    this.handshakeBuffer = Buffer.alloc(0);
    const response = parseHttpResponseHead(head);
    const expectedAccept = this._acceptKey();
    if (
      !response ||
      response.statusCode !== 101 ||
      response.headers.upgrade?.toLowerCase() !== 'websocket' ||
      !connectionHasUpgrade(response.headers.connection) ||
      (expectedAccept !== null && response.headers['sec-websocket-accept'] !== expectedAccept)
    ) {
      this.failHandshake('invalid websocket upgrade response');
      return;
    }
    const protocol = response.headers['sec-websocket-protocol'] ?? '';
    if (protocol !== '' && !this.protocols.includes(protocol)) {
      this.failHandshake('server selected an unknown websocket protocol');
      return;
    }
    this.selectedProtocol = protocol;
    this.handshakeState = 'accepted';
    this.sendBridgeFrame({ type: 'open-ack', cid: this.cid, protocol: this.selectedProtocol });
    if (tail.byteLength > 0) this.consumeServerFrameBytes(tail);
  }

  private failHandshake(reason: string): void {
    this.handshakeState = 'failed';
    this.sendBridgeClose(1006, reason);
    this.destroy(new Error(reason));
  }

  private consumeServerFrameBytes(bytes: Buffer): void {
    this.serverFrameBuffer = Buffer.concat([this.serverFrameBuffer, bytes]);
    for (;;) {
      const parsed = parseFrame(this.serverFrameBuffer, { mask: 'forbidden' });
      if (parsed.kind === 'need-more') return;
      if (parsed.kind === 'protocol-error') {
        this.sendBridgeClose(1002, parsed.reason);
        this.destroy(new Error(parsed.reason));
        return;
      }
      this.serverFrameBuffer = Buffer.from(this.serverFrameBuffer.subarray(parsed.byteLength));
      this.handleServerFrame(parsed.fin, parsed.opcode, parsed.payload);
    }
  }

  private handleServerFrame(fin: boolean, opcode: number, payload: Buffer): void {
    if (opcode === 0x0) {
      this.handleServerContinuation(fin, payload);
      return;
    }
    if (opcode === 0x1) {
      this.handleServerDataFrame(fin, 0x1, payload);
      return;
    }
    if (opcode === 0x2) {
      this.handleServerDataFrame(fin, 0x2, payload);
      return;
    }
    if (opcode === 0x8) {
      const close = parseClosePayload(payload);
      if (close.kind === 'protocol-error') {
        this.closeWithProtocolError(close.reason, close.code);
        return;
      }
      const { code, reason } = close;
      this.sendBridgeClose(code, reason);
      // Echo a Close back so the ws server finishes the handshake (RFC6455
      // §5.5.1) and its 'close' fires with the negotiated code, not 1006 from
      // socket EOF.
      this.emit('data', encodeClientFrame(0x8, closeFrameBody(code, reason)));
      this.destroy();
      return;
    }
    if (opcode === 0x9) {
      this.emit('data', encodeClientFrame(0xa, payload));
      return;
    }
    // Server pong: RFC6455 §5.5.3 expects no response, and the bridge transport
    // answers server pings locally (ADR-0151), so an unsolicited server pong has
    // no downstream consumer. Dropped intentionally — not silently.
    // TODO(backlog: net/ws-end-to-end-control-frames) end-to-end ping/pong relay
    if (opcode === 0xa) return;
    this.sendBridgeClose(1002, `unsupported websocket opcode ${opcode}`);
    this.destroy();
  }

  private handleServerDataFrame(fin: boolean, opcode: 0x1 | 0x2, payload: Buffer): void {
    if (this.fragmentedMessage !== null) {
      this.closeWithProtocolError('new websocket data frame before fragmented message completed');
      return;
    }
    if (!fin) {
      this.fragmentedMessage = { opcode, chunks: [payload] };
      return;
    }
    this.sendServerMessage(opcode, payload);
  }

  private handleServerContinuation(fin: boolean, payload: Buffer): void {
    if (this.fragmentedMessage === null) {
      this.closeWithProtocolError('unexpected websocket continuation frame');
      return;
    }
    this.fragmentedMessage.chunks.push(payload);
    if (!fin) return;
    const message = this.fragmentedMessage;
    this.fragmentedMessage = null;
    this.sendServerMessage(message.opcode, Buffer.concat(message.chunks));
  }

  private sendServerMessage(opcode: 0x1 | 0x2, payload: Buffer): void {
    if (opcode === 0x1) {
      let text: string;
      try {
        text = decodeFatalUtf8(payload);
      } catch {
        this.closeWithProtocolError('invalid utf-8 websocket text frame', 1007);
        return;
      }
      this.sendBridgeFrame({ type: 'msg', cid: this.cid, data: text });
      return;
    }
    this.sendBridgeFrame({ type: 'msg', cid: this.cid, data: payload });
  }

  private closeWithProtocolError(reason: string, code = 1002): void {
    this.sendBridgeClose(code, reason);
    this.destroy(new Error(reason));
  }

  private sendBridgeClose(code: number, reason: string): void {
    if (this.closeFrameSent) return;
    this.closeFrameSent = true;
    this.sendBridgeFrame({ type: 'close', cid: this.cid, code, reason, from: 'server' });
  }

  private emitClose(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    queueMicrotask(() => this.emit('close'));
  }
}

export class WebSocketClientSocket extends EventEmitter {
  readonly remoteAddress = '127.0.0.1';
  readonly localAddress = '127.0.0.1';
  readonly remotePort = 0;
  readonly localPort = 0;
  readonly encrypted = false;

  writable = true;
  readable = true;
  destroyed = false;
  _readableState = { endEmitted: false };
  _writableState = { finished: false, errorEmitted: false, length: 0 };

  private readonly cid: string;
  private readonly sendBridgeFrame: (frame: WebSocketBridgeFrame) => void;
  private clientFrameBuffer = Buffer.alloc(0);
  private fragmentedMessage: FragmentedMessage | null = null;
  private closeEmitted = false;

  constructor(opts: WebSocketClientSocketOptions) {
    super();
    this.cid = opts.cid;
    this.sendBridgeFrame = opts.sendBridgeFrame;
  }

  setTimeout(_timeout: number, cb?: () => void): this {
    if (cb) this.once('timeout', cb);
    return this;
  }

  setNoDelay(_noDelay = true): this {
    return this;
  }

  setKeepAlive(_enable = false, _initialDelay?: number): this {
    return this;
  }

  pause(): this {
    return this;
  }

  resume(): this {
    return this;
  }

  read(): null {
    return null;
  }

  unshift(chunk: Uint8Array): void {
    if (chunk.byteLength > 0) this.emit('data', Buffer.from(chunk));
  }

  cork(): void {}

  uncork(): void {}

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  write(chunk: string | Uint8Array, cb?: (err?: Error) => void): boolean {
    if (this.destroyed) {
      const err = Object.assign(new Error('write after destroy'), { code: 'ERR_STREAM_DESTROYED' });
      queueMicrotask(() => {
        cb?.(err);
        this.emit('error', err);
      });
      return false;
    }
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    this.consumeClientFrameBytes(bytes);
    queueMicrotask(() => cb?.());
    return true;
  }

  end(chunk?: string | Uint8Array, cb?: () => void): this {
    if (chunk !== undefined) this.write(chunk);
    cb?.();
    return this;
  }

  destroy(err?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.writable = false;
    this.readable = false;
    this._readableState.endEmitted = true;
    this._writableState.finished = true;
    if (err) this._writableState.errorEmitted = true;
    if (err) this.emit('error', err);
    this.sendBridgeFrame({
      type: 'close',
      cid: this.cid,
      code: 1006,
      reason: err?.message ?? 'socket destroyed',
      from: 'client',
    });
    this.emitClose();
    return this;
  }

  destroySoon(): void {
    this.destroy();
  }

  address(): { address: string; family: 'IPv4'; port: number } {
    return { address: this.localAddress, family: 'IPv4', port: this.localPort };
  }

  _receiveBridgeMessage(data: WsMessage): void {
    if (this.destroyed) return;
    const opcode = typeof data === 'string' ? 0x1 : 0x2;
    this.emit('data', encodeServerFrame(opcode, normalisePayload(data)));
  }

  _receiveBridgeClose(code = 1000, reason = ''): void {
    if (this.destroyed) return;
    // 1006 (abnormal) has no on-wire close frame: skip the frame and tear down
    // so the ws client concludes 1006 from socket 'close', never an invalid
    // 1006 body. 1005/valid codes still flow through closeFrameBody.
    if (code !== 1006) {
      this.emit('data', encodeServerFrame(0x8, closeFrameBody(code, reason)));
    }
    this.destroyed = true;
    this.writable = false;
    this.readable = false;
    this._readableState.endEmitted = true;
    this._writableState.finished = true;
    this.emitClose();
  }

  private consumeClientFrameBytes(bytes: Buffer): void {
    this.clientFrameBuffer = Buffer.concat([this.clientFrameBuffer, bytes]);
    for (;;) {
      const parsed = parseFrame(this.clientFrameBuffer, { mask: 'required' });
      if (parsed.kind === 'need-more') return;
      if (parsed.kind === 'protocol-error') {
        this.sendBridgeFrame({
          type: 'close',
          cid: this.cid,
          code: 1002,
          reason: parsed.reason,
          from: 'client',
        });
        this.destroy(new Error(parsed.reason));
        return;
      }
      this.clientFrameBuffer = Buffer.from(this.clientFrameBuffer.subarray(parsed.byteLength));
      this.handleClientFrame(parsed.fin, parsed.opcode, parsed.payload);
    }
  }

  private handleClientFrame(fin: boolean, opcode: number, payload: Buffer): void {
    if (opcode === 0x0) {
      this.handleClientContinuation(fin, payload);
      return;
    }
    if (opcode === 0x1) {
      this.handleClientDataFrame(fin, 0x1, payload);
      return;
    }
    if (opcode === 0x2) {
      this.handleClientDataFrame(fin, 0x2, payload);
      return;
    }
    if (opcode === 0x8) {
      const close = parseClosePayload(payload);
      if (close.kind === 'protocol-error') {
        this.sendBridgeFrame({
          type: 'close',
          cid: this.cid,
          code: close.code,
          reason: close.reason,
          from: 'client',
        });
        this.destroy(new Error(close.reason));
        return;
      }
      this.sendBridgeFrame({
        type: 'close',
        cid: this.cid,
        code: close.code,
        reason: close.reason,
        from: 'client',
      });
      return;
    }
    if (opcode === 0x9 || opcode === 0xa) {
      this.sendBridgeFrame({
        type: 'msg',
        cid: this.cid,
        data: payload,
        opcode,
      });
      return;
    }
    this.sendBridgeFrame({
      type: 'close',
      cid: this.cid,
      code: 1002,
      reason: `unsupported websocket opcode ${opcode}`,
      from: 'client',
    });
    this.destroy(new Error(`unsupported websocket opcode ${opcode}`));
  }

  private handleClientDataFrame(fin: boolean, opcode: 0x1 | 0x2, payload: Buffer): void {
    if (this.fragmentedMessage !== null) {
      this.destroy(new Error('new websocket data frame before fragmented message completed'));
      return;
    }
    if (!fin) {
      this.fragmentedMessage = { opcode, chunks: [payload] };
      return;
    }
    this.sendClientMessage(opcode, payload);
  }

  private handleClientContinuation(fin: boolean, payload: Buffer): void {
    if (this.fragmentedMessage === null) {
      this.destroy(new Error('unexpected websocket continuation frame'));
      return;
    }
    this.fragmentedMessage.chunks.push(payload);
    if (!fin) return;
    const message = this.fragmentedMessage;
    this.fragmentedMessage = null;
    this.sendClientMessage(message.opcode, Buffer.concat(message.chunks));
  }

  private sendClientMessage(opcode: 0x1 | 0x2, payload: Buffer): void {
    if (opcode === 0x1) {
      let text: string;
      try {
        text = decodeFatalUtf8(payload);
      } catch {
        this.sendBridgeFrame({
          type: 'close',
          cid: this.cid,
          code: 1007,
          reason: 'invalid utf-8 websocket text frame',
          from: 'client',
        });
        this.destroy(new Error('invalid utf-8 websocket text frame'));
        return;
      }
      this.sendBridgeFrame({ type: 'msg', cid: this.cid, data: text });
      return;
    }
    this.sendBridgeFrame({ type: 'msg', cid: this.cid, data: payload });
  }

  private emitClose(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    queueMicrotask(() => this.emit('close'));
  }
}

export function createWebSocketUpgradeHeaders(opts: {
  readonly host: string;
  readonly key: string;
  readonly protocols: readonly string[];
}): Record<string, string> {
  const headers: Record<string, string> = {
    host: opts.host,
    connection: 'Upgrade',
    upgrade: 'websocket',
    'sec-websocket-version': '13',
    'sec-websocket-key': opts.key,
  };
  if (opts.protocols.length > 0) headers['sec-websocket-protocol'] = opts.protocols.join(', ');
  return headers;
}

export function createWebSocketKey(): string {
  const bytes = new Uint8Array(16);
  fillRandom(bytes);
  return Buffer.from(bytes).toString('base64');
}

export function createWebSocketAccept(key: string): string {
  return acceptKey(key);
}

function acceptKey(key: string): string {
  return sha1Base64(`${key}${WS_GUID}`);
}

function sha1Base64(input: string): string {
  const bytes = textEncoder.encode(input);
  const digest = sha1(bytes);
  return Buffer.from(digest).toString('base64');
}

function indexOfHeaderEnd(buf: Buffer): number {
  for (let i = 0; i <= buf.byteLength - 4; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i;
  }
  return -1;
}

function parseHttpResponseHead(head: string): {
  statusCode: number;
  headers: Record<string, string>;
} | null {
  const lines = head.split('\r\n').filter((line) => line.length > 0);
  const status = /^HTTP\/1\.[01]\s+(\d{3})\b/.exec(lines[0] ?? '');
  if (!status) return null;
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { statusCode: Number(status[1]), headers };
}

function connectionHasUpgrade(value: string | undefined): boolean {
  return value
    ? value
        .split(',')
        .map((token) => token.trim().toLowerCase())
        .includes('upgrade')
    : false;
}

function parseFrame(buf: Buffer, opts: { readonly mask: 'forbidden' | 'required' }): ParsedFrame {
  if (buf.byteLength < 2) return { kind: 'need-more' };
  const b0 = buf[0]!;
  const b1 = buf[1]!;
  const fin = (b0 & 0x80) !== 0;
  const rsv = b0 & 0x70;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let off = 2;
  const isControlFrame = opcode >= 0x8;
  if (rsv !== 0)
    return { kind: 'protocol-error', reason: 'websocket extensions are not negotiated' };
  if (opts.mask === 'forbidden' && masked) {
    return { kind: 'protocol-error', reason: 'masked websocket frame from server' };
  }
  if (opts.mask === 'required' && !masked) {
    return { kind: 'protocol-error', reason: 'unmasked websocket frame from client' };
  }
  if (isControlFrame && !fin) {
    return { kind: 'protocol-error', reason: 'websocket control frame fragmented' };
  }
  if (isControlFrame && len > 125) {
    return { kind: 'protocol-error', reason: 'websocket control frame too large' };
  }
  if (len === 126) {
    if (buf.byteLength < off + 2) return { kind: 'need-more' };
    len = (buf[off]! << 8) | buf[off + 1]!;
    if (isControlFrame) {
      return { kind: 'protocol-error', reason: 'websocket control frame too large' };
    }
    off += 2;
  } else if (len === 127) {
    if (buf.byteLength < off + 8) return { kind: 'need-more' };
    const high =
      (buf[off]! * 2 ** 24 + (buf[off + 1]! << 16) + (buf[off + 2]! << 8) + buf[off + 3]!) *
      2 ** 32;
    const low =
      buf[off + 4]! * 2 ** 24 + (buf[off + 5]! << 16) + (buf[off + 6]! << 8) + buf[off + 7]!;
    const total = high + low;
    if (!Number.isSafeInteger(total)) {
      return { kind: 'protocol-error', reason: 'websocket frame too large' };
    }
    len = total;
    if (isControlFrame) {
      return { kind: 'protocol-error', reason: 'websocket control frame too large' };
    }
    off += 8;
  }
  const maskOff = off;
  if (masked) off += 4;
  if (buf.byteLength < off + len) return { kind: 'need-more' };
  const payload = Buffer.from(buf.subarray(off, off + len));
  if (masked) {
    for (let i = 0; i < payload.byteLength; i++) payload[i] = payload[i]! ^ buf[maskOff + (i % 4)]!;
  }
  return { kind: 'frame', fin, opcode, payload, byteLength: off + len };
}

function encodeClientFrame(opcode: number, payload: Uint8Array): Buffer {
  return encodeFrame(opcode, payload, true);
}

function encodeServerFrame(opcode: number, payload: Uint8Array): Buffer {
  return encodeFrame(opcode, payload, false);
}

function encodeFrame(opcode: number, payload: Uint8Array, masked: boolean): Buffer {
  const len = payload.byteLength;
  const lenBytes = len < 126 ? 0 : len <= 0xffff ? 2 : 8;
  const maskBytes = masked ? 4 : 0;
  const headerLen = 2 + lenBytes + maskBytes;
  const out = Buffer.alloc(headerLen + len);
  out[0] = 0x80 | opcode;
  if (len < 126) {
    out[1] = (masked ? 0x80 : 0) | len;
  } else if (len <= 0xffff) {
    out[1] = (masked ? 0x80 : 0) | 126;
    out[2] = (len >>> 8) & 0xff;
    out[3] = len & 0xff;
  } else {
    out[1] = (masked ? 0x80 : 0) | 127;
    const high = Math.floor(len / 2 ** 32);
    const low = len >>> 0;
    out[2] = (high >>> 24) & 0xff;
    out[3] = (high >>> 16) & 0xff;
    out[4] = (high >>> 8) & 0xff;
    out[5] = high & 0xff;
    out[6] = (low >>> 24) & 0xff;
    out[7] = (low >>> 16) & 0xff;
    out[8] = (low >>> 8) & 0xff;
    out[9] = low & 0xff;
  }
  let payloadOffset = 2 + lenBytes;
  if (masked) {
    const mask = new Uint8Array(4);
    fillRandom(mask);
    out.set(mask, payloadOffset);
    payloadOffset += 4;
    for (let i = 0; i < len; i++) out[payloadOffset + i] = payload[i]! ^ mask[i % 4]!;
  } else {
    out.set(payload, payloadOffset);
  }
  return out;
}

function fillRandom(bytes: Uint8Array): void {
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.getRandomValues) {
    throw new NotImplementedError('websocket.crypto.getRandomValues');
  }
  webCrypto.getRandomValues(bytes);
}

function decodeFatalUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function normalisePayload(data: WsMessage): Uint8Array {
  if (typeof data === 'string') return textEncoder.encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function closePayload(code: number, reason: string): Buffer {
  const reasonBytes = textEncoder.encode(reason);
  const payload = Buffer.alloc(2 + reasonBytes.byteLength);
  payload[0] = (code >>> 8) & 0xff;
  payload[1] = code & 0xff;
  payload.set(reasonBytes, 2);
  return payload;
}

function closeFrameBody(code: number, reason: string): Buffer {
  // Reserved codes (1004/1005/1006/1015 and any out-of-range) MUST NOT appear on
  // the wire as a 2-byte status (RFC6455 §7.4.1) — real `ws` rejects them as
  // WS_ERR_INVALID_CLOSE_CODE. A browser CloseEvent can surface 1015 (TLS) or
  // 1005 on the native egress path, so collapse any non-sendable code to a
  // bodyless close. (1006 is short-circuited earlier; see _receiveBridgeClose.)
  return isValidReceivedCloseCode(code) ? closePayload(code, reason) : Buffer.alloc(0);
}

function parseClosePayload(
  payload: Buffer,
):
  | { kind: 'ok'; code: number; reason: string }
  | { kind: 'protocol-error'; code: number; reason: string } {
  if (payload.byteLength < 2) return { kind: 'ok', code: 1005, reason: '' };
  if (payload.byteLength === 1) {
    return { kind: 'protocol-error', code: 1002, reason: 'invalid websocket close payload' };
  }
  const code = (payload[0]! << 8) | payload[1]!;
  if (!isValidReceivedCloseCode(code)) {
    return { kind: 'protocol-error', code: 1002, reason: 'invalid websocket close code' };
  }
  try {
    return { kind: 'ok', code, reason: decodeFatalUtf8(payload.subarray(2)) };
  } catch {
    return { kind: 'protocol-error', code: 1007, reason: 'invalid utf-8 websocket close reason' };
  }
}

function isValidReceivedCloseCode(code: number): boolean {
  if (code >= 3000 && code <= 4999) return true;
  if (code < 1000 || code >= 1016) return false;
  return code !== 1004 && code !== 1005 && code !== 1006 && code !== 1015;
}

function sha1(bytes: Uint8Array): Uint8Array {
  const ml = bytes.length * 8;
  const withOne = bytes.length + 1;
  const paddedLen = Math.ceil((withOne + 8) / 64) * 64;
  const msg = new Uint8Array(paddedLen);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(paddedLen - 8, Math.floor(ml / 2 ** 32));
  view.setUint32(paddedLen - 4, ml >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let off = 0; off < msg.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0);
  outView.setUint32(4, h1);
  outView.setUint32(8, h2);
  outView.setUint32(12, h3);
  outView.setUint32(16, h4);
  return out;
}

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}
