/**
 * Sync RPC framing (ADR-0011 phase 3).
 *
 * Tiny JSON-over-UTF-8 wire format layered on top of the {@link SabRing}.
 * The protocol carries a single RPC method name + JSON-serialisable payload
 * in each request, and a JSON-serialisable result (or structured error)
 * in each reply.
 *
 * Binary frames (e.g. raw stdout bytes piggy-backed on the reply) are a
 * deliberate follow-up — phase 3 keeps the wire format JSON-only so the
 * protocol stays easy to inspect. The follow-up will be tracked under
 * A-021 (binary pipes over MessagePort with backpressure) and ship its own
 * frame discriminator.
 *
 * Errors are mapped to a plain `{name, message, code?}` triple to keep the
 * over-the-wire shape JSON-serialisable; the receiver reconstructs an
 * `Error` instance (with the original `code` preserved when present).
 */

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
