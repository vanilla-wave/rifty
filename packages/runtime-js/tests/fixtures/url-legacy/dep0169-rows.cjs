// DEP0169/DEP0170 window rows (ADR-0574 §4): name → files; each runs as `node main.js` in a fresh process.
'use strict';
const ON =
  "process.on('warning', (w) => console.log('warning', w.code));\nconst url = require('url');\n";
const NM = (body) => ({
  'node_modules/p/package.json': '{"name":"p","main":"index.js"}',
  'node_modules/p/index.js': body,
});
module.exports = {
  'user-twice': {
    'main.js': `${ON}url.parse('http://a.com/'); url.parse('http://b.com/'); console.log('done');`,
  },
  'node-modules-then-user': {
    ...NM(`const url = require('url'); module.exports = () => url.parse('http://a.com/');`),
    'main.js': `${ON}require('p')(); console.log('after p'); url.parse('http://a.com/'); console.log('done');`,
  },
  'resolve-from-node-modules': {
    ...NM(`const url = require('url'); module.exports = () => url.resolve('http://a.com/x', 'y');`),
    'main.js': `${ON}require('p')(); console.log('done');`,
  },
  'resolve-from-user': {
    'main.js': `${ON}url.resolve('http://a.com/x', 'y'); console.log('done');`,
  },
  'emit-3': {
    ...NM(`module.exports = (a) => a.emit('x');`),
    'main.js': `${ON}const E = require('events'); const a = new E(), b = new E(), c = new E();
a.on('x', b.emit.bind(b, 'y')); b.on('y', c.emit.bind(c, 'z')); c.on('z', url.parse.bind(null, 'http://a.com/'));
require('p')(a); console.log('done');`,
  },
  'emit-2': {
    ...NM(`module.exports = (b) => b.emit('y');`),
    'main.js': `${ON}const E = require('events'); const b = new E(), c = new E();
b.on('y', c.emit.bind(c, 'z')); c.on('z', url.parse.bind(null, 'http://a.com/'));
require('p')(b); console.log('done');`,
  },
  'user-frame-decides': {
    ...NM('module.exports = (f) => f();'),
    'main.js': `${ON}function w3() { return url.parse('http://a.com/'); } function w2() { return w3(); } function w1() { return w2(); }
require('p')(w1); console.log('done');`,
  },
  'node-modules-frame-decides': {
    ...NM(`const url = require('url'); module.exports = () => url.parse('http://a.com/');`),
    'main.js': `${ON}const nm = require('p'); function w3() { return nm(); } function w2() { return w3(); } function w1() { return w2(); }
w1(); console.log('done');`,
  },
  'stack-trace-limit-0': {
    ...NM(`const url = require('url'); module.exports = () => url.parse('http://a.com/');`),
    'main.js': `${ON}Error.stackTraceLimit = 0; require('p')(); console.log('after p'); url.parse('http://a.com/'); console.log('done', Error.stackTraceLimit);`,
  },
  'guest-prepare-stack-trace': {
    ...NM(`const url = require('url'); module.exports = () => url.parse('http://a.com/');`),
    'main.js': `${ON}let calls = 0; Error.prepareStackTrace = () => { calls++; return 'x'; }; require('p')(); console.log('after p'); url.parse('http://a.com/'); console.log('done', calls);`,
  },
  'eval-in-user': { 'main.js': `${ON}eval("url.parse('http://a.com/')"); console.log('done');` },
  'eval-in-node-modules': {
    ...NM(`const url = require('url'); module.exports = () => eval("url.parse('http://a.com/')");`),
    'main.js': `${ON}require('p')(); console.log('done');`,
  },
  'function-in-node-modules': {
    ...NM(
      `const url = require('url'); module.exports = () => new Function('u', "return u.parse('http://a.com/')")(url);`,
    ),
    'main.js': `${ON}require('p')(); console.log('done');`,
  },
  'function-in-user': {
    'main.js': `${ON}new Function('u', "return u.parse('http://a.com/')")(url); console.log('done');`,
  },
  'dep0170-once': {
    'main.js': `${ON}url.parse('http://a.com:xx/'); url.parse('http://b.com:yy/'); console.log('done');`,
  },
};
