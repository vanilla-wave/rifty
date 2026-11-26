// A core stream's unhandled 'error' (Node: EventEmitter's `Emitted 'error' event on … at:` report).
const { Readable } = require('node:stream');
new Readable({ read() {} }).destroy(new Error('boom'));
