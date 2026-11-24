// What a guest did to `Error` before `url.parse` (ADR-0574 §4, review round 2): name → setup.
// Program: a `node_modules` caller, then a user call; prints both hostnames, whether the guest's
// `Error` state is unchanged, then the warnings. `declared`: the walk is impossible, so the result
// is "unknown" and DEP0169 is not emitted (rifty's stdout = Node's without its `warning` line);
// otherwise rifty must print Node's stdout. `userCall: false`: the `node_modules` caller alone.
'use strict';
const ROWS = {
  'error-frozen': { declared: true, setup: 'Object.freeze(Error);' },
  'prepare-slot-non-writable': {
    declared: true,
    setup:
      "Object.defineProperty(Error, 'prepareStackTrace', { value: undefined, writable: false });",
  },
  'prepare-slot-accessor': {
    declared: true,
    setup:
      "let n = 0; Object.defineProperty(Error, 'prepareStackTrace', { get() { n++; return undefined; }, set() { n++; }, configurable: true });",
    tail: 'console.log(n);',
  },
  'error-not-extensible': {
    declared: true,
    setup: 'delete Error.prepareStackTrace; Object.preventExtensions(Error);',
  },
  'stack-trace-limit-sealed': {
    declared: true,
    setup:
      "Object.defineProperty(Error, 'stackTraceLimit', { value: 0, writable: false, configurable: false });",
  },
  'stack-trace-limit-writable-non-configurable': {
    declared: false,
    setup:
      "Object.defineProperty(Error, 'stackTraceLimit', { value: 0, writable: true, configurable: false });",
  },
  'stack-trace-limit-writable-non-configurable-node-modules-only': {
    declared: false,
    userCall: false,
    setup:
      "Object.defineProperty(Error, 'stackTraceLimit', { value: 0, writable: true, configurable: false });",
  },
  'stack-trace-limit-frozen-configurable': {
    declared: false,
    setup: "Object.defineProperty(Error, 'stackTraceLimit', { value: 0, writable: false });",
  },
  'guest-hook-throws': {
    declared: false,
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
      declared: row.declared,
      files: {
        'node_modules/p/package.json': '{"name":"p","main":"index.js"}',
        'node_modules/p/index.js':
          "const url = require('url'); module.exports = () => url.parse('http://a.com/').hostname;",
        'main.js': `${STATE}\n${row.setup}\nconst before = state();\nconsole.log(require('p')(), ${row.userCall === false ? "'-'" : "url.parse('http://b.com/').hostname"}, before === state());\n${row.tail ?? ''}`,
      },
    },
  ]),
);
