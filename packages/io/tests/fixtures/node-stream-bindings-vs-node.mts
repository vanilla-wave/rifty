// In a Node child with --expose-internals: rifty's stream-core bindings (io streams/node/bindings.ts)
// against Node's own, printed as JSON for node-stream-bindings.test.ts.
import { createRequire } from 'node:module';
import { primordials } from '../../src/streams/node/bindings.ts';
import { PRIMORDIALS } from '../../src/streams/node/generated/node-streams.js';

const require = createRequire(import.meta.url);
const emitWarning = process.emitWarning;
process.emitWarning = () => {};
const node = require('internal/test/binding') as {
  primordials: Record<string, unknown>;
  internalBinding: (id: string) => Record<string, unknown>;
};
process.emitWarning = emitWarning;
const shape = (v: unknown) =>
  typeof v === 'function'
    ? { type: 'function', name: v.name, length: v.length }
    : { type: typeof v };
const rows = (PRIMORDIALS as readonly string[]).map((n) => {
  const a = primordials[n];
  const b = node.primordials[n];
  return {
    name: n,
    identical: a === b,
    rifty: shape(a),
    node: shape(b),
  };
});
const zlib = node.internalBinding('constants').zlib as Record<string, number>;
const streamWrap = node.internalBinding('stream_wrap');
process.stdout.write(
  JSON.stringify({
    rows,
    extra: Object.keys(primordials).filter((n) => !(PRIMORDIALS as readonly string[]).includes(n)),
    zlib: Object.entries(zlib).map(([k, v]) => [k, String(v)]),
    streamWrap: Object.fromEntries(
      ['kReadBytesOrError', 'kArrayBufferOffset', 'kBytesWritten', 'kLastWriteWasAsync'].map(
        (k) => [k, streamWrap[k]],
      ),
    ),
    streamBaseStateLength: (streamWrap.streamBaseState as Int32Array).length,
    uvEof: node.internalBinding('uv').UV_EOF,
  }),
);
