/**
 * Sync RPC framing: JSON-over-UTF-8 wire format on top of {@link SabRing}
 * (ADR-0011 phase 3, version field per ADR-0032).
 *
 * Each frame carries a `u32` protocol version stamped into the SAB header by
 * `SabRing.writeRequest`/`writeReply`, validated on EVERY frame before
 * decoding so a future binary-frame extension (A-021) can't corrupt a v1
 * reader. (SW side splits frame/routing versions per ADR-0016/0031/0040; here
 * one constant suffices — single contract surface.) No cross-version compat:
 * a mismatch surfaces as {@link SyncRpcProtocolMismatchError}; the dispatcher
 * echoes the caller's version in the error reply so the caller can decode it.
 *
 * Wire format is JSON-only by design (easy to inspect); binary frames (raw
 * stdout piggy-backed on the reply) deferred to A-021 with its own frame
 * discriminator + version bump. Errors travel as a plain `{name, message,
 * code?}` triple to stay JSON-serialisable; the receiver reconstructs an
 * `Error` (preserving `code`).
 */

/**
 * Wire-format version stamped into the SAB header on every frame (ADR-0032).
 * Bump on any change to header layout, JSON frame shape, or error contract;
 * readers refuse to decode frames whose version differs from their own.
 */
export const SYNC_RPC_PROTOCOL_VERSION = 1 as const;

/**
 * Thrown when a SAB frame's version doesn't match the reader's
 * {@link SYNC_RPC_PROTOCOL_VERSION}. Carries expected + seen versions so the
 * dispatcher can echo the caller's version back in the error reply.
 */
export class SyncRpcProtocolMismatchError extends Error {
  readonly code = 'EPROTOVERSION' as const;
  constructor(
    readonly expected: number,
    readonly got: number,
  ) {
    super(`SyncRpc protocol version mismatch: expected ${expected}, got ${got}`);
    this.name = 'SyncRpcProtocolMismatchError';
  }
}

/**
 * Request frame written by {@link SyncRpcClient}, read by
 * {@link SyncRpcDispatcher}.
 */
export interface SyncRpcRequest {
  /** RPC method name, e.g. `'execSync'`, `'readFileSync'`. */
  readonly method: string;
  /** Method-specific payload. Must be JSON-serialisable. */
  readonly payload: unknown;
}

/**
 * Reply frame written by {@link SyncRpcDispatcher}, consumed by
 * {@link SyncRpcClient}. `ok=true` carries the result in `value`; `ok=false`
 * carries the failure in `error`.
 */
export interface SyncRpcReply {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: {
    readonly name: string;
    readonly message: string;
    readonly code?: string;
  };
}

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * Serialise a {@link SyncRpcRequest} for the SAB ring's request slot.
 * @throws if the request isn't JSON-encodable (cyclic payload, BigInt) —
 * callers should validate payloads first.
 */
export function encodeRequest(req: SyncRpcRequest): Uint8Array {
  const json = JSON.stringify(req);
  if (typeof json !== 'string') {
    throw new TypeError(`encodeRequest: payload is not JSON-serialisable (method=${req.method})`);
  }
  return UTF8_ENCODER.encode(json);
}

/**
 * Deserialise reply-slot bytes into a {@link SyncRpcReply}.
 * @throws on UTF-8/JSON parse failure — indicates a protocol bug, surface loudly.
 */
export function decodeReply(bytes: Uint8Array): SyncRpcReply {
  const text = UTF8_DECODER.decode(bytes);
  const parsed = JSON.parse(text) as unknown;
  if (!isReply(parsed)) {
    throw new TypeError(`decodeReply: malformed reply frame: ${text}`);
  }
  return parsed;
}

/**
 * Mirror of {@link decodeReply} for the dispatcher side — reads the request
 * bytes the client wrote into the SAB request slot.
 */
export function decodeRequest(bytes: Uint8Array): SyncRpcRequest {
  const text = UTF8_DECODER.decode(bytes);
  const parsed = JSON.parse(text) as unknown;
  if (!isRequest(parsed)) {
    throw new TypeError(`decodeRequest: malformed request frame: ${text}`);
  }
  return parsed;
}

/** Mirror of {@link encodeRequest} for the dispatcher side. */
export function encodeReply(rep: SyncRpcReply): Uint8Array {
  const json = JSON.stringify(rep);
  if (typeof json !== 'string') {
    throw new TypeError('encodeReply: reply is not JSON-serialisable');
  }
  return UTF8_ENCODER.encode(json);
}

function isRequest(v: unknown): v is SyncRpcRequest {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as { method?: unknown };
  return typeof r.method === 'string';
}

function isReply(v: unknown): v is SyncRpcReply {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as { ok?: unknown };
  return typeof r.ok === 'boolean';
}
