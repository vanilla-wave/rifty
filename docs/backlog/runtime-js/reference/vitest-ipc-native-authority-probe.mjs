import { serialize } from 'node:v8';
import { Buffer } from '../../../../packages/io/src/index.ts';
import { encodeAdvancedIpc, decodeAdvancedIpc } from '../../../../packages/runtime-js/src/internal/advanced-ipc-values.ts';
console.log('node', process.version);
const old = Buffer.from([7]);
let gets = 0;
const root = { get a() { gets++; const fresh = Buffer.from([8]); return { old, fresh, repeat: fresh }; }, again: old };
const result = decodeAdvancedIpc(encodeAdvancedIpc(root));
console.log('normal Buffer', JSON.stringify({ gets, oldAlias: result.a.old === result.again, freshAlias: result.a.fresh === result.a.repeat, oldBuffer: Buffer.isBuffer(result.a.old), freshBuffer: Buffer.isBuffer(result.a.fresh), bytes: [result.a.old[0], result.a.fresh[0]] }));
const closePort = MessagePort.prototype.close;
for (const [name, factory] of [
  ['Promise', () => Promise.resolve(1)],
  ['async Promise', () => (async () => 1)()],
  ['custom newTarget Promise', () => Reflect.construct(Promise, [resolve => resolve(1)], class Other {})],
  ['WeakRef', () => new WeakRef({})],
  ['FinalizationRegistry', () => new FinalizationRegistry(() => {})],
  ['MessagePort', () => new MessageChannel().port1],
]) {
  const value = factory();
  Object.setPrototypeOf(value, null);
  let calls = 0;
  Object.defineProperty(value, 'x', { enumerable: true, get() { calls++; return Buffer.from([9]); } });
  for (const [mode, clone] of [['v8', serialize], ['rifty', encodeAdvancedIpc]]) {
    try { clone(value); console.log(name, mode, 'ACCEPTED', calls); }
    catch (error) { console.log(name, mode, error.name, 'getter-calls', calls); }
  }
  if (name === 'MessagePort') Reflect.apply(closePort, value, []);
}
