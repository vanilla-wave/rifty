/**
 * Sync RPC framing (ADR-0011 phase 3, version field per ADR-0032).
 *
 * Tiny JSON-over-UTF-8 wire format layered on top of the {@link SabRing}.
 * The protocol carries a single RPC method name + JSON-serialisable payload
 * in each request, and a JSON-serialisable result (or structured error)
 * in each reply.
 *
 * Every frame additionally carries a `u32` protocol version stamped into
 * the SAB header by `SabRing.writeRequest` / `SabRing.writeReply` (ADR-0032).
 * The version is validated on EVERY frame — readers reject mismatched
 * frames before decoding the payload so a future binary-frame extension
 * (A-021) cannot silently corrupt a v1 reader. Pattern mirrors the SW
 * protocol versioning in `service-worker/src/protocol.ts` (ADR-0016,
 * ADR-0031, ADR-0040 — the SW side splits `SW_FRAME_VERSION` from
 * `SW_ROUTING_VERSION`; the sync-RPC side keeps one constant because it
 * has only one contract surface, the frame shape).
 *
 * Bump on any wire change. There is no cross-version compatibility — a
 * mismatch surfaces as {@link SyncRpcProtocolMismatchError} (`code:
 * 'EPROTOVERSION'`) on the consumer side; the dispatcher responds to a
 * mismatched request with a versioned error reply that echoes the caller's
 * version so the caller can still decode the failure.
 *
 * Binary frames (e.g. raw stdout bytes piggy-backed on the reply) are a
 * deliberate follow-up — phase 3 keeps the wire format JSON-only so the
 * protocol stays easy to inspect. The follow-up will be tracked under
 * A-021 (binary pipes over MessagePort with backpressure) and ship its own
 * frame discriminator + a protocol version bump.
 *
 * Errors are mapped to a plain `{name, message, code?}` triple to keep the
 * over-the-wire shape JSON-serialisable; the receiver reconstructs an
 * `Error` instance (with the original `code` preserved when present).
 */

/**
 * Wire-format protocol version stamped into the SAB header on every frame
 * (ADR-0032). Bump on any change to the SAB header layout, the JSON frame
 * shape, or the error contract. Readers refuse to decode frames whose
 * version differs from their own.
 */
export const SYNC_RPC_PROTOCOL_VERSION = 1 as const;

/**
 * Thrown when a SAB frame's version field doesn't match the reader's
 * {@link SYNC_RPC_PROTOCOL_VERSION}. Carries both the expected and the
 * actually-seen version so the dispatcher can echo the caller's version
 * back in a versioned error reply (allowing the caller to still decode
 * the failure).
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
 * Serialise a {@link SyncRpcRequest} for transport over the SAB ring's
 * request slot. Throws if the request can't be JSON-encoded (e.g. cyclic
 * payload, BigInt) — the caller should validate payloads before calling.
 */
export function encodeRequest(req: SyncRpcRequest): Uint8Array {
  const json = JSON.stringify(req);
  if (typeof json !== 'string') {
    throw new TypeError(`encodeRequest: payload is not JSON-serialisable (method=${req.method})`);
  }
  return UTF8_ENCODER.encode(json);
}

/**
 * Deserialise the bytes the dispatcher wrote into the reply slot back into
 * a {@link SyncRpcReply}. Throws on UTF-8 / JSON parse failure — those
 * indicate a protocol bug and should surface loudly to the caller.
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
