/** Node child_process IPC defaults to JSON serialization (ADR-0211). */
export function serializeNodeIpcMessage(message: unknown): unknown {
  if (message === undefined) {
    throw Object.assign(new TypeError('The "message" argument must be specified'), {
      code: 'ERR_MISSING_ARGS',
    });
  }
  const messageType = typeof message;
  if (messageType === 'function' || messageType === 'symbol' || messageType === 'bigint') {
    throw Object.assign(
      new TypeError(
        'The "message" argument must be one of type string, object, number, or boolean',
      ),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
  }
  const json = JSON.stringify(message);
  // Top-level undefined/function/symbol are rejected above. From here JSON
  // failures (circular structures, nested BigInt) stay native uncoded
  // TypeErrors, matching Node's default child-process serializer.
  if (json === undefined) throw new Error('serializeNodeIpcMessage: unreachable JSON result');
  return JSON.parse(json) as unknown;
}
