/**
 * Node v24.16.0 internals shared by the isolate guest's generated Node sources (ADR-0578, ADR-0579),
 * one object each as in Node: `internal/util`'s constants, `internal/worker/js_transferable`'s
 * symbols (`internalBinding('symbols')` descriptions). Transfer marks serve `structuredClone`/
 * `postMessage`, ceilings here: `markTransferMode` records nothing.
 */
const freeze = Object.freeze;

export const kEmptyObject = freeze({ __proto__: null });
export const kEnumerableProperty = freeze({ __proto__: null, enumerable: true });
export const customInspectSymbol = Symbol.for('nodejs.util.inspect.custom');

export const jsTransferable = freeze({
  __proto__: null,
  markTransferMode(): void {},
  kClone: Symbol('messaging_clone_symbol'),
  kDeserialize: Symbol('messaging_deserialize_symbol'),
  kTransfer: Symbol('messaging_transfer_symbol'),
  kTransferList: Symbol('messaging_transfer_list_symbol'),
});
