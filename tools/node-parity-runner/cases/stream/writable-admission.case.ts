import type { ParityCase } from '../../src/types.ts';

/** Writable/duplex/transform admission keeps Node's chunk+encoding pair. */
const c: ParityCase = {
  expected: [
    'Writable-byte:buffer:e9/buffer',
    'Writable-false:string:é/latin1',
    'Writable-object:string:é/latin1',
    'Writable-invalid-undefined:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Writable-invalid-false:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Writable-object-invalid:string:x/wat',
    'Writable-upper:buffer:c3a9/buffer',
    'Writable-upper-false:string:é/UTF8',
    'Writable-upper-object:string:é/UTF8',
    'Writable-view:true/true/true/2/2/0102/buffer/9/8',
    'Writable-view-false:true/true/true/2/2/0102/buffer',
    'Writable-byte-buffer:true/true/buffer',
    'Writable-byte-buffer-false:true/true/buffer',
    'Writable-object-buffer:true/true/latin1',
    'Writable-object-u8:false/true/latin1',
    'Writable-invalid-buffer-undefined:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Writable-invalid-u8-undefined:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Writable-invalid-buffer-false:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Writable-invalid-u8-false:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Writable-decode-zero:state=true/return=true/buffer:c3a9/buffer',
    'Writable-decode-null:state=true/return=true/buffer:c3a9/buffer',
    'Duplex-byte:buffer:e9/buffer',
    'Duplex-false:string:é/latin1',
    'Duplex-object:string:é/latin1',
    'Duplex-invalid-undefined:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Duplex-invalid-false:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Duplex-object-invalid:string:x/wat',
    'Duplex-upper:buffer:c3a9/buffer',
    'Duplex-upper-false:string:é/UTF8',
    'Duplex-upper-object:string:é/UTF8',
    'Duplex-view:true/true/true/2/2/0102/buffer/9/8',
    'Duplex-view-false:true/true/true/2/2/0102/buffer',
    'Duplex-byte-buffer:true/true/buffer',
    'Duplex-byte-buffer-false:true/true/buffer',
    'Duplex-object-buffer:true/true/latin1',
    'Duplex-object-u8:false/true/latin1',
    'Duplex-invalid-buffer-undefined:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Duplex-invalid-u8-undefined:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Duplex-invalid-buffer-false:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Duplex-invalid-u8-false:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Duplex-decode-zero:state=true/return=true/buffer:c3a9/buffer',
    'Duplex-decode-null:state=true/return=true/buffer:c3a9/buffer',
    'Transform-byte:buffer:e9/buffer',
    'Transform-false:string:é/latin1',
    'Transform-object:string:é/latin1',
    'Transform-invalid-undefined:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Transform-invalid-false:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Transform-object-invalid:string:x/wat',
    'Transform-upper:buffer:c3a9/buffer',
    'Transform-upper-false:string:é/UTF8',
    'Transform-upper-object:string:é/UTF8',
    'Transform-view:true/true/true/2/2/0102/buffer/9/8',
    'Transform-view-false:true/true/true/2/2/0102/buffer',
    'Transform-byte-buffer:true/true/buffer',
    'Transform-byte-buffer-false:true/true/buffer',
    'Transform-object-buffer:true/true/latin1',
    'Transform-object-u8:false/true/latin1',
    'Transform-invalid-buffer-undefined:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Transform-invalid-u8-undefined:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Transform-invalid-buffer-false:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Transform-invalid-u8-false:TypeError:ERR_UNKNOWN_ENCODING/0/0',
    'Transform-decode-zero:state=true/return=true/buffer:c3a9/buffer',
    'Transform-decode-null:state=true/return=true/buffer:c3a9/buffer',
    'Writable-writev:buffer:e9/buffer,buffer:78/buffer',
    'Duplex-writev:buffer:e9/buffer,buffer:78/buffer',
    'Writable-fromweb:TypeError:ERR_UNKNOWN_ENCODING/buffer:c3a9',
    'Duplex-fromweb:TypeError:ERR_UNKNOWN_ENCODING/buffer:c3a9',
  ].join('\n'),
  code: `
    const { Buffer } = require('node:buffer');
    const { Writable, Duplex, Transform } = require('node:stream');
    (async () => {
      const immediate = () => new Promise((resolve) => setImmediate(resolve));
      const tag = (chunk) => Buffer.isBuffer(chunk)
        ? 'buffer:' + chunk.toString('hex')
        : chunk instanceof Uint8Array
          ? 'u8:' + Buffer.from(chunk).toString('hex')
          : typeof chunk + ':' + chunk;
      function target(surface, options, seen, raw) {
        const observe = (chunk, encoding, callback) => {
          seen.push(tag(chunk) + '/' + encoding);
          if (raw) {
            raw.chunk = chunk;
            raw.encoding = encoding;
          }
          callback();
        };
        if (surface === 'Writable') return new Writable({ ...options, write: observe });
        if (surface === 'Duplex') return new Duplex({ ...options, read() {}, write: observe });
        return new Transform({ ...options, transform: observe });
      }

      for (const surface of ['Writable', 'Duplex', 'Transform']) {
        for (const [name, options] of [
          ['byte', { objectMode: false }],
          ['false', { objectMode: false, decodeStrings: false }],
          ['object', { objectMode: true }],
        ]) {
          const seen = [];
          const stream = target(surface, options, seen);
          stream.write('é', 'latin1');
          await immediate();
          console.log(surface + '-' + name + ':' + seen.join(','));
          stream.destroy();
        }

        for (const decodeStrings of [undefined, false]) {
          const seen = [];
          const options = { objectMode: false };
          if (decodeStrings === false) options.decodeStrings = false;
          const stream = target(surface, options, seen);
          let error = 'none';
          try { stream.write('x', 'wat'); }
          catch (e) { error = e.constructor.name + ':' + e.code; }
          await immediate();
          console.log(surface + '-invalid-' + String(decodeStrings) + ':' + error + '/' + seen.length + '/' + stream.writableLength);
          stream.destroy();
        }

        const objectInvalidSeen = [];
        const objectInvalid = target(surface, { objectMode: true }, objectInvalidSeen);
        objectInvalid.write('x', 'wat');
        await immediate();
        console.log(surface + '-object-invalid:' + objectInvalidSeen.join(','));
        objectInvalid.destroy();

        const upperSeen = [];
        const upper = target(surface, { objectMode: false }, upperSeen);
        upper.write('é', 'UTF8');
        await immediate();
        console.log(surface + '-upper:' + upperSeen.join(','));
        upper.destroy();

        for (const [label, options] of [
          ['upper-false', { objectMode: false, decodeStrings: false }],
          ['upper-object', { objectMode: true }],
        ]) {
          const seen = [];
          const stream = target(surface, options, seen);
          stream.write('é', 'UTF8');
          await immediate();
          console.log(surface + '-' + label + ':' + seen.join(','));
          stream.destroy();
        }

        const backing = new ArrayBuffer(6);
        const input = new Uint8Array(backing, 2, 2);
        input.set([1, 2]);
        const raw = {};
        const view = target(surface, { objectMode: false }, [], raw);
        view.write(input, 'latin1');
        await immediate();
        const exactBytes = raw.chunk && Buffer.from(raw.chunk).toString('hex');
        input[0] = 9;
        const forward = raw.chunk && raw.chunk[0];
        if (raw.chunk) raw.chunk[1] = 8;
        console.log(
          surface + '-view:' +
          Buffer.isBuffer(raw.chunk) + '/' +
          (raw.chunk !== input) + '/' +
          (raw.chunk && raw.chunk.buffer === input.buffer) + '/' +
          (raw.chunk && raw.chunk.byteOffset) + '/' +
          (raw.chunk && raw.chunk.byteLength) + '/' +
          exactBytes + '/' +
          raw.encoding + '/' + forward + '/' + input[1]
        );
        view.destroy();

        const falseBacking = new ArrayBuffer(6);
        const falseInput = new Uint8Array(falseBacking, 2, 2);
        falseInput.set([1, 2]);
        const falseRaw = {};
        const falseView = target(
          surface,
          { objectMode: false, decodeStrings: false },
          [],
          falseRaw,
        );
        falseView.write(falseInput, 'latin1');
        await immediate();
        console.log(
          surface + '-view-false:' +
          Buffer.isBuffer(falseRaw.chunk) + '/' +
          (falseRaw.chunk !== falseInput) + '/' +
          (falseRaw.chunk && falseRaw.chunk.buffer === falseInput.buffer) + '/' +
          (falseRaw.chunk && falseRaw.chunk.byteOffset) + '/' +
          (falseRaw.chunk && falseRaw.chunk.byteLength) + '/' +
          (falseRaw.chunk && Buffer.from(falseRaw.chunk).toString('hex')) + '/' +
          falseRaw.encoding
        );
        falseView.destroy();

        for (const [name, objectMode, kind, decodeStrings] of [
          ['byte-buffer', false, 'buffer', undefined],
          ['byte-buffer-false', false, 'buffer', false],
          ['object-buffer', true, 'buffer', undefined],
          ['object-u8', true, 'u8', undefined],
        ]) {
          const input = kind === 'buffer' ? Buffer.from([1, 2]) : new Uint8Array([1, 2]);
          const raw = {};
          const options = { objectMode };
          if (decodeStrings !== undefined) options.decodeStrings = decodeStrings;
          const identity = target(surface, options, [], raw);
          identity.write(input, 'latin1');
          await immediate();
          console.log(
            surface + '-' + name + ':' +
            Buffer.isBuffer(raw.chunk) + '/' +
            (raw.chunk === input) + '/' +
            raw.encoding
          );
          identity.destroy();
        }

        for (const decodeStrings of [undefined, false]) {
          for (const kind of ['buffer', 'u8']) {
            const input = kind === 'buffer' ? Buffer.from([1]) : new Uint8Array([1]);
            const seen = [];
            const options = { objectMode: false };
            if (decodeStrings !== undefined) options.decodeStrings = decodeStrings;
            const stream = target(surface, options, seen);
            let error = 'none';
            try { stream.write(input, 'wat'); }
            catch (e) { error = e.constructor.name + ':' + e.code; }
            await immediate();
            console.log(
              surface + '-invalid-' + kind + '-' + String(decodeStrings) + ':' +
              error + '/' + seen.length + '/' + stream.writableLength
            );
            stream.destroy();
          }
        }

        for (const [label, decodeStrings] of [['zero', 0], ['null', null]]) {
          const seen = [];
          const stream = target(
            surface,
            { objectMode: false, highWaterMark: 2, decodeStrings },
            seen,
          );
          const returned = stream.write('é', 'utf8');
          await immediate();
          console.log(
            surface + '-decode-' + label + ':' +
            'state=' + stream._writableState.decodeStrings + '/' +
            'return=' + returned + '/' + seen.join(',')
          );
          stream.destroy();
        }
      }

      for (const surface of ['Writable', 'Duplex']) {
        let batch = [];
        let releaseFirst;
        const options = {
          objectMode: false,
          write(chunk, encoding, callback) { releaseFirst = callback; },
          writev(chunks, callback) { batch = chunks; callback(); },
        };
        const stream = surface === 'Writable'
          ? new Writable(options)
          : new Duplex({ ...options, read() {} });
        stream.write('hold', 'utf8');
        await immediate();
        stream.write('é', 'latin1');
        stream.write('x', 'UTF8');
        releaseFirst();
        await immediate();
        console.log(surface + '-writev:' + batch.map(({ chunk, encoding }) => tag(chunk) + '/' + encoding).join(','));
        stream.destroy();
      }

      for (const surface of ['Writable', 'Duplex']) {
        const seen = [];
        const web = new WritableStream({ write(chunk) { seen.push(tag(chunk)); } });
        const stream = surface === 'Writable'
          ? Writable.fromWeb(web)
          : Duplex.fromWeb({ readable: new ReadableStream(), writable: web });
        let invalid = 'none';
        try { stream.write('x', 'wat'); }
        catch (e) { invalid = e.constructor.name + ':' + e.code; }
        stream.write('é', 'UTF8');
        await immediate();
        console.log(surface + '-fromweb:' + invalid + '/' + seen.join(','));
        stream.destroy();
      }
    })();
  `,
};

export default c;
