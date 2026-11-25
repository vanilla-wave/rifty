// The real (no engine, no process, no worker) members of node:zlib, node:child_process,
// node:worker_threads; run by `node -e` and by the isolate guest, outputs compared exactly.
'use strict';
const util = require('node:util');
const zlib = require('node:zlib');
const cp = require('node:child_process');
const wt = require('node:worker_threads');
const out = [];
const attempt = (label, f) => {
  try {
    out.push(`${label} -> ${util.inspect(f())}`);
  } catch (e) {
    out.push(`${label} !! ${e.name} ${e.code} ${e.message}`);
  }
};
// Environment data: any key, `undefined` deletes, the latest write wins.
const key = {};
attempt('env unset', () => wt.getEnvironmentData('a'));
attempt('env set', () => wt.setEnvironmentData('a', 1));
attempt('env get', () => wt.getEnvironmentData('a'));
const setGet = (label, k, v, read = k) =>
  attempt(label, () => {
    wt.setEnvironmentData(k, v);
    return wt.getEnvironmentData(read);
  });
setGet('env object key', key, 'o');
setGet('env NaN key', Number.NaN, 'n');
setGet('env -0 is +0', -0, 'z', 0);
setGet('env null value', 'a', null);
setGet('env delete', 'a', undefined);
setGet('env no args', undefined, undefined);
// The data tables are read-only; constants stays extensible, codes is frozen.
attempt('constants write', () => {
  zlib.constants.Z_OK = 9;
});
attempt('constants delete', () => Reflect.deleteProperty(zlib.constants, 'Z_OK'));
attempt('constants add', () => {
  zlib.constants.extra = 1;
  return zlib.constants.extra;
});
attempt('codes write', () => {
  zlib.codes.Z_OK = 9;
});
attempt('codes add', () => {
  zlib.codes.extra = 1;
});
attempt('legacy write', () => {
  zlib.Z_OK = 9;
});
attempt('legacy delete', () => Reflect.deleteProperty(zlib, 'Z_OK'));
attempt('legacy read', () => [
  zlib.Z_OK,
  zlib.Z_MAX_CHUNK,
  zlib.ZSTD_CLEVEL_DEFAULT,
  zlib.BROTLI_MODE_TEXT,
]);
attempt('create* write', () => {
  zlib.createGzip = 1;
});
attempt('constants in', () => ['Z_OK' in zlib.constants, 'toString' in zlib.constants]);
// Module members are plain writable properties.
attempt('module write', () => {
  const was = wt.threadId;
  wt.threadId = 5;
  const now = wt.threadId;
  wt.threadId = was;
  return now;
});
attempt('promisify exec', () => util.promisify(cp.exec) === cp.exec[util.promisify.custom]);
attempt(
  'promisify execFile',
  () => util.promisify(cp.execFile) === cp.execFile[util.promisify.custom],
);
// No MessagePort can exist: every call is Node's argument error; LockManager is not constructible.
const keys = (f) => {
  try {
    f();
  } catch (e) {
    return Object.keys(e).join(',');
  }
};
for (const arg of [undefined, {}, 1, Object.create(wt.MessagePort.prototype)])
  attempt(`receiveMessageOnPort ${typeof arg}`, () => wt.receiveMessageOnPort(arg));
attempt('moveMessagePortToContext', () => wt.moveMessagePortToContext({}, {}));
attempt('moveMessagePortToContext keys', () => keys(() => wt.moveMessagePortToContext()));
attempt('LockManager', () => new (Object.getPrototypeOf(wt.locks).constructor)());
attempt('LockManager keys', () => keys(() => new (Object.getPrototypeOf(wt.locks).constructor)(1)));
attempt('locks tag', () => [String(wt.locks), Object.keys(wt.locks)]);
attempt('instanceof', () => [
  Object.create(zlib.Gzip.prototype) instanceof require('node:stream').Transform,
  Object.create(cp.ChildProcess.prototype) instanceof require('node:events'),
  Object.create(wt.Worker.prototype) instanceof require('node:events'),
]);
attempt('new without call', () => typeof zlib.ZstdCompress);
console.log(out.join('\n'));
