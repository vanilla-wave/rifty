// Collect every legacy node:url call Node v24.16.0's own url tests make, with live Node's result.
// Usage: node collect.cjs <node-src dir> <out cases.json>
// Each test file runs with a recording `url`; its asserts run against real Node (they pass).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const realUrl = require('node:url');
const { normalize } = require('./normalize.cjs');

const [srcDir, out] = process.argv.slice(2);
const FILES = [
  'test-url-parse-format.js',
  'test-url-format.js',
  'test-url-relative.js',
  'test-url-parse-invalid-input.js',
  'test-url-parse-query.js',
];
const FNS = ['parse', 'format', 'resolve', 'resolveObject'];
process.removeAllListeners('warning');
process.on('warning', () => {});

const cases = [];
const seen = new Set();
let depth = 0;
const recorder = { ...realUrl };
for (const fn of FNS) {
  recorder[fn] = (...args) => {
    // Only top-level calls from the test, JSON-representable args (no URL instances, no functions).
    if (depth === 0) {
      let key;
      try {
        if (args.some((a) => a instanceof realUrl.URL)) throw new Error('URL arg');
        // A legacy Url argument replays as url.parse(its href) (replay.cjs).
        const plain = args.map((a) => (a instanceof realUrl.Url ? { $parsed: a.href } : a));
        key = JSON.stringify([fn, plain], (_k, v) => (v === undefined ? { $undefined: true } : v));
      } catch {
        key = undefined;
      }
      if (key && !seen.has(key)) {
        seen.add(key);
        cases.push({ fn, args: JSON.parse(key)[1] });
      }
    }
    depth++;
    try {
      return realUrl[fn](...args);
    } finally {
      depth--;
    }
  };
}
const common = {
  hasIntl: true,
  mustCall: (f) => f ?? (() => {}),
  invalidArgTypeHelper: (v) =>
    v == null
      ? ` Received ${v}`
      : typeof v === 'function'
        ? ` Received function ${v.name}`
        : typeof v === 'object'
          ? ` Received an instance of ${v.constructor?.name}`
          : ` Received type ${typeof v} (${require('node:util').inspect(v)})`,
  // Subprocess warning checks are out of this corpus (warnings: README).
  spawnPromisified: () => new Promise(() => {}),
};
for (const file of FILES) {
  const source = fs.readFileSync(path.join(srcDir, file), 'utf8');
  const req = (id) => {
    if (id === '../common') return common;
    if (id === 'url' || id === 'node:url') return recorder;
    if (id === 'node:test')
      return { test: (...a) => a.findLast((x) => typeof x === 'function')?.() };
    return require(id);
  };
  try {
    new Function('require', 'module', 'exports', '__filename', source)(req, {}, {}, file);
  } catch (e) {
    console.error(`${file}: ${e.message.split('\n').slice(0, 8).join(' / ')}`);
  }
}
const { replay } = require('./replay.cjs');
for (const c of cases) c.node = normalize(() => replay(realUrl, c));
fs.writeFileSync(out, `${JSON.stringify(cases)}\n`);
console.log(`${cases.length} cases → ${out}`);
