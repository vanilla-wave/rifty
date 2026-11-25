// What a guest did to `Error` before `url.parse` (review rounds 1–2): name → setup. Program: a
// `node_modules` caller, then a user call; prints both hostnames, whether the guest's `Error` state
// is unchanged, then the warnings. rifty emits no DEP0169 (ADR-0574, the user's choice 2026-11-24):
// its stdout is Node's without the `warning DEP0169` line. `userCall: false`: the caller alone.
'use strict';
const ROWS = {
  'error-frozen': { setup: 'Object.freeze(Error);' },
  'prepare-slot-non-writable': {
    setup:
      "Object.defineProperty(Error, 'prepareStackTrace', { value: undefined, writable: false });",
  },
  'prepare-slot-accessor': {
    setup:
      "let n = 0; Object.defineProperty(Error, 'prepareStackTrace', { get() { n++; return undefined; }, set() { n++; }, configurable: true });",
    tail: 'console.log(n);',
  },
  'error-not-extensible': {
    setup: 'delete Error.prepareStackTrace; Object.preventExtensions(Error);',
  },
  'stack-trace-limit-sealed': {
    setup:
      "Object.defineProperty(Error, 'stackTraceLimit', { value: 0, writable: false, configurable: false });",
  },
  'stack-trace-limit-writable-non-configurable': {
    setup:
      "Object.defineProperty(Error, 'stackTraceLimit', { value: 0, writable: true, configurable: false });",
  },
  'stack-trace-limit-writable-non-configurable-node-modules-only': {
    userCall: false,
    setup:
      "Object.defineProperty(Error, 'stackTraceLimit', { value: 0, writable: true, configurable: false });",
  },
  'stack-trace-limit-frozen-configurable': {
    setup: "Object.defineProperty(Error, 'stackTraceLimit', { value: 0, writable: false });",
  },
  'guest-hook-throws': {
    setup: "Error.prepareStackTrace = () => { throw new Error('hook'); };",
  },
};
const STATE = `const state = () => { const d = (k) => { const x = Object.getOwnPropertyDescriptor(Error, k); return x && Object.fromEntries(Object.entries(x).map(([a, b]) => [a, typeof b === 'function' ? 'fn' : b])); }; return JSON.stringify([Object.isExtensible(Error), d('prepareStackTrace'), d('stackTraceLimit')]); };
process.on('warning', (w) => console.log('warning', w.code));
const url = require('url');`;
module.exports = Object.fromEntries(
  Object.entries(ROWS).map(([name, row]) => [
    name,
    {
      files: {
        'node_modules/p/package.json': '{"name":"p","main":"index.js"}',
        'node_modules/p/index.js':
          "const url = require('url'); module.exports = () => url.parse('http://a.com/').hostname;",
        'main.js': `${STATE}\n${row.setup}\nconst before = state();\nconsole.log(require('p')(), ${row.userCall === false ? "'-'" : "url.parse('http://b.com/').hostname"}, before === state());\n${row.tail ?? ''}`,
      },
    },
  ]),
);
