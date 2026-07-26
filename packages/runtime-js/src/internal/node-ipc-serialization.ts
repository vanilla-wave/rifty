/** Node child_process IPC defaults to JSON serialization. */
export function serializeNodeIpcMessage(message: unknown): unknown {
  if (message === undefined) {
    throw Object.assign(new TypeError('The "message" argument must be specified'), {
      code: 'ERR_MISSING_ARGS',
    });
  }
  const type = typeof message;
  if (type === 'function' || type === 'symbol' || type === 'bigint') {
    throw Object.assign(
      new TypeError(
        'The "message" argument must be one of type string, object, number, or boolean',
      ),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
  }
  const json = JSON.stringify(message);
  if (json === undefined) {
    throw new TypeError('The "message" argument could not be serialized');
  }
  return JSON.parse(json) as unknown;
}
