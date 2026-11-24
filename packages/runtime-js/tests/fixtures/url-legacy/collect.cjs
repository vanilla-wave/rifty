// Regenerate the corpora from Node v24.16.0's own tests and Unicode 17.0.0 IdnaTestV2 (live Node).
// node --expose-internals collect.cjs <dir: Node's test/parallel/test-url-*.js, test-querystring*.js>
//   <Node's lib/url.js> <IdnaTestV2.txt>
// `idnaStep`: indices whose hostname reaches Node's `toASCII` with a non-ASCII or `xn--` label,
// recorded by a copy of Node's own lib/url.js with a spying `toASCII`.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const realUrl = require('node:url');
const realQs = require('node:querystring');
const { encode } = require('./codec.cjs');

if (process.version !== 'v24.16.0')
  throw new Error(`oracle is Node v24.16.0, not ${process.version}`);
const [srcDir, urlJs, idnaPath] = process.argv.slice(2);
const { internalBinding, primordials } = require('internal/test/binding');
const encoding = internalBinding('encoding_binding');
let stepHit = false;
const plainAscii = (h) => !/[\u0080-\uffff]/.test(h) && !/(?:^|\.)xn--/.test(h);
const spy = {
  ...encoding,
  toASCII(h) {
    if (!plainAscii(h)) stepHit = true;
    return encoding.toASCII(h);
  },
};
const copyModule = { exports: {} };
require('node:vm').compileFunction(fs.readFileSync(urlJs, 'utf8'), [
  'exports',
  'require',
  'module',
  'process',
  'internalBinding',
  'primordials',
])(
  copyModule.exports,
  require,
  copyModule,
  process,
  (name) => (name === 'encoding_binding' ? spy : internalBinding(name)),
  primordials,
);
const urlCopy = copyModule.exports;
const { decode } = require('./codec.cjs');
/** Indices of `items` whose `run(item)` makes the copy's `toASCII` see a non-plain hostname. */
function idnaStep(items, run) {
  const out = [];
  items.forEach((item, index) => {
    stepHit = false;
    try {
      run(item);
    } catch {}
    if (stepHit) out.push(index);
  });
  return out;
}
process.removeAllListeners('warning');
process.on('warning', () => {});

function recorder(real, fns, Url) {
  const calls = [];
  const seen = new Set();
  let depth = 0;
  const rec = { ...real };
  for (const fn of fns) {
    const orig = real[fn];
    rec[fn] = (...args) => {
      if (depth === 0) {
        const enc = encode(args, Url);
        const key = enc && JSON.stringify([fn, enc]);
        if (key && !seen.has(key)) {
          seen.add(key);
          calls.push({ fn, args: enc });
        }
      }
      depth++;
      try {
        return orig(...args);
      } finally {
        depth--;
      }
    };
  }
  return { rec, calls };
}
const url = recorder(realUrl, ['parse', 'format', 'resolve', 'resolveObject'], realUrl.Url);
const qs = recorder(realQs, [
  'parse',
  'stringify',
  'escape',
  'unescape',
  'unescapeBuffer',
  'encode',
  'decode',
]);
// A copy cannot see a test's own `qs.unescape = …` override: that assert fails and is counted, the
// file goes on (the override is a parity case, not a corpus call).
const realAssert = require('node:assert');
const failed = [];
const lenient = (f, name) =>
  function (...a) {
    try {
      return f.apply(this, a);
    } catch (e) {
      if (!(e instanceof realAssert.AssertionError)) throw e;
      failed.push(
        `${name}@${
          String(e.stack)
            .split('\n')
            .find((l) => l.includes('<anonymous>:'))
            ?.match(/<anonymous>:(\d+)/)?.[1]
        }`,
      );
    }
  };
const assert = lenient(realAssert, 'assert');
for (const k of Object.keys(realAssert))
  assert[k] = typeof realAssert[k] === 'function' ? lenient(realAssert[k], k) : realAssert[k];
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
  spawnPromisified: () => new Promise(() => {}),
};
const FILES = {
  url: [
    'test-url-parse-format.js',
    'test-url-format.js',
    'test-url-relative.js',
    'test-url-parse-invalid-input.js',
    'test-url-parse-query.js',
  ],
  querystring: [
    'test-querystring.js',
    'test-querystring-escape.js',
    'test-querystring-maxKeys-non-finite.js',
    'test-querystring-multichar-separator.js',
  ],
};
const sources = {};
for (const [kind, files] of Object.entries(FILES)) {
  for (const file of files) {
    const source = fs.readFileSync(path.join(srcDir, file), 'utf8');
    sources[file] = crypto.createHash('sha256').update(source).digest('hex');
    const req = (id) => {
      if (id === '../common') return common;
      if (id === 'url' || id === 'node:url') return kind === 'url' ? url.rec : realUrl;
      if (id === 'querystring' || id === 'node:querystring')
        return kind === 'querystring' ? qs.rec : realQs;
      if (id === 'assert' || id === 'node:assert') return assert;
      if (id === 'node:test')
        return { test: (...a) => a.findLast((x) => typeof x === 'function')?.() };
      return require(id);
    };
    new Function('require', 'module', 'exports', '__filename', source)(req, {}, {}, file);
  }
}
const idna = fs.readFileSync(idnaPath, 'utf8');
const unescape = (s) =>
  s
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/\\x\{([0-9A-Fa-f]+)\}/g, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)));
const idnaHosts = idna
  .split('\n')
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => unescape(line.split(';')[0].trim()));
const probe = JSON.parse(fs.readFileSync(path.join(__dirname, 'probe-hosts.json'), 'utf8'));
const here = (name) => path.join(__dirname, name);
const meta = { node: process.version, sources };
const urlStep = idnaStep(url.calls, (c) => urlCopy[c.fn](...decode(c.args, urlCopy)));
const hosts = [...idnaHosts, ...probe];
const hostStep = idnaStep(hosts, (h) => urlCopy.parse(`http://${h}/`));
const write = (name, value) => fs.writeFileSync(here(name), `${JSON.stringify(value)}\n`);
write('url-calls.json', { kind: 'url', ...meta, idnaStep: urlStep, calls: url.calls });
// `new Date()` arguments are wall-clock: fixed at the epoch, so a rerun is byte-identical.
const epoch = (v) =>
  Array.isArray(v)
    ? v.map(epoch)
    : v && typeof v === 'object'
      ? '$date' in v
        ? { $date: 0 }
        : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, epoch(x)]))
      : v;
write('querystring-calls.json', { kind: 'querystring', ...meta, calls: epoch(qs.calls) });
write('hosts.json', {
  kind: 'hosts',
  idnaTestV2: crypto.createHash('sha256').update(idna).digest('hex'),
  sections: [
    ['IdnaTestV2', idnaHosts.length],
    ['probe', probe.length],
  ],
  idnaStep: hostStep,
  hosts,
});
console.log(`failed asserts (copy recorder): ${failed.length} ${failed.join(',')}`);
console.log(
  `url ${url.calls.length} (idna step ${urlStep.length}), querystring ${qs.calls.length}, hosts ${hosts.length} (idna step ${hostStep.length})`,
);
