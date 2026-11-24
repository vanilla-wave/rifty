// Bridge candidate: structuredClone as a round trip through a synchronous isolated-vm Callback
// whose arguments and result are copied with ExternalCopy semantics (V8 ValueSerializer).
// Probe only: no `transfer`, no DataCloneError mapping — errors are whatever the copy throws.
const host = globalThis.__hostClone;
// biome-ignore lint/performance/noDelete: probe input, deliberate
delete globalThis.__hostClone;
globalThis.structuredClone = function structuredClone(value, options) {
  // biome-ignore lint/style/noArguments: probe input, deliberate
  if (arguments.length === 0)
    throw Object.assign(new TypeError('The "value" argument must be specified'), {
      code: 'ERR_MISSING_ARGS',
    });
  if (options !== undefined && (options === null || typeof options !== 'object'))
    throw Object.assign(new TypeError('The "options" argument must be of type object.'), {
      code: 'ERR_INVALID_ARG_TYPE',
    });
  return host(value);
};
