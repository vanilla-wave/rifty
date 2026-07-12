import type { ParityCase } from '../../src/types.ts';

/**
 * Core Readable oracle for bounded no-progress refill, HWM admission, shared
 * byte backing, and EOF/destroy order. Every injected source is finite.
 */
const c: ParityCase = {
  expected: [
    'refill-undefined-hwm0:calls=1 ended=false reading=false length=0 entries=0',
    'refill-undefined-hwm1:calls=2 ended=false reading=false length=0 entries=0',
    'refill-empty-string-hwm0:calls=1 ended=false reading=false length=0 entries=0',
    'refill-empty-string-hwm1:calls=2 ended=false reading=false length=0 entries=0',
    'refill-empty-u8-hwm0:calls=1 ended=false reading=false length=0 entries=0',
    'refill-empty-u8-hwm1:calls=2 ended=false reading=false length=0 entries=0',
    'coalesce:calls=2 ended=false reading=false length=0 entries=0',
    'flowing-hwm0:calls=3 seen=x ended=true stateEnded=true length=0',
    'flowing-hwm1:calls=3 seen=x ended=true stateEnded=true length=0',
    'race-eof:calls=1 events= destroyed=false ended=true endEmitted=false reading=false',
    'race-destroy:calls=1 events=close destroyed=true ended=false endEmitted=false reading=false',
    'race-throw:calls=2 events=error,close destroyed=true reading=true stateIdentity=true emittedIdentity=true',
    'capacity-read0:calls=0 length=1 reading=false',
    'capacity-readable:calls=0 events=1 length=1 reading=false',
    'capacity-fromweb:before=1/1/false after=1/1/false events=1',
    'u8-alias:buffer=true distinct=true shared=true offset=true source=9 reverse=10',
    'u8-alias-readable-fromweb:buffer=true distinct=true shared=true offset=true source=9 reverse=10',
    'u8-alias-duplex-fromweb:buffer=true distinct=true shared=true offset=true source=9 reverse=10',
    'terminal-eof-data:return=false events=error:ERR_STREAM_PUSH_AFTER_EOF,close destroyed=true ended=true endEmitted=false errored=ERR_STREAM_PUSH_AFTER_EOF identity=true',
    'terminal-eof-destroy:events=close destroyed=true ended=true endEmitted=false errored=null',
    'terminal-destroy-eof:return=false events=close destroyed=true ended=true endEmitted=false errored=null',
  ].join('\n'),
  code: `
    const { Buffer } = require('node:buffer');
    const { Duplex, Readable } = require('node:stream');

    (async () => {
      const immediate = () => new Promise((resolve) => setImmediate(resolve));
      const errorCode = (error) => error && error.code ? error.code : 'null';
      const filtered = [
        ['undefined', undefined],
        ['empty-string', ''],
        ['empty-u8', new Uint8Array(0)],
      ];

      for (const [name, chunk] of filtered) {
        for (const highWaterMark of [0, 1]) {
          let calls = 0;
          const source = new Readable({
            highWaterMark,
            read() {
              calls++;
              if (calls <= 5) this.push(chunk);
              else this.push(null);
            },
          });
          source.read(0);
          await immediate();
          await immediate();
          await immediate();
          await immediate();
          console.log(
            'refill-' + name + '-hwm' + highWaterMark +
            ':calls=' + calls +
            ' ended=' + source._readableState.ended +
            ' reading=' + source._readableState.reading +
            ' length=' + source._readableState.length +
            ' entries=' + source._readableState.buffer.length,
          );
          source.destroy();
          await immediate();
        }
      }

      {
        let calls = 0;
        const source = new Readable({
          highWaterMark: 1,
          read() {
            calls++;
            if (calls <= 5) {
              this.push(undefined);
              this.push('');
              this.push(new Uint8Array(0));
            } else {
              this.push(null);
            }
          },
        });
        source.read(0);
        await immediate();
        await immediate();
        await immediate();
        await immediate();
        console.log(
          'coalesce:calls=' + calls +
          ' ended=' + source._readableState.ended +
          ' reading=' + source._readableState.reading +
          ' length=' + source._readableState.length +
          ' entries=' + source._readableState.buffer.length,
        );
        source.destroy();
        await immediate();
      }

      for (const highWaterMark of [0, 1]) {
        let calls = 0;
        let ended = false;
        const seen = [];
        const source = new Readable({
          highWaterMark,
          read() {
            calls++;
            if (calls === 1) this.push('');
            else if (calls === 2) this.push('x');
            else this.push(null);
          },
        });
        source.on('data', (chunk) => seen.push(String(chunk)));
        source.on('end', () => { ended = true; });
        await immediate();
        await immediate();
        await immediate();
        console.log(
          'flowing-hwm' + highWaterMark +
          ':calls=' + calls +
          ' seen=' + seen.join(',') +
          ' ended=' + ended +
          ' stateEnded=' + source._readableState.ended +
          ' length=' + source._readableState.length,
        );
        if (!source.destroyed) source.destroy();
        await immediate();
      }

      for (const terminal of ['eof', 'destroy']) {
        let calls = 0;
        const events = [];
        const overflow = new Error('unexpected second terminal-race read');
        const source = new Readable({
          highWaterMark: 1,
          read() {
            calls++;
            if (calls === 1) this.push('');
            else throw overflow;
          },
        });
        source.on('end', () => events.push('end'));
        source.on('error', (error) => events.push(error === overflow ? 'error:overflow' : 'error'));
        source.on('close', () => events.push('close'));
        source.read(0);
        if (terminal === 'eof') source.push(null);
        else source.destroy();
        await immediate();
        await immediate();
        console.log(
          'race-' + terminal +
          ':calls=' + calls +
          ' events=' + events.join(',') +
          ' destroyed=' + source.destroyed +
          ' ended=' + source._readableState.ended +
          ' endEmitted=' + source._readableState.endEmitted +
          ' reading=' + source._readableState.reading,
        );
        if (!source.destroyed) source.destroy();
        await immediate();
      }

      {
        const marker = { fault: 'queued-refill' };
        let calls = 0;
        let emitted;
        const events = [];
        const source = new Readable({
          highWaterMark: 1,
          read() {
            calls++;
            if (calls === 1) this.push('');
            else throw marker;
          },
        });
        source.on('error', (error) => { emitted = error; events.push('error'); });
        source.on('close', () => events.push('close'));
        source.read(0);
        await immediate();
        await immediate();
        console.log(
          'race-throw:calls=' + calls +
          ' events=' + events.join(',') +
          ' destroyed=' + source.destroyed +
          ' reading=' + source._readableState.reading +
          ' stateIdentity=' + (source._readableState.errored === marker) +
          ' emittedIdentity=' + (emitted === marker),
        );
      }

      {
        let calls = 0;
        const source = new Readable({
          objectMode: true,
          highWaterMark: 1,
          read() { calls++; this.push('generated'); },
        });
        source.push('prebuffered');
        source.read(0);
        console.log(
          'capacity-read0:calls=' + calls +
          ' length=' + source._readableState.length +
          ' reading=' + source._readableState.reading,
        );
        source.destroy();
        await immediate();
      }

      {
        let calls = 0;
        let events = 0;
        const source = new Readable({
          objectMode: true,
          highWaterMark: 1,
          read() { calls++; this.push('generated'); },
        });
        source.push('prebuffered');
        source.on('readable', () => { events++; });
        await immediate();
        console.log(
          'capacity-readable:calls=' + calls +
          ' events=' + events +
          ' length=' + source._readableState.length +
          ' reading=' + source._readableState.reading,
        );
        source.destroy();
        await immediate();
      }

      {
        let readerCalls = 0;
        let controller;
        const web = new ReadableStream({
          start(next) {
            controller = next;
          },
        }, { highWaterMark: 0 });
        const getReader = web.getReader.bind(web);
        Object.defineProperty(web, 'getReader', {
          value() {
            const reader = getReader();
            return {
              closed: reader.closed,
              read() { readerCalls++; return reader.read(); },
              cancel(reason) { return reader.cancel(reason); },
              releaseLock() { return reader.releaseLock(); },
            };
          },
        });
        const source = Readable.fromWeb(web, { highWaterMark: 1 });
        source.read(0);
        controller.enqueue(new Uint8Array([1]));
        await immediate();
        const before = readerCalls + '/' + source._readableState.length + '/' +
          source._readableState.reading;
        let events = 0;
        source.on('readable', () => { events++; });
        await immediate();
        const after = readerCalls + '/' + source._readableState.length + '/' +
          source._readableState.reading;
        console.log('capacity-fromweb:before=' + before + ' after=' + after + ' events=' + events);
        source.destroy();
        await immediate();
      }

      {
        const backing = new ArrayBuffer(6);
        const input = new Uint8Array(backing, 2, 2);
        input.set([7, 8]);
        const source = new Readable({ read() {} });
        source.push(input);
        input[0] = 9;
        const admitted = source.read(2);
        const buffer = Buffer.isBuffer(admitted);
        const distinct = admitted !== input;
        const shared = admitted.buffer === backing;
        const offset = admitted.byteOffset === input.byteOffset;
        const sourceMutation = admitted[0];
        admitted[1] = 10;
        console.log(
          'u8-alias:buffer=' + buffer +
          ' distinct=' + distinct +
          ' shared=' + shared +
          ' offset=' + offset +
          ' source=' + sourceMutation +
          ' reverse=' + input[1],
        );
        source.destroy();
        await immediate();
      }

      for (const adapter of ['readable', 'duplex']) {
        const backing = new ArrayBuffer(6);
        const input = new Uint8Array(backing, 2, 2);
        input.set([7, 8]);
        const web = new ReadableStream({
          start(next) { next.enqueue(input); next.close(); },
        });
        const source = adapter === 'readable'
          ? Readable.fromWeb(web)
          : Duplex.fromWeb({ readable: web, writable: new WritableStream() });
        source.read(2);
        await immediate();
        input[0] = 9;
        const admitted = source.read(2);
        const buffer = Buffer.isBuffer(admitted);
        const distinct = admitted !== input;
        const shared = admitted.buffer === backing;
        const offset = admitted.byteOffset === input.byteOffset;
        const sourceMutation = admitted[0];
        admitted[1] = 10;
        console.log(
          'u8-alias-' + adapter + '-fromweb:' +
          'buffer=' + buffer +
          ' distinct=' + distinct +
          ' shared=' + shared +
          ' offset=' + offset +
          ' source=' + sourceMutation +
          ' reverse=' + input[1],
        );
        source.destroy();
        await immediate();
      }

      {
        const source = new Readable({ read() {} });
        const events = [];
        let emittedError = null;
        source.on('end', () => events.push('end'));
        source.on('error', (error) => {
          emittedError = error;
          events.push('error:' + errorCode(error));
        });
        source.on('close', () => events.push('close'));
        source.push(null);
        const returned = source.push(new Uint8Array([1]));
        await immediate();
        console.log(
          'terminal-eof-data:return=' + returned +
          ' events=' + events.join(',') +
          ' destroyed=' + source.destroyed +
          ' ended=' + source._readableState.ended +
          ' endEmitted=' + source._readableState.endEmitted +
          ' errored=' + errorCode(source._readableState.errored) +
          ' identity=' + (source._readableState.errored === emittedError),
        );
      }

      {
        const source = new Readable({ read() {} });
        const events = [];
        source.on('end', () => events.push('end'));
        source.on('close', () => events.push('close'));
        source.push(null);
        source.destroy();
        await immediate();
        console.log(
          'terminal-eof-destroy:events=' + events.join(',') +
          ' destroyed=' + source.destroyed +
          ' ended=' + source._readableState.ended +
          ' endEmitted=' + source._readableState.endEmitted +
          ' errored=' + errorCode(source._readableState.errored),
        );
      }

      {
        const source = new Readable({ read() {} });
        const events = [];
        source.on('end', () => events.push('end'));
        source.on('close', () => events.push('close'));
        source.destroy();
        const returned = source.push(null);
        await immediate();
        console.log(
          'terminal-destroy-eof:return=' + returned +
          ' events=' + events.join(',') +
          ' destroyed=' + source.destroyed +
          ' ended=' + source._readableState.ended +
          ' endEmitted=' + source._readableState.endEmitted +
          ' errored=' + errorCode(source._readableState.errored),
        );
      }
    })();
  `,
};

export default c;
