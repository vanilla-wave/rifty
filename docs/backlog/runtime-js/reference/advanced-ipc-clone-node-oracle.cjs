const { fork } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const dir = mkdtempSync(join(tmpdir(), 'rifty-advanced-ipc-oracle-'));
const childPath = join(dir, 'child.cjs');
writeFileSync(childPath, `
process.on('message', (message) => {
  if (message.kind === 'views') {
    const views = message.views;
    process.send({
      values: views.map((view) => ({
        type: Object.prototype.toString.call(view),
        bufferType: Object.prototype.toString.call(view.buffer),
        shared: view.buffer instanceof SharedArrayBuffer,
        bufferLength: view.buffer.byteLength,
        offset: view.byteOffset,
        length: view.byteLength,
        bytes: [...new Uint8Array(view.buffer, view.byteOffset, view.byteLength)],
      })),
      sameBuffer: views[0].buffer === views[1].buffer && views[1].buffer === views[2].buffer,
    });
  } else if (message.kind === 'map') {
    const value = message.map.get('key');
    process.send({ buffer: Buffer.isBuffer(value), type: value.constructor.name, bytes: [...value] });
  } else if (message.kind === 'set') {
    process.send({ value: Set.prototype.values.call(message.set).next().value });
  }
});
`);

function roundtrip(payload) {
  return new Promise((resolve, reject) => {
    const child = fork(childPath, [], {
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    child.once('error', reject);
    child.once('message', (value) => {
      child.disconnect();
      child.once('exit', (code) => {
        if (code === 0) resolve(value);
        else reject(new Error(`child exited ${code}`));
      });
    });
    child.send(payload);
  });
}

(async () => {
  try {
    const backing = new SharedArrayBuffer(8);
    new Uint8Array(backing).set([0, 1, 2, 3, 4, 5, 6, 7]);
    const views = await roundtrip({
      kind: 'views',
      views: [
        new Uint8Array(backing, 2, 3),
        new DataView(backing, 4, 2),
        new Uint16Array(backing, 2, 2),
      ],
    });
    const map = new Map([['key', Buffer.from([1, 2])]]);
    Object.defineProperty(map, Symbol.iterator, { value: () => [][Symbol.iterator]() });
    const mapResult = await roundtrip({ kind: 'map', map });
    const set = new Set([7]);
    Object.defineProperty(set, Symbol.iterator, {
      value: () => {
        throw new Error('user iterator called');
      },
    });
    const setResult = await roundtrip({ kind: 'set', set });
    console.log(process.version, JSON.stringify({ views, map: mapResult, set: setResult }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
