import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer as RiftyBuffer } from '../../../../packages/io/src/index.ts';
import { serializeNodeIpcMessage } from '../../../../packages/runtime-js/src/internal/node-ipc-serialization.ts';

function outcome(fn) {
  try {
    return fn();
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
}

const dir = mkdtempSync(join(tmpdir(), 'rifty-ipc-prototype-oracle-'));
const childPath = join(dir, 'child.cjs');
writeFileSync(
  childPath,
  "process.on('message', m => process.send({buffer:Buffer.isBuffer(m.map.get('k')),bytes:[...m.map.get('k')]}));",
);

try {
  const child = fork(childPath, [], {
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const shared = new SharedArrayBuffer(2);
  Object.setPrototypeOf(shared, Object.prototype);
  const set = new Set([new SharedArrayBuffer(2)]);
  Object.setPrototypeOf(set, Object.prototype);
  const nodeMap = new Map([['k', Buffer.from([1, 2])]]);
  Object.setPrototypeOf(nodeMap, Object.prototype);
  const typed = new Uint8Array([1, 2]);
  Object.setPrototypeOf(typed, Object.prototype);
  const view = new DataView(new SharedArrayBuffer(2));
  Object.setPrototypeOf(view, Object.prototype);
  const nativeBuffer = Buffer.from([1, 2]);
  Object.setPrototypeOf(nativeBuffer, Object.prototype);
  const node = {
    raw: outcome(() => {
      child.send({ shared });
      return 'accepted';
    }),
    set: outcome(() => {
      child.send({ set });
      return 'accepted';
    }),
    typed: outcome(() => {
      child.send({ typed });
      return 'accepted';
    }),
    view: outcome(() => {
      child.send({ view });
      return 'accepted';
    }),
    buffer: outcome(() => {
      child.send({ buffer: nativeBuffer });
      return 'accepted';
    }),
    map: null,
  };
  const message = once(child, 'message');
  child.send({ map: nodeMap });
  node.map = (await message)[0];
  child.disconnect();
  await once(child, 'exit');

  const riftyMap = new Map([['k', RiftyBuffer.from([1, 2])]]);
  Object.setPrototypeOf(riftyMap, Object.prototype);
  const riftyBuffer = RiftyBuffer.from([1, 2]);
  Object.setPrototypeOf(riftyBuffer, Object.prototype);
  const rifty = {
    raw: outcome(() => serializeNodeIpcMessage({ shared }, 'advanced')),
    set: outcome(() => serializeNodeIpcMessage({ set }, 'advanced')),
    map: outcome(() => serializeNodeIpcMessage({ map: riftyMap }, 'advanced')),
    typed: outcome(() => serializeNodeIpcMessage({ typed }, 'advanced')),
    view: outcome(() => serializeNodeIpcMessage({ view }, 'advanced')),
    buffer: outcome(() => serializeNodeIpcMessage({ buffer: riftyBuffer }, 'advanced')),
  };
  console.log(JSON.stringify({ node, rifty }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
