import type { ParityCase } from '../../src/types.ts';

const oracleSurfaces = ['Writable', 'Duplex', 'Transform'] as const;
const oracleDestroyKinds = ['reason', 'clean'] as const;
const oracleOutcomes = ['success', 'error'] as const;
const terminalRaceExpected: string[] = [];
for (const surface of oracleSurfaces) {
  for (const destroyKind of oracleDestroyKinds) {
    for (const outcome of oracleOutcomes) {
      terminalRaceExpected.push(
        `late-final-${surface}-${destroyKind}-${outcome}:final>${
          destroyKind === 'reason'
            ? 'end-cb:true>error:true>close'
            : 'end-cb:ERR_STREAM_DESTROYED>close'
        }>before-late>after-late>${
          destroyKind === 'reason' ? 'state:true:false:false' : 'state:false:true:false'
        }`,
      );
    }
  }
}
for (const prefix of ['late-write', 'late-writev'] as const) {
  for (const surface of oracleSurfaces) {
    for (const destroyKind of oracleDestroyKinds) {
      for (const outcome of oracleOutcomes) {
        const callbacks =
          prefix === 'late-write'
            ? outcome === 'success'
              ? 'write-cb:true:false:false'
              : 'write-cb:false:true:false'
            : outcome === 'success'
              ? 'a:true:false:false>b:true:false:false'
              : 'a:false:true:false>b:false:true:false';
        const terminalState =
          destroyKind === 'reason'
            ? 'state:true:false:false'
            : outcome === 'success'
              ? 'state:false:true:false'
              : 'state:false:false:true';
        terminalRaceExpected.push(
          `${prefix}-${surface}-${destroyKind}-${outcome}:${
            prefix === 'late-write' ? 'write' : 'writev:ab'
          }>${destroyKind === 'reason' ? 'error:true>close' : 'close'}>before-late>${callbacks}>after-late>${terminalState}`,
        );
      }
    }
  }
}
for (const surface of oracleSurfaces) {
  terminalRaceExpected.push(
    `late-end-${surface}-natural:${surface === 'Writable' ? 'close>' : ''}before-late-end>late-end:ERR_STREAM_ALREADY_FINISHED>after-late-end:1`,
    `late-end-${surface}-clean:close>before-late-end>after-late-end:0`,
    `late-end-${surface}-reason:error>close>before-late-end>late-end:ERR_STREAM_DESTROYED>after-late-end:1`,
    `immediate-end-${surface}-reason:after-end>error>close>end-cb:ERR_STREAM_DESTROYED>calls:1`,
    `immediate-end-${surface}-clean:after-end>close>calls:0`,
  );
}

/** One finite oracle for scalar and batched Writable completion ownership. */
const c: ParityCase = {
  expected: [
    'finish-Writable:before>hook:x:len=1:writing=true>hook-after:len=0:writing=false>after-write:ret=true:len=0:writing=false:need=false>final>prefinish>final-after>after-end>write-cb>end-cb>finish>close',
    'finish-Duplex:before>hook:x:len=1:writing=true>hook-after:len=0:writing=false>after-write:ret=true:len=0:writing=false:need=false>final>prefinish>final-after>after-end>write-cb>end-cb>finish',
    'finish-Transform:before>hook:x:len=1:writing=true>hook-after:len=0:writing=false>after-write:ret=true:len=0:writing=false:need=false>final>prefinish>final-after>after-end>write-cb>end-cb>finish',
    'queue-Writable:hook:a:len=1:writing=true>returns:true:false:len=2:need=true>release-before>hook:b:len=1:writing=true>hook-after:b>drain:len=0:need=false>cb:a>release-after:len=0:need=false>cb:b',
    'queue-Duplex:hook:a:len=1:writing=true>returns:true:false:len=2:need=true>release-before>hook:b:len=1:writing=true>hook-after:b>drain:len=0:need=false>cb:a>release-after:len=0:need=false>cb:b',
    'queue-Transform:hook:a:len=1:writing=true>returns:true:false:len=2:need=true>release-before>hook:b:len=1:writing=true>hook-after:b>drain:len=0:need=false>cb:a>release-after:len=0:need=false>cb:b',
    'error-Writable:before>hook:x>hook-after>after:ret=false:len=0:writing=false:need=false>cb:true>error:true>close',
    'error-Duplex:before>hook:x>hook-after>after:ret=false:len=0:writing=false:need=false>cb:true>error:true>close',
    'error-Transform:before>hook:x>hook-after>after:ret=false:len=0:writing=false:need=false>cb:true>error:true>close',
    'writev-success-Writable:returns:true:false:len=2:need=true>before-uncork>writev:ab>writev-after>after-uncork:len=0:need=true>drain:len=0:need=false>cb:a>cb:b',
    'writev-success-Duplex:returns:true:false:len=2:need=true>before-uncork>writev:ab>writev-after>after-uncork:len=0:need=true>drain:len=0:need=false>cb:a>cb:b',
    'writev-success-Transform:returns:true:false:len=2:need=true>before-uncork>writev:ab>writev-after>after-uncork:len=0:need=true>drain:len=0:need=false>cb:a>cb:b',
    'writev-error-Writable:returns:true:false:len=2:need=true>before-uncork>writev:ab>writev-after>after-uncork:len=0:need=true>cb:a:true>cb:b:true>error:true>close',
    'writev-error-Duplex:returns:true:false:len=2:need=true>before-uncork>writev:ab>writev-after>after-uncork:len=0:need=true>cb:a:true>cb:b:true>error:true>close',
    'writev-error-Transform:returns:true:false:len=2:need=true>before-uncork>writev:ab>writev-after>after-uncork:len=0:need=true>cb:a:true>cb:b:true>error:true>close',
    'end-fifo-Writable:before>final>prefinish>final-after>after-end1>after-end2>end1:true>end2:true>finish>close',
    'end-fifo-Duplex:before>final>prefinish>final-after>after-end1>after-end2>end1:true>end2:true>finish',
    'end-fifo-Transform:before>final>prefinish>final-after>after-end1>after-end2>end1:true>end2:true>finish',
    'sync-write-error-end-Writable:before>hook:x>hook-after>after-write:false>after-end>write-cb:true>end-cb:true>error:true>close',
    'sync-write-error-end-Duplex:before>hook:x>hook-after>after-write:false>after-end>write-cb:true>end-cb:true>error:true>close',
    'sync-write-error-end-Transform:before>hook:x>hook-after>after-write:false>after-end>write-cb:true>end-cb:true>error:true>close',
    'async-write-error-queued-Writable:hook:a>returns:true:false>release-before>cb:a:true>cb:b:true>release-after>error:true>close',
    'async-write-error-queued-Duplex:hook:a>returns:true:false>release-before>cb:a:true>cb:b:true>release-after>error:true>close',
    'async-write-error-queued-Transform:hook:a>returns:true:false>release-before>cb:a:true>cb:b:true>release-after>error:true>close',
    'sync-final-error-Writable:before>final>final-after>after-end>error:true>close>end-cb:true',
    'sync-final-error-Duplex:before>final>final-after>after-end>error:true>close>end-cb:true',
    'sync-final-error-Transform:before>final>final-after>after-end>error:true>close>end-cb:true',
    'async-final-error-Writable:before>final>after-end>release-before>end-cb:true>release-after>error:true>close',
    'async-final-error-Duplex:before>final>after-end>release-before>end-cb:true>release-after>error:true>close',
    'async-final-error-Transform:before>final>after-end>release-before>end-cb:true>release-after>error:true>close',
    'destroy-error-Writable:final>before-destroy>after-destroy>end-cb:true>error:true>close',
    'destroy-error-Duplex:final>before-destroy>after-destroy>end-cb:true>error:true>close',
    'destroy-error-Transform:final>before-destroy>after-destroy>end-cb:true>error:true>close',
    'destroy-clean-Writable:final>before-destroy>after-destroy>end-cb:ERR_STREAM_DESTROYED>close',
    'destroy-clean-Duplex:final>before-destroy>after-destroy>end-cb:ERR_STREAM_DESTROYED>close',
    'destroy-clean-Transform:final>before-destroy>after-destroy>end-cb:ERR_STREAM_DESTROYED>close',
    'finish-destroy-Writable:final>end-cb:true>finish>error:true>close',
    'finish-destroy-Duplex:final>end-cb:true>finish>error:true>close',
    'finish-destroy-Transform:final>end-cb:true>finish>error:true>close',
    'end-destroy-Writable:final>end-cb:true>finish>error:true>close',
    'end-destroy-Duplex:final>end-cb:true>finish>error:true>close',
    'end-destroy-Transform:final>end-cb:true>finish>error:true>close',
    ...terminalRaceExpected,
    'async-writev-error-behind-Writable:writev:ab>after-uncork:true:2:release=true>queued:true:true>release-before>cb:a:true>cb:b:true>cb:c:true>cb:d:true>release-after>error:true>close',
    'async-writev-error-behind-Duplex:writev:ab>after-uncork:true:2:release=true>queued:true:true>release-before>cb:a:true>cb:b:true>cb:c:true>cb:d:true>release-after>error:true>close',
    'async-writev-error-behind-Transform:writev:ab>after-uncork:true:2:release=true>queued:true:true>release-before>cb:a:true>cb:b:true>cb:c:true>cb:d:true>release-after>error:true>close',
    'async-final-success-Writable:before>final>after-end>prefinish>after-release>end-cb:true>finish>close',
    'async-final-success-Duplex:before>final>after-end>prefinish>after-release>end-cb:true>finish',
    'async-final-success-Transform:before>final>after-end>prefinish>after-release>end-cb:true>finish',
    'natural-state-Writable:end:true:false:false>finish:false:false>close:true:true>after:true:true',
  ].join('\n'),
  code: `
    const { Duplex, Transform, Writable } = require('node:stream');

    (async () => {
      const phase = () => new Promise((resolve) => setImmediate(resolve));
      const scalarSurfaces = ['Writable', 'Duplex', 'Transform'];
      const batchSurfaces = ['Writable', 'Duplex', 'Transform'];
      const destroyKinds = ['reason', 'clean'];
      const lateOutcomes = ['success', 'error'];

      const scalarTarget = (surface, highWaterMark, write, final) => {
        if (surface === 'Writable') return new Writable({ highWaterMark, write, final });
        if (surface === 'Duplex') {
          return new Duplex({ highWaterMark, read() {}, write, final });
        }
        const options = { highWaterMark, transform: write };
        if (final) options.flush = final;
        return new Transform(options);
      };

      const batchTarget = (surface, highWaterMark, events, writev) => {
        const options = {
          highWaterMark,
          write(_chunk, _encoding, callback) {
            events.push('unexpected-write');
            callback();
          },
          writev,
        };
        return surface === 'Writable'
          ? new Writable(options)
          : surface === 'Duplex'
            ? new Duplex({ ...options, read() {} })
            : new Transform(options);
      };
      const batchOwner = (stream) => stream.writableSide || stream;

      for (const surface of scalarSurfaces) {
        const events = [];
        let stream;
        const write = (chunk, _encoding, callback) => {
          events.push(
            'hook:' + String(chunk) +
            ':len=' + stream.writableLength +
            ':writing=' + stream._writableState.writing
          );
          callback();
          events.push(
            'hook-after:len=' + stream.writableLength +
            ':writing=' + stream._writableState.writing
          );
        };
        const final = (callback) => {
          events.push('final');
          callback();
          events.push('final-after');
        };
        stream = scalarTarget(surface, 1, write, final);
        stream.on('prefinish', () => events.push('prefinish'));
        stream.on('finish', () => events.push('finish'));
        stream.on('close', () => events.push('close'));
        events.push('before');
        const returned = stream.write('x', () => events.push('write-cb'));
        events.push(
          'after-write:ret=' + returned +
          ':len=' + stream.writableLength +
          ':writing=' + stream._writableState.writing +
          ':need=' + stream._writableState.needDrain
        );
        stream.end(() => events.push('end-cb'));
        events.push('after-end');
        await phase();
        console.log('finish-' + surface + ':' + events.join('>'));
        if (!stream.destroyed) stream.destroy();
        await phase();
      }

      for (const surface of scalarSurfaces) {
        const events = [];
        let stream;
        let calls = 0;
        let release;
        const write = (chunk, _encoding, callback) => {
          calls++;
          events.push(
            'hook:' + String(chunk) +
            ':len=' + stream.writableLength +
            ':writing=' + stream._writableState.writing
          );
          if (calls === 1) release = callback;
          else {
            callback();
            events.push('hook-after:' + String(chunk));
          }
        };
        stream = scalarTarget(surface, 2, write);
        stream.on('drain', () => {
          events.push(
            'drain:len=' + stream.writableLength +
            ':need=' + stream._writableState.needDrain
          );
        });
        const first = stream.write('a', () => events.push('cb:a'));
        const second = stream.write('b', () => events.push('cb:b'));
        events.push(
          'returns:' + first + ':' + second +
          ':len=' + stream.writableLength +
          ':need=' + stream._writableState.needDrain
        );
        events.push('release-before');
        release();
        events.push(
          'release-after:len=' + stream.writableLength +
          ':need=' + stream._writableState.needDrain
        );
        await phase();
        console.log('queue-' + surface + ':' + events.join('>'));
        stream.destroy();
        await phase();
      }

      for (const surface of scalarSurfaces) {
        const failure = new Error('sync-' + surface);
        const events = [];
        const write = (chunk, _encoding, callback) => {
          events.push('hook:' + String(chunk));
          callback(failure);
          events.push('hook-after');
        };
        const stream = scalarTarget(surface, 1, write);
        stream.on('error', (error) => events.push('error:' + (error === failure)));
        stream.on('close', () => events.push('close'));
        events.push('before');
        const returned = stream.write('x', (error) => events.push('cb:' + (error === failure)));
        events.push(
          'after:ret=' + returned +
          ':len=' + stream.writableLength +
          ':writing=' + stream._writableState.writing +
          ':need=' + stream._writableState.needDrain
        );
        await phase();
        console.log('error-' + surface + ':' + events.join('>'));
      }

      for (const surface of batchSurfaces) {
        const events = [];
        let stream;
        stream = batchTarget(surface, 2, events, (chunks, callback) => {
          events.push('writev:' + chunks.map(({ chunk }) => String(chunk)).join(''));
          callback();
          events.push('writev-after');
        });
        stream.on('drain', () => {
          events.push(
            'drain:len=' + stream.writableLength +
            ':need=' + stream._writableState.needDrain
          );
        });
        batchOwner(stream).cork();
        const first = stream.write('a', () => events.push('cb:a'));
        const second = stream.write('b', () => events.push('cb:b'));
        events.push(
          'returns:' + first + ':' + second +
          ':len=' + stream.writableLength +
          ':need=' + stream._writableState.needDrain
        );
        events.push('before-uncork');
        batchOwner(stream).uncork();
        events.push(
          'after-uncork:len=' + stream.writableLength +
          ':need=' + stream._writableState.needDrain
        );
        await phase();
        console.log('writev-success-' + surface + ':' + events.join('>'));
        stream.destroy();
        await phase();
      }

      for (const surface of batchSurfaces) {
        const failure = new Error('writev-' + surface);
        const events = [];
        let stream;
        stream = batchTarget(surface, 2, events, (chunks, callback) => {
          events.push('writev:' + chunks.map(({ chunk }) => String(chunk)).join(''));
          callback(failure);
          events.push('writev-after');
        });
        stream.on('error', (error) => events.push('error:' + (error === failure)));
        stream.on('close', () => events.push('close'));
        batchOwner(stream).cork();
        const first = stream.write('a', (error) => events.push('cb:a:' + (error === failure)));
        const second = stream.write('b', (error) => events.push('cb:b:' + (error === failure)));
        events.push(
          'returns:' + first + ':' + second +
          ':len=' + stream.writableLength +
          ':need=' + stream._writableState.needDrain
        );
        events.push('before-uncork');
        batchOwner(stream).uncork();
        events.push(
          'after-uncork:len=' + stream.writableLength +
          ':need=' + stream._writableState.needDrain
        );
        await phase();
        console.log('writev-error-' + surface + ':' + events.join('>'));
      }

      for (const surface of scalarSurfaces) {
        const events = [];
        const write = (_chunk, _encoding, callback) => callback();
        const final = (callback) => {
          events.push('final');
          callback();
          events.push('final-after');
        };
        const stream = scalarTarget(surface, 1, write, final);
        stream.on('prefinish', () => events.push('prefinish'));
        stream.on('finish', () => events.push('finish'));
        stream.on('close', () => events.push('close'));
        events.push('before');
        stream.end((error) => events.push('end1:' + (error === null)));
        events.push('after-end1');
        stream.end((error) => events.push('end2:' + (error === null)));
        events.push('after-end2');
        await phase();
        console.log('end-fifo-' + surface + ':' + events.join('>'));
        if (!stream.destroyed) stream.destroy();
        await phase();
      }

      for (const surface of scalarSurfaces) {
        const failure = new Error('write-end-' + surface);
        const events = [];
        const write = (chunk, _encoding, callback) => {
          events.push('hook:' + String(chunk));
          callback(failure);
          events.push('hook-after');
        };
        const final = (callback) => {
          events.push('forbidden-final');
          callback();
        };
        const stream = scalarTarget(surface, 2, write, final);
        stream.on('prefinish', () => events.push('forbidden-prefinish'));
        stream.on('error', (error) => events.push('error:' + (error === failure)));
        stream.on('close', () => events.push('close'));
        events.push('before');
        const returned = stream.write(
          'x',
          (error) => events.push('write-cb:' + (error === failure))
        );
        events.push('after-write:' + returned);
        stream.end((error) => events.push('end-cb:' + (error === failure)));
        events.push('after-end');
        await phase();
        console.log('sync-write-error-end-' + surface + ':' + events.join('>'));
      }

      for (const surface of scalarSurfaces) {
        const failure = new Error('queued-' + surface);
        const events = [];
        let release;
        const stream = scalarTarget(surface, 2, (chunk, _encoding, callback) => {
          events.push('hook:' + String(chunk));
          release = callback;
        });
        stream.on('error', (error) => events.push('error:' + (error === failure)));
        stream.on('close', () => events.push('close'));
        const first = stream.write('a', (error) => events.push('cb:a:' + (error === failure)));
        const second = stream.write('b', (error) => events.push('cb:b:' + (error === failure)));
        events.push('returns:' + first + ':' + second);
        events.push('release-before');
        release(failure);
        events.push('release-after');
        await phase();
        console.log('async-write-error-queued-' + surface + ':' + events.join('>'));
      }

      for (const surface of scalarSurfaces) {
        const failure = new Error('final-' + surface);
        const events = [];
        const write = (_chunk, _encoding, callback) => callback();
        const final = (callback) => {
          events.push('final');
          callback(failure);
          events.push('final-after');
        };
        const stream = scalarTarget(surface, 1, write, final);
        stream.on('prefinish', () => events.push('forbidden-prefinish'));
        stream.on('finish', () => events.push('forbidden-finish'));
        stream.on('error', (error) => events.push('error:' + (error === failure)));
        stream.on('close', () => events.push('close'));
        events.push('before');
        stream.end((error) => events.push('end-cb:' + (error === failure)));
        events.push('after-end');
        await phase();
        console.log('sync-final-error-' + surface + ':' + events.join('>'));
      }

      for (const surface of scalarSurfaces) {
        const failure = new Error('async-final-' + surface);
        const events = [];
        let release;
        const write = (_chunk, _encoding, callback) => callback();
        const final = (callback) => {
          events.push('final');
          release = callback;
        };
        const stream = scalarTarget(surface, 1, write, final);
        stream.on('prefinish', () => events.push('forbidden-prefinish'));
        stream.on('finish', () => events.push('forbidden-finish'));
        stream.on('error', (error) => events.push('error:' + (error === failure)));
        stream.on('close', () => events.push('close'));
        events.push('before');
        stream.end((error) => events.push('end-cb:' + (error === failure)));
        events.push('after-end');
        events.push('release-before');
        release(failure);
        events.push('release-after');
        await phase();
        console.log('async-final-error-' + surface + ':' + events.join('>'));
      }

      for (const surface of scalarSurfaces) {
        const failure = new Error('destroy-' + surface);
        const events = [];
        const write = (_chunk, _encoding, callback) => callback();
        const final = (_callback) => events.push('final');
        const stream = scalarTarget(surface, 1, write, final);
        stream.on('error', (error) => events.push('error:' + (error === failure)));
        stream.on('close', () => events.push('close'));
        stream.end((error) => events.push('end-cb:' + (error === failure)));
        events.push('before-destroy');
        stream.destroy(failure);
        events.push('after-destroy');
        await phase();
        console.log('destroy-error-' + surface + ':' + events.join('>'));
      }

      for (const surface of scalarSurfaces) {
        const events = [];
        const write = (_chunk, _encoding, callback) => callback();
        const final = (_callback) => events.push('final');
        const stream = scalarTarget(surface, 1, write, final);
        stream.on('error', (error) => events.push('forbidden-error:' + error.code));
        stream.on('close', () => events.push('close'));
        stream.end((error) => events.push('end-cb:' + (error && error.code)));
        events.push('before-destroy');
        stream.destroy();
        events.push('after-destroy');
        await phase();
        console.log('destroy-clean-' + surface + ':' + events.join('>'));
      }

      for (const surface of scalarSurfaces) {
        const failure = new Error('finish-destroy-' + surface);
        const events = [];
        const write = (_chunk, _encoding, callback) => callback();
        const final = (callback) => {
          events.push('final');
          callback();
        };
        const stream = scalarTarget(surface, 1, write, final);
        stream.on('finish', () => {
          events.push('finish');
          stream.destroy(failure);
        });
        stream.on('error', (error) => events.push('error:' + (error === failure)));
        stream.on('close', () => events.push('close'));
        stream.end((error) => events.push('end-cb:' + (error === null)));
        await phase();
        console.log('finish-destroy-' + surface + ':' + events.join('>'));
      }

      for (const surface of scalarSurfaces) {
        const failure = new Error('end-destroy-' + surface);
        const events = [];
        const write = (_chunk, _encoding, callback) => callback();
        const final = (callback) => {
          events.push('final');
          callback();
        };
        const stream = scalarTarget(surface, 1, write, final);
        stream.on('finish', () => events.push('finish'));
        stream.on('error', (error) => events.push('error:' + (error === failure)));
        stream.on('close', () => events.push('close'));
        stream.end((error) => {
          events.push('end-cb:' + (error === null));
          stream.destroy(failure);
        });
        await phase();
        console.log('end-destroy-' + surface + ':' + events.join('>'));
      }

      for (const surface of scalarSurfaces) {
        for (const destroyKind of destroyKinds) {
          for (const outcome of lateOutcomes) {
            const destroyError = new Error('destroy-' + surface);
            const lateError = new Error('late-final-' + surface);
            const events = [];
            let release;
            const write = (_chunk, _encoding, callback) => callback();
            const final = (callback) => {
              events.push('final');
              release = callback;
            };
            const stream = scalarTarget(surface, 1, write, final);
            stream.on('prefinish', () => events.push('forbidden-prefinish'));
            stream.on('finish', () => events.push('forbidden-finish'));
            stream.on('error', (error) => events.push('error:' + (error === destroyError)));
            stream.on('close', () => events.push('close'));
            stream.end((error) => {
              events.push(
                destroyKind === 'reason'
                  ? 'end-cb:' + (error === destroyError)
                  : 'end-cb:' + (error && error.code)
              );
            });
            stream.destroy(destroyKind === 'reason' ? destroyError : undefined);
            await phase();
            events.push('before-late');
            release(outcome === 'error' ? lateError : undefined);
            events.push('after-late');
            await phase();
            const terminalError = stream._writableState.errored;
            events.push(
              'state:' + (terminalError === destroyError) +
              ':' + (terminalError === null) +
              ':' + (terminalError === lateError)
            );
            console.log(
              'late-final-' + surface + '-' + destroyKind + '-' + outcome + ':' + events.join('>')
            );
          }
        }
      }

      for (const surface of scalarSurfaces) {
        for (const destroyKind of destroyKinds) {
          for (const outcome of lateOutcomes) {
            const destroyError = new Error('destroy-write-' + surface);
            const lateError = new Error('late-write-' + surface);
            const events = [];
            let release;
            const stream = scalarTarget(surface, 1, (_chunk, _encoding, callback) => {
              events.push('write');
              release = callback;
            });
            stream.on('error', (error) => events.push('error:' + (error === destroyError)));
            stream.on('close', () => events.push('close'));
            stream.write('x', (error) => {
              events.push(
                'write-cb:' + (error === null) +
                ':' + (error === lateError) +
                ':' + (error === destroyError)
              );
            });
            stream.destroy(destroyKind === 'reason' ? destroyError : undefined);
            await phase();
            events.push('before-late');
            release(outcome === 'error' ? lateError : undefined);
            events.push('after-late');
            await phase();
            const terminalError = stream._writableState.errored;
            events.push(
              'state:' + (terminalError === destroyError) +
              ':' + (terminalError === null) +
              ':' + (terminalError === lateError)
            );
            console.log(
              'late-write-' + surface + '-' + destroyKind + '-' + outcome + ':' + events.join('>')
            );
          }
        }
      }

      for (const surface of batchSurfaces) {
        for (const destroyKind of destroyKinds) {
          for (const outcome of lateOutcomes) {
            const destroyError = new Error('destroy-writev-' + surface);
            const lateError = new Error('late-writev-' + surface);
            const events = [];
            let release;
            const stream = batchTarget(surface, 8, events, (chunks, callback) => {
              events.push('writev:' + chunks.map(({ chunk }) => String(chunk)).join(''));
              release = callback;
            });
            stream.on('error', (error) => events.push('error:' + (error === destroyError)));
            stream.on('close', () => events.push('close'));
            const owner = batchOwner(stream);
            owner.cork();
            for (const chunk of ['a', 'b']) {
              stream.write(chunk, (error) => {
                events.push(
                  chunk + ':' + (error === null) +
                  ':' + (error === lateError) +
                  ':' + (error === destroyError)
                );
              });
            }
            owner.uncork();
            stream.destroy(destroyKind === 'reason' ? destroyError : undefined);
            await phase();
            events.push('before-late');
            release(outcome === 'error' ? lateError : undefined);
            events.push('after-late');
            await phase();
            const terminalError = stream._writableState.errored;
            events.push(
              'state:' + (terminalError === destroyError) +
              ':' + (terminalError === null) +
              ':' + (terminalError === lateError)
            );
            console.log(
              'late-writev-' + surface + '-' + destroyKind + '-' + outcome + ':' + events.join('>')
            );
          }
        }
      }

      for (const surface of scalarSurfaces) {
        for (const terminalKind of ['natural', 'clean', 'reason']) {
          const destroyError = new Error('terminal-' + surface);
          const events = [];
          let calls = 0;
          const stream = scalarTarget(surface, 1, (_chunk, _encoding, callback) => callback());
          stream.on('error', () => events.push('error'));
          stream.on('close', () => events.push('close'));
          if (terminalKind === 'natural') stream.end();
          else stream.destroy(terminalKind === 'reason' ? destroyError : undefined);
          await phase();
          events.push('before-late-end');
          stream.end((error) => {
            calls++;
            events.push('late-end:' + (error && error.code));
          });
          await phase();
          await phase();
          events.push('after-late-end:' + calls);
          console.log('late-end-' + surface + '-' + terminalKind + ':' + events.join('>'));
          if (!stream.destroyed) stream.destroy();
          await phase();
        }

        for (const destroyKind of destroyKinds) {
          const destroyError = new Error('immediate-' + surface);
          const events = [];
          let calls = 0;
          const stream = scalarTarget(surface, 1, (_chunk, _encoding, callback) => callback());
          stream.on('error', () => events.push('error'));
          stream.on('close', () => events.push('close'));
          stream.destroy(destroyKind === 'reason' ? destroyError : undefined);
          stream.end((error) => {
            calls++;
            events.push('end-cb:' + (error && error.code));
          });
          events.push('after-end');
          await phase();
          await phase();
          events.push('calls:' + calls);
          console.log('immediate-end-' + surface + '-' + destroyKind + ':' + events.join('>'));
        }
      }

      for (const surface of batchSurfaces) {
        const failure = new Error('writev-behind-' + surface);
        const events = [];
        let release;
        const stream = batchTarget(surface, 8, events, (chunks, callback) => {
          events.push('writev:' + chunks.map(({ chunk }) => String(chunk)).join(''));
          release = callback;
        });
        stream.on('error', (error) => events.push('error:' + (error === failure)));
        stream.on('close', () => events.push('close'));
        const owner = batchOwner(stream);
        owner.cork();
        stream.write('a', (error) => events.push('cb:a:' + (error === failure)));
        stream.write('b', (error) => events.push('cb:b:' + (error === failure)));
        owner.uncork();
        events.push(
          'after-uncork:' + stream._writableState.writing +
          ':' + stream.writableLength +
          ':release=' + (release !== undefined)
        );
        const third = stream.write('c', (error) => events.push('cb:c:' + (error === failure)));
        const fourth = stream.write('d', (error) => events.push('cb:d:' + (error === failure)));
        events.push('queued:' + third + ':' + fourth);
        events.push('release-before');
        release(failure);
        events.push('release-after');
        await phase();
        console.log('async-writev-error-behind-' + surface + ':' + events.join('>'));
      }

      for (const surface of scalarSurfaces) {
        const events = [];
        let release;
        const write = (_chunk, _encoding, callback) => callback();
        const final = (callback) => {
          events.push('final');
          release = callback;
        };
        const stream = scalarTarget(surface, 1, write, final);
        stream.on('prefinish', () => events.push('prefinish'));
        stream.on('finish', () => events.push('finish'));
        stream.on('close', () => events.push('close'));
        events.push('before');
        stream.end((error) => events.push('end-cb:' + (error === null)));
        events.push('after-end');
        release();
        events.push('after-release');
        await phase();
        console.log('async-final-success-' + surface + ':' + events.join('>'));
        if (!stream.destroyed) stream.destroy();
        await phase();
      }

      {
        const events = [];
        const stream = new Writable();
        stream.on('finish', () => {
          events.push('finish:' + stream.destroyed + ':' + stream.closed);
        });
        stream.on('close', () => {
          events.push('close:' + stream.destroyed + ':' + stream.closed);
        });
        stream.end((error) => {
          events.push('end:' + (error === null) + ':' + stream.destroyed + ':' + stream.closed);
        });
        await phase();
        events.push('after:' + stream.destroyed + ':' + stream.closed);
        console.log('natural-state-Writable:' + events.join('>'));
      }
    })();
  `,
};

export default c;
