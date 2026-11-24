// Programs a guest may run around the legacy url API (ADR-0574 §2): name → { files, hosts }.
// `hosts`: where the row must equal live Node (`isolate`, `browser`). Patched: what Node's own
// code does not call live (it calls e.g. `String.prototype.charCodeAt` and `RegExp#exec` live).
'use strict';
const PATCH = (
  list,
) => `const call = () => { try { return JSON.stringify(run()); } catch (e) { return 'THROW ' + e.message; } };
console.log(call());
Reflect.apply = () => { throw new Error('guest apply'); };
for (const [o, k] of ${list}) o[k] = function () { throw new Error('guest ' + k); };
console.log(call());`;
module.exports = {
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
