import { decodeAdvancedIpc, encodeAdvancedIpc } from './advanced-ipc-values.ts';
export type NodeIpcSerialization = 'json' | 'advanced';

/** Node child_process IPC defaults to JSON serialization. */
export function serializeNodeIpcMessage(
  message: unknown,
  mode: NodeIpcSerialization = 'json',
): unknown {
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
  if (mode === 'advanced') return encodeAdvancedIpc(message);
  const json = JSON.stringify(message);
  if (json === undefined) {
    throw new TypeError('The "message" argument could not be serialized');
  }
  return JSON.parse(json) as unknown;
}

export function deserializeNodeIpcMessage(
  message: unknown,
  mode: NodeIpcSerialization = 'json',
): unknown {
  return mode === 'advanced' ? decodeAdvancedIpc(message) : serializeNodeIpcMessage(message);
}
