/**
 * Sync RPC framing on top of {@link SabRing} (ADR-0011 phase 3, version field
 * per ADR-0032, v2 binary replies per ADR-0084 #23, v5 binary requests per
 * ADR-0366).
 *
 * Every frame body starts with a 1-byte discriminator (ADR-0084 #23):
 *   - {@link FRAME_JSON} (0x00) — JSON-over-UTF-8 body (the v1 shape: requests,
 *     `{ok,value|error}` replies). Used for everything except binary `ok` values.
 *   - {@link FRAME_BINARY} (0x01) — reply: raw value bytes; request: u16LE
 *     method-name byte length + UTF-8 method + application payload.
 *
 * Each frame also carries a `u32` protocol version stamped into the SAB header
 * by `SabRing.writeRequest`/`writeReply`, validated on EVERY frame before
 * decoding — the in-band guard that stops a v1 reader feeding a 0x01 frame to
 * `JSON.parse`. (SW side splits frame/routing versions per ADR-0016/0031/0040;
 * here one constant suffices — single contract surface.) No cross-version
 * compat: a mismatch surfaces as {@link SyncRpcProtocolMismatchError}; the
 * dispatcher echoes the caller's version in the error reply so the caller can
 * decode it.
 *
 * Errors ALWAYS travel as a JSON frame ({name, message, code?} triple) so the
 * {@link SyncRpcReply} error contract and ADR-0032's versioned-error recovery
 * stay intact; only `ok=true` byte values use the binary frame.
 */

/**
 * Wire-format version stamped into the SAB header on every frame (ADR-0032).
 * Bump on any change to header layout, JSON frame shape, or error contract;
 * readers refuse to decode frames whose version differs from their own.
 *
 * v2 (ADR-0084 #23, pre-authorised by ADR-0032 §Consequences): adds the 1-byte
 * JSON/BINARY frame discriminator. The two peers (client + dispatcher) live in
 * `@riftydev/kernel` and recompile atomically — a recompile-everything-at-once
 * moment by design (same model as ADR-0016).
 *
 * v3: REQ_STATE is a claimed exchange lifecycle
 * IDLE→WRITING→READY→HANDLING→IDLE. Both peers must recompile atomically.
 *
 * v4 (ADR-0365): owner-backed fs reads add one binary total-size + first-chunk
 * application reply. Kernel + runtime-js peers recompile atomically.
 *
 * v5 (ADR-0366): adds binary request envelopes for hot owner-fs reads. Kernel,
 * runtime-js, Workbench and TypeScript worker peers recompile atomically.
 */
export const SYNC_RPC_PROTOCOL_VERSION = 5 as const;

/** Frame discriminator: JSON-over-UTF-8 body (ADR-0084 #23). */
export const FRAME_JSON = 0x00 as const;
/** Frame discriminator: raw bytes body (ADR-0084 #23). */
export const FRAME_BINARY = 0x01 as const;

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

/** Binary request decoded from ADR-0366's method + application-payload frame. */
export interface SyncRpcBinaryRequest {
  readonly binary: true;
  readonly method: string;
  /** Owned copy: never aliases the reusable SharedArrayBuffer request slot. */
  readonly payload: Uint8Array;
}

/** Request shape consumed by the dispatcher after wire decoding. */
export type DecodedSyncRpcRequest = SyncRpcRequest | SyncRpcBinaryRequest;

/**
 * Reply frame written by {@link SyncRpcDispatcher}, consumed by
 * {@link SyncRpcClient}. `ok=true` carries the result in `value`; `ok=false`
 * carries the failure in `error`. A `Uint8Array` value rides a binary frame
 * (ADR-0084 #23) and decodes back to a `Uint8Array` byte-exact.
 */
export interface SyncRpcReply {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: {
    readonly name: string;
    readonly message: string;
    readonly code?: string;
    /** Node ErrnoException fields — present only when the source error has them; child CLI reads the owner fs over sync-RPC, so fs errno detail must survive the wire (ADR-0150). */
    readonly errno?: number;
    readonly syscall?: string;
    readonly path?: string;
  };
}

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * UTF-8 decode a frame body that may be a SharedArrayBuffer-backed view.
 * `TextDecoder.decode` rejects shared views in browsers ("The provided
 * ArrayBufferView value must not be shared") — Chromium/WebKit are strict where
 * Node is lax, so the SAB frame path passed every Node test yet threw the first
 * time it ran in a real cross-origin-isolated Worker (the COI execSync e2e).
 * Copying into a fresh (non-shared) buffer is the spec-portable read; the bodies
 * are small JSON (requests, `{ok,value|error}` / error replies). The binary
 * frame body already copies via `.slice()`.
 */
function decodeUtf8FromMaybeShared(body: Uint8Array): string {
  return UTF8_DECODER.decode(body.slice());
}

/** Prefix `body` with the 1-byte frame discriminator (ADR-0084 #23). */
function frame(kind: typeof FRAME_JSON | typeof FRAME_BINARY, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.byteLength + 1);
  out[0] = kind;
  out.set(body, 1);
  return out;
}

/**
 * Serialise a {@link SyncRpcRequest} for the SAB ring's request slot. Always a
 * JSON frame — request payloads are small JSON (ADR-0084 #23 keeps binary on
 * the reply side only).
 * @throws if the request isn't JSON-encodable (cyclic payload, BigInt) —
 * callers should validate payloads first.
 */
export function encodeRequest(req: SyncRpcRequest): Uint8Array {
  const json = JSON.stringify(req);
  if (typeof json !== 'string') {
    throw new TypeError(`encodeRequest: payload is not JSON-serialisable (method=${req.method})`);
  }
  return frame(FRAME_JSON, UTF8_ENCODER.encode(json));
}

/** Encode ADR-0366's binary request envelope. */
export function encodeBinaryRequest(method: string, payload: Uint8Array): Uint8Array {
  const methodBytes = UTF8_ENCODER.encode(method);
  if (methodBytes.byteLength === 0) {
    throw new TypeError('encodeBinaryRequest: method must not be empty');
  }
  if (methodBytes.byteLength > 0xffff) {
    throw new TypeError(
      `encodeBinaryRequest: method is too long (${methodBytes.byteLength} bytes; maximum 65535)`,
    );
  }
  const out = new Uint8Array(3 + methodBytes.byteLength + payload.byteLength);
  out[0] = FRAME_BINARY;
  new DataView(out.buffer).setUint16(1, methodBytes.byteLength, true);
  out.set(methodBytes, 3);
  out.set(payload, 3 + methodBytes.byteLength);
  return out;
}

/**
 * Deserialise reply-slot bytes into a {@link SyncRpcReply}. Branches on the
 * 1-byte discriminator (ADR-0084 #23): a 0x01 frame yields `{ok:true, value:
 * Uint8Array}` with no UTF-8/JSON round-trip (the U+FFFD-corruption fix).
 * @throws on UTF-8/JSON parse failure or an unknown discriminator — a protocol
 * bug, surface loudly. (A v1 reader can't reach this: it rejects the v2 frame
 * on the version guard first.)
 */
export function decodeReply(bytes: Uint8Array): SyncRpcReply {
  if (bytes.byteLength === 0) {
    // The double-consume signature: a second consumer read the reply slot
    // after REP_LEN was already cleared. Name it — the old "discriminator
    // 0x-1" message hid this exact CI flake for weeks.
    throw new TypeError(
      'decodeReply: empty reply frame (0 bytes) — reply slot already consumed (concurrent consumer?)',
    );
  }
  const kind = bytes[0];
  const body = bytes.subarray(1);
  if (kind === FRAME_BINARY) {
    // Copy out of the (possibly SAB-aliased, ADR-0084 #18) view so the value
    // survives the next slot write.
    return { ok: true, value: body.slice() };
  }
  if (kind !== FRAME_JSON) {
    throw new TypeError(
      `decodeReply: unknown frame discriminator 0x${(kind ?? -1).toString(16)} (frame ${bytes.byteLength} bytes)`,
    );
  }
  const text = decodeUtf8FromMaybeShared(body);
  const parsed = JSON.parse(text) as unknown;
  if (!isReply(parsed)) {
    throw new TypeError(`decodeReply: malformed reply frame: ${text}`);
  }
  return parsed;
}

/**
 * Mirror of {@link decodeReply} for the dispatcher side — reads JSON or
 * ADR-0366 binary request bytes from the SAB request slot.
 */
export function decodeRequest(bytes: Uint8Array): DecodedSyncRpcRequest {
  if (bytes.byteLength === 0) {
    throw new TypeError(
      'decodeRequest: empty request frame (0 bytes) — request slot already consumed (concurrent consumer?)',
    );
  }
  const kind = bytes[0];
  if (kind === FRAME_BINARY) {
    if (bytes.byteLength < 3) {
      throw new TypeError('decodeRequest: binary request is missing its u16 method length');
    }
    const methodLength = new DataView(bytes.buffer, bytes.byteOffset + 1, 2).getUint16(0, true);
    if (methodLength === 0) {
      throw new TypeError('decodeRequest: binary request method must not be empty');
    }
    const payloadOffset = 3 + methodLength;
    if (bytes.byteLength < payloadOffset) {
      throw new TypeError(
        `decodeRequest: binary request method declares ${methodLength} bytes, frame has ${bytes.byteLength - 3}`,
      );
    }
    let method: string;
    try {
      method = decodeUtf8FromMaybeShared(bytes.subarray(3, payloadOffset));
    } catch {
      throw new TypeError('decodeRequest: binary request method is not valid UTF-8');
    }
    return { binary: true, method, payload: bytes.subarray(payloadOffset).slice() };
  }
  if (kind !== FRAME_JSON) {
    throw new TypeError(
      `decodeRequest: expected JSON frame, got discriminator 0x${(kind ?? -1).toString(16)} (frame ${bytes.byteLength} bytes)`,
    );
  }
  const text = decodeUtf8FromMaybeShared(bytes.subarray(1));
  const parsed = JSON.parse(text) as unknown;
  if (!isRequest(parsed)) {
    throw new TypeError(`decodeRequest: malformed request frame: ${text}`);
  }
  // Normalize the wire value so user JSON cannot impersonate the binary
  // discriminator with a top-level `binary: true` field.
  return { method: parsed.method, payload: parsed.payload };
}

/** Mirror of {@link encodeRequest} for the dispatcher side. JSON frame. */
export function encodeReply(rep: SyncRpcReply): Uint8Array {
  const json = JSON.stringify(rep);
  if (typeof json !== 'string') {
    throw new TypeError('encodeReply: reply is not JSON-serialisable');
  }
  return frame(FRAME_JSON, UTF8_ENCODER.encode(json));
}

/**
 * Encode an `ok=true` reply whose value is raw bytes (ADR-0084 #23). The bytes
 * travel verbatim behind the {@link FRAME_BINARY} discriminator — no
 * TextDecoder, so non-UTF-8 `execSync` stdout is byte-exact end to end.
 */
export function encodeBinaryReply(value: Uint8Array): Uint8Array {
  return frame(FRAME_BINARY, value);
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
