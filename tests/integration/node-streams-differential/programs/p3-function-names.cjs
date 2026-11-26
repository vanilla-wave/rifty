// The core's functions and classes as a program sees them: `name`, `length`, `util.inspect`.
const util = require('node:util');
const stream = require('node:stream');
const fs = require('node:fs');
const show = (f) =>
  `${JSON.stringify(f.name)}/${f.length} ${util.inspect(f).replace(/\n\s*/g, ' ')}`;
for (const [k, f] of [
  ['stream.compose', stream.compose],
  ['stream.addAbortSignal', stream.addAbortSignal],
  ['stream._uint8ArrayToBuffer', stream._uint8ArrayToBuffer],
  ['Readable.prototype.compose', stream.Readable.prototype.compose],
  ['Writable.prototype.setDefaultEncoding', stream.Writable.prototype.setDefaultEncoding],
  ['Duplex.prototype.setDefaultEncoding', stream.Duplex.prototype.setDefaultEncoding],
  ['Stream.prototype.eventNames', stream.Stream.prototype.eventNames],
  ['Readable', stream.Readable],
  ['Transform', stream.Transform],
  ['pipeline', stream.pipeline],
  ['fs.ReadStream', fs.ReadStream],
  ['fs.WriteStream', fs.WriteStream],
])
  console.log(`${k} => ${show(f)}`);
console.log(
  `inspect(stream, depth 0) anonymous entries => ${
    util
      .inspect(stream, { depth: 0 })
      .split('\n')
      .filter((l) => /anonymous/.test(l)).length
  }`,
);
try {
  new stream.Readable({ highWaterMark: -1 });
} catch (e) {
  console.log(`error class => ${e.constructor.name} ${e.name} ${util.inspect(e.constructor)}`);
}
