import { decodeAdvancedIpcMessage, encodeAdvancedIpcMessage } from './node-ipc-advanced.ts';

/** Node child_process IPC `serialization`; JSON by default (ADR-0448 adds `advanced`). */
export type NodeIpcSerialization = 'json' | 'advanced';

/** Node's `Received …` tail for the rejected top-level types. */
function received(message: unknown): string {
  if (typeof message === 'function') return `function ${String(message.name)}`;
  if (typeof message === 'bigint') return `type bigint (${message}n)`;
  return `type symbol (${String(message)})`;
}

/** Node's `_send` checks, shared by both serializations. */
function validateNodeIpcMessage(message: unknown): void {
  if (message === undefined) {
    throw Object.assign(new TypeError('The "message" argument must be specified'), {
      code: 'ERR_MISSING_ARGS',
    });
  }
  const type = typeof message;
  if (type === 'function' || type === 'symbol' || type === 'bigint') {
    throw Object.assign(
      new TypeError(
        `The "message" argument must be one of type string, object, number, or boolean. Received ${received(message)}`,
      ),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
  }
}

function jsonCopy(message: unknown): unknown {
  const json = JSON.stringify(message);
  if (json === undefined) {
    throw new TypeError('The "message" argument could not be serialized');
  }
  return JSON.parse(json) as unknown;
}

/** Validates and encodes one `send()` message at the sender. */
export function encodeNodeIpcMessage(
  message: unknown,
  serialization: NodeIpcSerialization,
): unknown {
  validateNodeIpcMessage(message);
  return serialization === 'advanced' ? encodeAdvancedIpcMessage(message) : jsonCopy(message);
}

/** Delivers one received payload as the `'message'` value. */
export function decodeNodeIpcMessage(
  payload: unknown,
  serialization: NodeIpcSerialization,
): unknown {
  return serialization === 'advanced' ? decodeAdvancedIpcMessage(payload) : jsonCopy(payload);
}
