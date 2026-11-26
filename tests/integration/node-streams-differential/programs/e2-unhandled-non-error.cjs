// A core stream's unhandled 'error' whose value is no Error (Node: `Unhandled 'error' event`).
const { Readable } = require('node:stream');
new Readable({ read() {} }).destroy('str');
