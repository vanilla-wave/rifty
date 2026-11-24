// Programs a guest may run around the legacy url API (ADR-0574 §2): name → { files, hosts }.
// `hosts`: where the row must equal live Node (`isolate`, `browser`). Patched: what Node's own
// code does not call live (it calls e.g. `String.prototype.charCodeAt` and `RegExp#exec` live).
'use strict';
const PATCH = (
  list,
) => `const call = () => { try { return JSON.stringify(run()); } catch (e) { return 'THROW ' + e.message; } };
console.log(call());
const saved = [[Reflect, 'apply', Reflect.apply]];
Reflect.apply = () => { throw new Error('guest apply'); };
for (const [o, k] of ${list}) { saved.push([o, k, o[k]]); o[k] = function () { throw new Error('guest ' + k); }; }
const patched = call();
// Put back before printing: rifty's console and exit paths read them live
// (backlog/runtime-js/post-guest-paths-use-replaceable-intrinsics); this row is about url.
for (const [o, k, v] of saved) o[k] = v;
console.log(patched);`;
module.exports = {
  // Review rounds 1–3: guest programs that broke DEP0169's caller detection (url.parse threw, or
  // `.stack` of later errors became an array). DEP0169 is not emitted any more (ADR-0574, user's
  // choice 2026-11-24); each must give Node's stdout but for its DEP0169 line.
  'descriptor-attack-on-owner': {
    hosts: ['isolate', 'browser'],
    files: {
      'main.js': `const url = require('url'); require('vm').runInThisContext('0', { lineOffset: 1 });
Error.prepareStackTrace = () => 'guest'; const descriptor = Object.getOwnPropertyDescriptor; let reads = 0;
Object.getOwnPropertyDescriptor = function (o, k) { if (o === Error && k === 'prepareStackTrace' && ++reads === 4) throw new Error('guest descriptor'); return descriptor(o, k); };
let out; try { out = url.parse('http://a.com/').hostname; } catch (e) { out = 'THROW ' + e.message; }
Object.getOwnPropertyDescriptor = descriptor;
console.log(out); console.log('next stack', Array.isArray(new Error().stack) ? 'ARRAY' : typeof new Error().stack);`,
    },
  },
  'stack-edge-with-owner': {
    hosts: ['isolate', 'browser'],
    files: {
      'node_modules/p/package.json': '{"name":"p","main":"index.js"}',
      'node_modules/p/index.js':
        "const url = require('url'); module.exports = () => url.parse('http://a.com/');",
      'main.js': `const p = require('p'); require('vm').runInThisContext('1', { lineOffset: 3 });
Error.prepareStackTrace = function g() { return 'G'; };
function f() { try { f(); } catch {} try { p(); } catch {} }
for (let i = 0; i < 40; i++) new Function('f', 'let ' + Array.from({ length: i + 1 }, (_, j) => 'v' + j + '=' + j).join(',') + '; return f() + v0;')(f);
const s = new Error('x').stack; console.log(typeof s, Array.isArray(s) ? 'array' : s);`,
    },
  },
  'error-frozen-then-stack': {
    hosts: ['isolate', 'browser'],
    files: {
      'main.js': `const url = require('url'); Object.freeze(Error);
let out; try { out = url.parse('http://a.com/').hostname; } catch (e) { out = 'THROW ' + e.message; }
console.log(out, typeof new Error('x').stack);`,
    },
  },
  'patched-symbol-split': {
    hosts: ['browser'],
    files: {
      'main.js': `process.noDeprecation = true; const url = require('url');
const saved = String.prototype[Symbol.split];
String.prototype[Symbol.split] = () => { throw new Error('guest @@split'); };
let out; try { out = JSON.stringify([url.parse('http://ñ.com/').hostname, url.parse('http://xn--ida.ñ.com/').hostname]); } catch (e) { out = 'THROW ' + e.message; }
String.prototype[Symbol.split] = saved;
console.log(out);`,
    },
  },
  'patched-intrinsics': {
    hosts: ['isolate', 'browser'],
    files: {
      'main.js': `process.noDeprecation = true; const qs = require('querystring'); const url = require('url');
const run = () => [qs.parse('a=b&c=%41+d'), qs.stringify({ x: [1, 'y z'] }), url.parse('http://u@a.com:8/p?q=1#h', true), url.resolve('http://a.com/b/c', '../d'), url.format({ protocol: 'http', host: 'a.com', query: { x: 1 } })];
${PATCH("[[String.prototype, 'startsWith'], [Array.prototype, 'every'], [Array.prototype, 'some'], [String, 'fromCodePoint'], [Math, 'trunc']]")}`,
    },
  },
  'patched-intrinsics-idna': {
    hosts: ['browser'],
    files: {
      'main.js': `process.noDeprecation = true; const url = require('url');
const run = () => [url.parse('http://ñ.com/').hostname, url.parse('http://xn--ida.com/').hostname, url.parse('http://faß.de/').hostname];
${PATCH("[[String.prototype, 'split'], [String.prototype, 'startsWith'], [Array.prototype, 'join'], [Array.prototype, 'every'], [Array.prototype, 'some'], [String, 'fromCodePoint'], [Math, 'trunc']]")}`,
    },
  },
};
