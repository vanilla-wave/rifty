// `fs` as a program sees it in both columns: the column's own `fs`, with the stream classes and
// factories of the generated `internal/fs/streams`, as Node's lib/fs.js exposes them
// (`createReadStream(path, options)` → `new ReadStream(path, options)`).
'use strict';
exports.fsWithCoreStreams = (fs, { ReadStream, WriteStream }) =>
  Object.assign(Object.create(fs), {
    ReadStream,
    WriteStream,
    createReadStream: (path, options) => new ReadStream(path, options),
    createWriteStream: (path, options) => new WriteStream(path, options),
  });
