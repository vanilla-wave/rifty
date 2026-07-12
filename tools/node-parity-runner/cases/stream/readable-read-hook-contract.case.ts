import type { ParityCase } from '../../src/types.ts';

/**
 * One `_read` authority, checked against real Node: option/subclass/late hook
 * precedence, push-owned demand latching, ignored returns, raw sync failure,
 * loud bare demand, filtered-chunk semantics, and the fromWeb-owned pull hook.
 * Async snapshots use an event-loop phase barrier, never a timer sleep.
 */
const c: ParityCase = {
  expected: [
    'subclass:value=subclass calls=3',
    'precedence:own=true identity=true calls=option',
    'late:calls=option,late',
    'ignored:calls=1 then=0 reading=true/true',
    'push-data:calls=2 reading=false/true',
    'push-eof:reading=true/false ended=true',
    'rejection:caught=true emitted=false destroyed=false reading=true',
    'sync-throw:threw=false errored=true destroyed=true reading=true',
    'async-push:calls=1 seen=async ended=true',
    'bare-direct:ERR_METHOD_NOT_IMPLEMENTED:The _read() method is not implemented',
    'bare-read:ERR_METHOD_NOT_IMPLEMENTED destroyed=true reading=true',
    'from-web:gets=0 custom=0 own=true custom-hook=false seen=web',
    'core-read-object-undefined:seen=undefined,u8:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read-object-empty-string:seen=string:,u8:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read-object-empty-u8:seen=u8:,u8:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read-object-string:seen=string:x,u8:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read-object-u8:seen=u8:07,u8:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read-byte-undefined:seen=null,buffer:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read-byte-empty-string:seen=null,buffer:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read-byte-empty-u8:seen=null,buffer:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read-byte-string:seen=buffer:78,buffer:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read-byte-u8:seen=buffer:07,buffer:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read1-object-undefined:seen=undefined,u8:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read1-object-empty-string:seen=string:,u8:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read1-object-empty-u8:seen=u8:,u8:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read1-object-string:seen=string:x,u8:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read1-object-u8:seen=u8:07,u8:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read1-byte-undefined:seen=null,buffer:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read1-byte-empty-string:seen=null,buffer:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read1-byte-empty-u8:seen=null,buffer:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read1-byte-string:seen=buffer:78,buffer:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-read1-byte-u8:seen=buffer:07,buffer:09,null calls=3 ended=true reading=false buffer=0 error=null',
    'core-readable-object-undefined:seen=undefined,u8:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-readable-object-empty-string:seen=string:,u8:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-readable-object-empty-u8:seen=u8:,u8:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-readable-object-string:seen=string:x,u8:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-readable-object-u8:seen=u8:07,u8:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-readable-byte-undefined:seen=buffer:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-readable-byte-empty-string:seen=buffer:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-readable-byte-empty-u8:seen=buffer:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-readable-byte-string:seen=buffer:7809 calls=3 ended=true reading=false buffer=0 error=null',
    'core-readable-byte-u8:seen=buffer:0709 calls=3 ended=true reading=false buffer=0 error=null',
    'core-data-object-undefined:seen=undefined,u8:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-data-object-empty-string:seen=string:,u8:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-data-object-empty-u8:seen=u8:,u8:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-data-object-string:seen=string:x,u8:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-data-object-u8:seen=u8:07,u8:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-data-byte-undefined:seen=buffer:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-data-byte-empty-string:seen=buffer:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-data-byte-empty-u8:seen=buffer:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-data-byte-string:seen=buffer:78,buffer:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-data-byte-u8:seen=buffer:07,buffer:09 calls=3 ended=true reading=false buffer=0 error=null',
    'core-byte-admission:string=buffer:c3a9/same=false,u8=buffer:07/same=false,buffer=buffer:08/same=true',
    'byte-noop-order:undefined=1/true/false/0/null/false/false/1/false/null/true,empty-string=1/true/false/0/null/false/false/1/false/null/true,empty-u8=1/true/false/0/null/false/false/1/false/null/true',
    'terminal-push:object-undefined=false/ERR_STREAM_PUSH_AFTER_EOF,object-empty-string=false/ERR_STREAM_PUSH_AFTER_EOF,object-empty-bytes=false/ERR_STREAM_PUSH_AFTER_EOF,byte-data=false/ERR_STREAM_PUSH_AFTER_EOF',
    'readable-fromweb-paused-object:first=4 seen=undefined,string:,u8:,u8:09 ended=true error=null reading=false buffer=0',
    'readable-fromweb-paused-byte:first=1 seen=buffer:09 ended=true error=null reading=false buffer=0',
    'readable-fromweb-flow-object:seen=undefined,string:,u8:,u8:09 ended=true error=null reading=false buffer=0',
    'readable-fromweb-flow-byte:seen=buffer:09 ended=true error=null reading=false buffer=0',
    'readable-fromweb-demand-hwm1-null:cold=0/null/false/0/0 first=null pending=1/1/1/true buffered=1/false value=buffer:01 next=2/1/1/true',
    'readable-fromweb-demand-hwm1-paused:cold=0/false/true/0/0 first=null pending=1/1/1/true buffered=1/false value=buffer:01 next=2/1/1/true',
    'readable-fromweb-demand-hwm0-null:cold=0/null/false/0/0 first=null pending=1/1/1/true buffered=1/false value=buffer:01 next=2/1/1/true',
    'duplex-fromweb-demand-hwm1-null:cold=0/null/false/0/0 first=null pending=1/1/1/true buffered=1/false value=buffer:01 next=2/1/1/true',
    'duplex-fromweb-demand-hwm1-paused:cold=0/false/true/0/0 first=null pending=1/1/1/true buffered=1/false value=buffer:01 next=2/1/1/true',
    'duplex-fromweb-demand-hwm0-null:cold=0/null/false/0/0 first=null pending=1/1/1/true buffered=1/false value=buffer:01 next=2/1/1/true',
    'readable-fromweb-flow-hwm1:pending=1/1/1/true/false seen=buffer:05 pulls=1 max=1 ended=true',
    'duplex-fromweb-flow-hwm1:pending=1/1/1/true/false seen=buffer:05 pulls=1 max=1 ended=true',
    'readable-fromweb-config:order=highWaterMark,encoding,objectMode hook-gets=0 hwm=2 object=true',
    'readable-fromweb-hooks-own-enumerable:gets=read:0 calls=read:0',
    'readable-fromweb-hooks-own-nonenumerable:gets=read:0 calls=read:0',
    'readable-fromweb-hooks-inherited:gets=read:0 calls=read:0',
  ].join('\n'),
  code: `
    const { Buffer } = require('node:buffer');
    const { Duplex, Readable } = require('node:stream');

    (async () => {
      const subclassCalls = [];
      class SubclassSource extends Readable {
        _read(size) {
          subclassCalls.push(size);
          this.push('subclass');
          this.push(null);
        }
      }
      const subclass = new SubclassSource({ objectMode: true, highWaterMark: 3 });
      subclass.read(0);
      console.log('subclass:value=' + subclass.read() + ' calls=' + subclassCalls.join(','));

      const precedenceCalls = [];
      class PrecedenceSource extends Readable {
        _read() { precedenceCalls.push('prototype'); }
      }
      function optionRead() { precedenceCalls.push('option'); }
      const precedence = new PrecedenceSource({ read: optionRead });
      precedence.read(0);
      console.log(
        'precedence:own=' + Object.hasOwn(precedence, '_read') +
        ' identity=' + (precedence._read === optionRead) +
        ' calls=' + precedenceCalls.join(','),
      );

      const lateCalls = [];
      const late = new Readable({ objectMode: true, read() { lateCalls.push('option'); } });
      late.read(0);
      late.push('release');
      late._read = () => { lateCalls.push('late'); };
      late.read(0);
      console.log('late:calls=' + lateCalls.join(','));

      let ignoredCalls = 0;
      let thenReads = 0;
      const hostile = {
        get then() {
          thenReads++;
          throw new Error('observed return');
        },
      };
      const ignored = new Readable({ read() { ignoredCalls++; return hostile; } });
      ignored.read(0);
      const ignoredFirst = ignored._readableState.reading;
      ignored.read(0);
      console.log(
        'ignored:calls=' + ignoredCalls +
        ' then=' + thenReads +
        ' reading=' + ignoredFirst + '/' + ignored._readableState.reading,
      );

      let pushCalls = 0;
      const pushData = new Readable({
        objectMode: true,
        read() {
          pushCalls++;
          if (pushCalls === 1) this.push('first');
        },
      });
      pushData.read(0);
      const readingAfterData = pushData._readableState.reading;
      pushData.read(0);
      console.log(
        'push-data:calls=' + pushCalls +
        ' reading=' + readingAfterData + '/' + pushData._readableState.reading,
      );

      const pushEof = new Readable({ read() {} });
      pushEof.read(0);
      const readingBeforeEof = pushEof._readableState.reading;
      pushEof.push(null);
      console.log(
        'push-eof:reading=' + readingBeforeEof + '/' + pushEof._readableState.reading +
        ' ended=' + pushEof._readableState.ended,
      );

      const rejection = { source: 'returned-promise' };
      let rejectedCaught = null;
      let rejectedEmitted = null;
      let releaseRejection;
      const rejectionCaught = new Promise((resolve) => { releaseRejection = resolve; });
      const rejected = new Readable({
        read() {
          const returned = Promise.reject(rejection);
          returned.catch((error) => {
            rejectedCaught = error;
            releaseRejection();
          });
          return returned;
        },
      });
      rejected.on('error', (error) => { rejectedEmitted = error; });
      rejected.read(0);
      await rejectionCaught;
      await Promise.resolve();
      console.log(
        'rejection:caught=' + (rejectedCaught === rejection) +
        ' emitted=' + (rejectedEmitted === rejection) +
        ' destroyed=' + rejected.destroyed +
        ' reading=' + rejected._readableState.reading,
      );

      const raw = { source: 'sync-throw' };
      let syncThrew = null;
      const syncThrow = new Readable({ read() { throw raw; } });
      syncThrow.on('error', () => {});
      try { syncThrow.read(0); } catch (error) { syncThrew = error; }
      console.log(
        'sync-throw:threw=' + (syncThrew === raw) +
        ' errored=' + (syncThrow._readableState.errored === raw) +
        ' destroyed=' + syncThrow.destroyed +
        ' reading=' + syncThrow._readableState.reading,
      );

      let asyncCalls = 0;
      const asyncSeen = [];
      const asyncPush = new Readable({
        objectMode: true,
        async read() {
          asyncCalls++;
          await Promise.resolve();
          this.push('async');
          this.push(null);
        },
      });
      const asyncEnded = new Promise((resolve, reject) => {
        asyncPush.on('data', (chunk) => asyncSeen.push(chunk));
        asyncPush.on('end', resolve);
        asyncPush.on('error', reject);
      });
      await asyncEnded;
      console.log(
        'async-push:calls=' + asyncCalls +
        ' seen=' + asyncSeen.join(',') +
        ' ended=' + asyncPush.readableEnded,
      );

      const bareDirect = new Readable();
      let directError = null;
      try { bareDirect._read(1); } catch (error) { directError = error; }
      console.log(
        'bare-direct:' + (directError && directError.code) + ':' +
        (directError && directError.message),
      );

      const bareRead = new Readable();
      let bareReadError = null;
      bareRead.on('error', (error) => { bareReadError = error; });
      bareRead.read(0);
      const bareStateError = bareRead._readableState.errored;
      console.log(
        'bare-read:' + (bareStateError && bareStateError.code) +
        ' destroyed=' + bareRead.destroyed +
        ' reading=' + bareRead._readableState.reading,
      );

      let controller;
      const web = new ReadableStream({ start(next) { controller = next; } });
      let customReadGets = 0;
      let customReads = 0;
      const customRead = () => { customReads++; };
      const fromWebOptions = { objectMode: true };
      Object.defineProperty(fromWebOptions, 'read', {
        enumerable: true,
        get() {
          customReadGets++;
          return customRead;
        },
      });
      const fromWeb = Readable.fromWeb(web, fromWebOptions);
      const webSeen = [];
      const webEnded = new Promise((resolve, reject) => {
        fromWeb.on('data', (chunk) => webSeen.push(chunk));
        fromWeb.on('end', resolve);
        fromWeb.on('error', reject);
      });
      await Promise.resolve();
      const fromWebOwn = Object.hasOwn(fromWeb, '_read');
      const fromWebCustomHook = fromWeb._read === customRead;
      controller.enqueue('web');
      controller.close();
      await webEnded;
      console.log(
        'from-web:gets=' + customReadGets +
        ' custom=' + customReads +
        ' own=' + fromWebOwn +
        ' custom-hook=' + fromWebCustomHook +
        ' seen=' + webSeen.join(','),
      );

      const immediate = () => new Promise((resolve) => setImmediate(resolve));
      const tag = (value) => {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'string') return 'string:' + value;
        if (Buffer.isBuffer(value)) return 'buffer:' + value.toString('hex');
        return 'u8:' + Buffer.from(value).toString('hex');
      };
      const candidates = [
        ['undefined', undefined],
        ['empty-string', ''],
        ['empty-u8', new Uint8Array(0)],
        ['string', 'x'],
        ['u8', new Uint8Array([7])],
      ];

      function coreSource(objectMode, first) {
        let calls = 0;
        const source = new Readable({
          objectMode,
          read() {
            calls++;
            if (calls === 1) this.push(first);
            else if (calls === 2) this.push(new Uint8Array([9]));
            else if (calls === 3) this.push(null);
            else throw new Error('unexpected fourth source read');
          },
        });
        return { source, calls: () => calls };
      }

      async function coreRow(consumer, objectMode, name, first) {
        const mode = objectMode ? 'object' : 'byte';
        const { source, calls } = coreSource(objectMode, first);
        const seen = [];
        let error = null;
        source.on('error', (cause) => { error = cause.code || cause.message; });

        if (consumer === 'read' || consumer === 'read1') {
          for (let i = 0; i < 3; i++) {
            seen.push(tag(consumer === 'read' ? source.read() : source.read(1)));
          }
          await immediate();
        } else {
          if (consumer === 'data') {
            source.on('data', (chunk) => { seen.push(tag(chunk)); });
          } else {
            source.on('readable', () => {
              for (let attempt = 0; attempt < 8; attempt++) {
                const chunk = source.read();
                if (chunk === null) return;
                seen.push(tag(chunk));
              }
              error = 'consumer-overflow';
              source.destroy();
            });
          }
          for (let phase = 0; phase < 8; phase++) {
            if (source._readableState.ended || source.destroyed) break;
            await immediate();
          }
        }

        console.log(
          'core-' + consumer + '-' + mode + '-' + name + ':seen=' + seen.join(',') +
          ' calls=' + calls() +
          ' ended=' + source._readableState.ended +
          ' reading=' + source._readableState.reading +
          ' buffer=' + source._readableState.length +
          ' error=' + error,
        );
      }

      for (const consumer of ['read', 'read1', 'readable', 'data']) {
        for (const objectMode of [true, false]) {
          for (const [name, first] of candidates) {
            await coreRow(consumer, objectMode, name, first);
          }
        }
      }

      const admission = [];
      for (const [name, chunk, size] of [
        ['string', 'é', 2],
        ['u8', new Uint8Array([7]), 1],
        ['buffer', Buffer.from([8]), 1],
      ]) {
        const source = new Readable({ read() {} });
        source.push(chunk);
        source.push(null);
        const value = source.read(size);
        admission.push(name + '=' + tag(value) + '/same=' + (value === chunk));
      }
      console.log('core-byte-admission:' + admission.join(','));

      const byteNoops = [
        ['undefined', undefined],
        ['empty-string', ''],
        ['empty-u8', new Uint8Array(0)],
      ];
      const byteNoopOrder = [];
      for (const [name, chunk] of byteNoops) {
        const overflow = new Error('unexpected byte-noop refill');
        let emptyCalls = 0;
        let emptyError = null;
        const empty = new Readable({
          highWaterMark: 0,
          read() {
            emptyCalls++;
            if (emptyCalls > 1) throw overflow;
          },
        });
        empty.on('error', (error) => { emptyError = error === overflow ? 'overflow' : 'error'; });
        empty.read(0);
        const emptyReturn = empty.push(chunk);
        const emptyReading = empty._readableState.reading;

        const full = new Readable({ highWaterMark: 1, read() {} });
        full.push(new Uint8Array([1]));
        full._readableState.reading = true;
        const fullReturn = full.push(chunk);

        const ended = new Readable({ read() {} });
        let endedError = null;
        ended.on('error', (error) => { endedError = error.code || error.message; });
        ended.push(null);
        const endedReturn = ended.push(chunk);

        const destroyed = new Readable({ highWaterMark: 0, read() {} });
        destroyed.destroy();
        await immediate();
        const destroyedReturn = destroyed.push(chunk);
        await immediate();

        byteNoopOrder.push(
          name + '=' +
          emptyCalls + '/' + emptyReturn + '/' + emptyReading + '/' + empty._readableState.length + '/' +
          emptyError + '/' +
          fullReturn + '/' + full._readableState.reading + '/' + full._readableState.length + '/' +
          endedReturn + '/' + endedError + '/' + destroyedReturn,
        );
        if (!empty.destroyed) empty.destroy();
        if (!full.destroyed) full.destroy();
        if (!ended.destroyed) ended.destroy();
      }
      console.log('byte-noop-order:' + byteNoopOrder.join(','));

      const terminalPushRows = [
        ['object-undefined', true, undefined],
        ['object-empty-string', true, ''],
        ['object-empty-bytes', true, new Uint8Array(0)],
        ['byte-data', false, new Uint8Array([9])],
      ];
      const terminalPush = [];
      for (const [name, objectMode, chunk] of terminalPushRows) {
        const source = new Readable({ objectMode, read() {} });
        let error = null;
        source.on('error', (cause) => { error = cause.code || cause.message; });
        source.push(null);
        const returned = source.push(chunk);
        await immediate();
        terminalPush.push(name + '=' + returned + '/' + error);
      }
      console.log('terminal-push:' + terminalPush.join(','));

      function filteredWeb() {
        return new ReadableStream({
          start(next) {
            next.enqueue(undefined);
            next.enqueue('');
            next.enqueue(new Uint8Array(0));
            next.enqueue(new Uint8Array([9]));
            next.close();
          },
        });
      }

      async function fromWebRow(consumption, objectMode) {
        const mode = objectMode ? 'object' : 'byte';
        const source = Readable.fromWeb(filteredWeb(), { objectMode });
        const seen = [];
        let ended = false;
        let error = null;
        source.on('end', () => { ended = true; });
        source.on('error', (cause) => { error = cause.code || cause.message; });

        if (consumption === 'flow') {
          source.on('data', (chunk) => { seen.push(tag(chunk)); });
          await immediate();
          console.log(
            'readable-fromweb-flow-' + mode + ':seen=' + seen.join(',') +
            ' ended=' + ended +
            ' error=' + error +
            ' reading=' + source._readableState.reading +
            ' buffer=' + source._readableState.length,
          );
        } else {
          source.read(1);
          await immediate();
          const firstLength = source._readableState.length;
          for (let phase = 0; phase < 8; phase++) {
            if (source._readableState.length > 0) seen.push(tag(source.read(1)));
            else source.read(1);
            await immediate();
          }
          console.log(
            'readable-fromweb-paused-' + mode + ':first=' + firstLength +
            ' seen=' + seen.join(',') +
            ' ended=' + ended +
            ' error=' + error +
            ' reading=' + source._readableState.reading +
            ' buffer=' + source._readableState.length,
          );
        }
        if (!ended) source.destroy();
      }

      await fromWebRow('paused', true);
      await fromWebRow('paused', false);
      await fromWebRow('flow', true);
      await fromWebRow('flow', false);

      async function demandRow(adapter, highWaterMark, paused) {
        let pulls = 0;
        let active = 0;
        let maxActive = 0;
        let release;
        const web = new ReadableStream({
          pull(next) {
            pulls++;
            active++;
            maxActive = Math.max(maxActive, active);
            const value = pulls;
            return new Promise((resolve) => {
              release = () => {
                next.enqueue(new Uint8Array([value]));
                active--;
                resolve();
              };
            });
          },
        }, { highWaterMark: 0 });
        const source = adapter === 'readable'
          ? Readable.fromWeb(web, { highWaterMark })
          : Duplex.fromWeb(
              { readable: web, writable: new WritableStream() },
              { highWaterMark },
            );
        if (paused) source.pause();
        await immediate();
        const cold =
          pulls + '/' + source._readableState.flowing + '/' +
          (source._readableState.flowing === false) + '/' +
          source.listenerCount('data') + '/' + source.listenerCount('readable');
        const first = tag(source.read(1));
        source.read(1);
        source.read(1);
        await immediate();
        const pending = pulls + '/' + active + '/' + maxActive + '/' + source._readableState.reading;
        release();
        await immediate();
        const buffered = source._readableState.length + '/' + source._readableState.reading;
        const value = tag(source.read(1));
        await immediate();
        console.log(
          adapter + '-fromweb-demand-hwm' + highWaterMark + '-' + (paused ? 'paused' : 'null') +
          ':cold=' + cold +
          ' first=' + first +
          ' pending=' + pending +
          ' buffered=' + buffered +
          ' value=' + value +
          ' next=' + pulls + '/' + active + '/' + maxActive + '/' + source._readableState.reading,
        );
        source.destroy();
      }

      for (const adapter of ['readable', 'duplex']) {
        await demandRow(adapter, 1, false);
        await demandRow(adapter, 1, true);
        await demandRow(adapter, 0, false);
      }

      for (const adapter of ['readable', 'duplex']) {
        let pulls = 0;
        let active = 0;
        let maxActive = 0;
        let release;
        const web = new ReadableStream({
          pull(next) {
            pulls++;
            active++;
            maxActive = Math.max(maxActive, active);
            return new Promise((resolve) => {
              release = () => {
                next.enqueue(new Uint8Array([5]));
                next.close();
                active--;
                resolve();
              };
            });
          },
        }, { highWaterMark: 0 });
        const source = adapter === 'readable'
          ? Readable.fromWeb(web, { highWaterMark: 1 })
          : Duplex.fromWeb(
              { readable: web, writable: new WritableStream() },
              { highWaterMark: 1 },
            );
        const seen = [];
        source.on('data', (chunk) => { seen.push(tag(chunk)); });
        await immediate();
        const pending = pulls + '/' + active + '/' + maxActive + '/' +
          source._readableState.flowing + '/' + (source._readableState.flowing === false);
        release();
        await new Promise((resolve, reject) => {
          source.on('end', resolve);
          source.on('error', reject);
        });
        console.log(
          adapter + '-fromweb-flow-hwm1:pending=' + pending +
          ' seen=' + seen.join(',') +
          ' pulls=' + pulls +
          ' max=' + maxActive +
          ' ended=' + source.readableEnded,
        );
      }

      {
        const order = [];
        let hookGets = 0;
        const options = {};
        for (const [name, value] of [
          ['encoding', 'utf8'],
          ['highWaterMark', 2],
          ['objectMode', true],
        ]) {
          Object.defineProperty(options, name, {
            enumerable: true,
            get() { order.push(name); return value; },
          });
        }
        Object.defineProperty(options, 'read', {
          enumerable: true,
          get() { hookGets++; return () => {}; },
        });
        const source = Readable.fromWeb(
          new ReadableStream({ start(next) { next.close(); } }),
          options,
        );
        console.log(
          'readable-fromweb-config:order=' + order.join(',') +
          ' hook-gets=' + hookGets +
          ' hwm=' + source.readableHighWaterMark +
          ' object=' + source.readableObjectMode,
        );
        source.destroy();
      }

      function hookOptions(placement, names, gets, calls) {
        const target = placement === 'inherited' ? {} : Object.create(null);
        for (const name of names) {
          Object.defineProperty(target, name, {
            configurable: true,
            enumerable: placement !== 'own-nonenumerable',
            get() {
              gets[name]++;
              return (...args) => {
                calls[name]++;
                const callback = args[args.length - 1];
                if (typeof callback === 'function') callback();
              };
            },
          });
        }
        return placement === 'inherited' ? Object.create(target) : target;
      }

      for (const placement of ['own-enumerable', 'own-nonenumerable', 'inherited']) {
        const gets = { read: 0 };
        const calls = { read: 0 };
        const options = hookOptions(placement, ['read'], gets, calls);
        const source = Readable.fromWeb(
          new ReadableStream({ start(next) { next.enqueue(new Uint8Array([1])); next.close(); } }),
          options,
        );
        source.resume();
        await immediate();
        console.log(
          'readable-fromweb-hooks-' + placement +
          ':gets=read:' + gets.read +
          ' calls=read:' + calls.read,
        );
        if (!source.destroyed) source.destroy();
      }
    })();
  `,
};

export default c;
