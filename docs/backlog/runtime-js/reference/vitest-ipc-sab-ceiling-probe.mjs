import { Buffer as NativeBuffer } from 'node:buffer';
import { serialize, deserialize } from 'node:v8';
import { Buffer as RiftyBuffer } from '../../../../packages/io/src/index.ts';
import { encodeAdvancedIpc, decodeAdvancedIpc } from '../../../../packages/runtime-js/src/internal/advanced-ipc-values.ts';

console.log('node', process.version);
for (const position of ['after', 'before']) {
  for (const [name, Buffer, clone] of [
    ['native-v8', NativeBuffer, (m) => deserialize(serialize(m))],
    ['rifty-e71', RiftyBuffer, (m) => decodeAdvancedIpc(encodeAdvancedIpc(m))],
  ]) {
    const b = Buffer.from(new SharedArrayBuffer(1));
    b[0] = 1;
    let gets = 0;
    const mutate = () => { gets++; b[0] = 2; return 0; };
    const message = position === 'after' ? { b, get after() { return mutate(); } } : { get before() { return mutate(); }, b };
    const result = clone(message);
    console.log(position, name, JSON.stringify({ received: result.b[0], source: b[0], gets, buffer: Buffer.isBuffer(result.b), shared: result.b.buffer instanceof SharedArrayBuffer }));
  }
}
for (const value of [new SharedArrayBuffer(1), new Uint8Array(new SharedArrayBuffer(1)), new DataView(new SharedArrayBuffer(1)), NativeBuffer.from(new SharedArrayBuffer(1))]) {
  try {
    const result = deserialize(serialize(value));
    console.log(value.constructor.name, 'native accepts', result.constructor.name, result.buffer instanceof SharedArrayBuffer);
  } catch (error) { console.log(value.constructor.name, 'native rejects', error.name); }
}
