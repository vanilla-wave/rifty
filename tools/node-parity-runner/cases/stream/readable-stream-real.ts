/**
 * Shared guest program for the real readable-stream parity cases (v2/v3/v4,
 * `fixtures/npm/readable-stream`). Its `Readable.prototype.on` calls
 * `Stream.prototype.on.call(this, …)` and aliases `addListener = on`; every
 * step below goes through that override.
 */
export const FIXTURE = new URL('../../fixtures/npm/readable-stream/', import.meta.url);

export function readableStreamProgram(options: {
  readonly transform: string;
  readonly pipeline: boolean;
}): string {
  return `
    const rs = require('readable-stream');
    const log = [];
    const settle = (emitter, event) => new Promise((resolve) => emitter.once(event, resolve));

    (async () => {
      const flowing = new rs.Readable({ read() {} });
      const onData = (chunk) => log.push('data:' + chunk);
      flowing.on('data', onData);
      flowing.addListener('data', (chunk) => log.push('addListener:' + chunk));
      flowing.push('a');
      flowing.push('b');
      await new Promise((resolve) => setImmediate(resolve));
      flowing.off ? flowing.off('data', onData) : flowing.removeListener('data', onData);
      flowing.push('c');
      flowing.push(null);
      await settle(flowing, 'end');
      log.push('end listeners:' + flowing.listenerCount('data'));

      const chunks = [];
      const upper = ${options.transform};
      const sink = new rs.Writable({
        write(chunk, _enc, cb) { chunks.push(String(chunk)); cb(); },
      });
      const source = new rs.Readable({ read() {} });
      source.pipe(upper).pipe(sink);
      source.push('x');
      source.push('y');
      source.push(null);
      await settle(sink, 'finish');
      log.push('pipe:' + chunks.join(''));

      ${
        options.pipeline
          ? `const piped = [];
      await new Promise((resolve, reject) => rs.pipeline(
        new rs.Readable({ read() { this.push('p'); this.push('q'); this.push(null); } }),
        new rs.Writable({ write(chunk, _enc, cb) { piped.push(String(chunk)); cb(); } }),
        (err) => (err ? reject(err) : resolve()),
      ));
      log.push('pipeline:' + piped.join(''));`
          : ''
      }
      console.log(JSON.stringify(log));
    })().catch((e) => console.log('threw', e && e.name, e && e.message));
  `;
}
