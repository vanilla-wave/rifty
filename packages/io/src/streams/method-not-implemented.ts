/**
 * Node's `ERR_METHOD_NOT_IMPLEMENTED` for bare streams: a missing `_read`/
 * `_write`/`_transform` is a LOUD error in Node, never a silent no-op — the
 * old no-op/identity bases stalled or ACKed chunks they never processed.
 * Parity: `cases/stream/bare-stream-contract.case.ts`.
 */
export function methodNotImplementedError(method: string): Error {
  const err = new Error(`The ${method} method is not implemented`) as Error & { code: string };
  err.code = 'ERR_METHOD_NOT_IMPLEMENTED';
  return err;
}
