import type { ParityCase } from '../../src/types.ts';

/** Shared `fromWeb` option read/validation pipeline; terminal lifecycle stays out of scope. */
const c: ParityCase = {
  expected: [
    'source-Readable:TypeError/ERR_INVALID_ARG_TYPE/source getters=',
    'source-Writable:TypeError/ERR_INVALID_ARG_TYPE/source getters=',
    'source-Duplex:TypeError/ERR_INVALID_ARG_TYPE/source getters=',
    'options-Readable:TypeError/ERR_INVALID_ARG_TYPE/options',
    'options-Writable:TypeError/ERR_INVALID_ARG_TYPE/options',
    'options-Duplex:TypeError/ERR_INVALID_ARG_TYPE/options',
    'order-Readable:highWaterMark,encoding,objectMode,signal',
    'order-Writable:highWaterMark,decodeStrings,objectMode,signal',
    'order-Duplex:allowHalfOpen,objectMode,encoding,decodeStrings,highWaterMark,signal',
    'raw-Readable:same=true order=highWaterMark,encoding,objectMode',
    'raw-Writable:same=true order=highWaterMark,decodeStrings,objectMode',
    'raw-Duplex:same=true order=allowHalfOpen,objectMode',
    'priority-Readable-encoding:TypeError/ERR_INVALID_ARG_VALUE/encoding',
    'priority-Readable-objectMode:TypeError/ERR_INVALID_ARG_TYPE/objectMode',
    'priority-Readable-hwm:TypeError/ERR_INVALID_ARG_VALUE/highWaterMark',
    'priority-Writable-objectMode:TypeError/ERR_INVALID_ARG_TYPE/objectMode',
    'priority-Writable-decodeStrings:TypeError/ERR_INVALID_ARG_TYPE/decodeStrings',
    'priority-Writable-hwm:TypeError/ERR_INVALID_ARG_VALUE/highWaterMark',
    'priority-Duplex-objectMode:TypeError/ERR_INVALID_ARG_TYPE/objectMode',
    'priority-Duplex-encoding:TypeError/ERR_INVALID_ARG_VALUE/encoding',
    'priority-Duplex-hwm:TypeError/ERR_INVALID_ARG_VALUE/readableHighWaterMark',
    'hwm-invalid-Readable:ERR_INVALID_ARG_VALUE,ERR_INVALID_ARG_VALUE,ERR_INVALID_ARG_VALUE,ERR_INVALID_ARG_VALUE,ERR_INVALID_ARG_VALUE',
    'hwm-invalid-Writable:ERR_INVALID_ARG_VALUE,ERR_INVALID_ARG_VALUE,ERR_INVALID_ARG_VALUE,ERR_INVALID_ARG_VALUE,ERR_INVALID_ARG_VALUE',
    'hwm-invalid-Duplex:ERR_INVALID_ARG_VALUE,ERR_INVALID_ARG_VALUE,ERR_INVALID_ARG_VALUE,ERR_INVALID_ARG_VALUE,ERR_INVALID_ARG_VALUE',
    'hwm-normal-Readable:same-default=true zero=0',
    'hwm-normal-Writable:same-default=true zero=0',
    'hwm-normal-Duplex:same-default=true zero=0/0',
    'signal-invalid-Readable:TypeError/ERR_INVALID_ARG_TYPE/signal',
    'signal-invalid-Writable:TypeError/ERR_INVALID_ARG_TYPE/signal',
    'signal-invalid-Duplex:TypeError/ERR_INVALID_ARG_TYPE/signal',
    'signal-absent-Readable:null=ok undefined=ok zero=ok empty=ok false=ok',
    'signal-absent-Writable:null=ok undefined=ok zero=ok empty=ok false=ok',
    'signal-absent-Duplex:null=ok undefined=ok zero=ok empty=ok false=ok',
    'stage-success-Readable:highWaterMark,encoding,objectMode,signal,R',
    'stage-success-Writable:highWaterMark,decodeStrings,objectMode,signal,W',
    'stage-success-Duplex:allowHalfOpen,objectMode,encoding,decodeStrings,highWaterMark,signal,W,R',
    'stage-options-Readable:TypeError/ERR_INVALID_ARG_TYPE/options acq= locks=false',
    'stage-options-Writable:TypeError/ERR_INVALID_ARG_TYPE/options acq= locks=false',
    'stage-options-Duplex:TypeError/ERR_INVALID_ARG_TYPE/options acq= locks=false,false',
    'stage-early-Readable:TypeError/ERR_INVALID_ARG_VALUE/encoding acq= locks=false',
    'stage-early-Writable:TypeError/ERR_INVALID_ARG_TYPE/decodeStrings acq= locks=false',
    'stage-early-Duplex:TypeError/ERR_INVALID_ARG_TYPE/objectMode acq= locks=false,false',
    'stage-hwm-Readable:TypeError/ERR_INVALID_ARG_VALUE/highWaterMark acq=R locks=true',
    'stage-hwm-Writable:TypeError/ERR_INVALID_ARG_VALUE/highWaterMark acq=W locks=true',
    'stage-hwm-Duplex:TypeError/ERR_INVALID_ARG_VALUE/readableHighWaterMark acq=WR locks=true,true',
    'stage-signal-invalid-Readable:TypeError/ERR_INVALID_ARG_TYPE/signal acq=R locks=true',
    'stage-signal-raw-Readable:TypeError/none/signal acq=R locks=true',
    'stage-signal-invalid-Writable:TypeError/ERR_INVALID_ARG_TYPE/signal acq=W locks=true',
    'stage-signal-raw-Writable:TypeError/none/signal acq=W locks=true',
    'stage-signal-invalid-Duplex:TypeError/ERR_INVALID_ARG_TYPE/signal acq=WR locks=true,true',
    'stage-signal-raw-Duplex:TypeError/none/signal acq=WR locks=true,true',
    'brand-fake-Readable:TypeError/ERR_INVALID_ARG_TYPE/source source= options=',
    'brand-fake-Writable:TypeError/ERR_INVALID_ARG_TYPE/source source= options=',
    'brand-fake-Duplex:TypeError/ERR_INVALID_ARG_TYPE/source source= options=',
    'duplex-pair-order:pair:R,pair:W,allowHalfOpen,objectMode,encoding,decodeStrings,highWaterMark,signal,W,R',
    'duplex-pair-raw:same=true pair=R,W options=',
    'snapshot-Readable:same=true order=highWaterMark,encoding,objectMode acq=',
    'snapshot-Writable:same=true order=highWaterMark,decodeStrings,objectMode acq=',
    'snapshot-Duplex:same=true order=allowHalfOpen,objectMode,encoding,decodeStrings,highWaterMark,signal acq=',
    'duplex-decodeStrings-nonboolean:ok',
  ].join('\n'),
  code: `
    const { Readable, Writable, Duplex } = require('node:stream');

    const specs = [
      {
        adapter: 'Readable',
        keys: ['highWaterMark', 'encoding', 'objectMode', 'signal'],
        hwmKey: 'highWaterMark',
      },
      {
        adapter: 'Writable',
        keys: ['highWaterMark', 'decodeStrings', 'objectMode', 'signal'],
        hwmKey: 'highWaterMark',
      },
      {
        adapter: 'Duplex',
        keys: ['allowHalfOpen', 'objectMode', 'encoding', 'decodeStrings', 'highWaterMark', 'signal'],
        hwmKey: 'readableHighWaterMark',
      },
    ];

    function source(adapter) {
      if (adapter === 'Readable') return new ReadableStream();
      if (adapter === 'Writable') return new WritableStream();
      return { readable: new ReadableStream(), writable: new WritableStream() };
    }

    function acquisitionFixture(adapter, events) {
      const readable = new ReadableStream();
      const writable = new WritableStream();
      const getReader = readable.getReader.bind(readable);
      const getWriter = writable.getWriter.bind(writable);
      if (adapter !== 'Writable') {
        Object.defineProperty(readable, 'getReader', {
          value() { events.push('R'); return getReader(); },
        });
      }
      if (adapter !== 'Readable') {
        Object.defineProperty(writable, 'getWriter', {
          value() { events.push('W'); return getWriter(); },
        });
      }
      return {
        input: adapter === 'Readable'
          ? readable
          : adapter === 'Writable'
            ? writable
            : { readable, writable },
        locks() {
          if (adapter === 'Readable') return String(readable.locked);
          if (adapter === 'Writable') return String(writable.locked);
          return readable.locked + ',' + writable.locked;
        },
      };
    }

    function invoke(adapter, options, input) {
      const value = arguments.length >= 3 ? input : source(adapter);
      if (adapter === 'Readable') return Readable.fromWeb(value, options);
      if (adapter === 'Writable') return Writable.fromWeb(value, options);
      return Duplex.fromWeb(value, options);
    }

    function dispose(stream) {
      if (!stream) return;
      stream.on('error', () => {});
      stream.destroy();
    }

    function capture(run) {
      try {
        const stream = run();
        dispose(stream);
        return { error: null, stream };
      } catch (error) {
        return { error, stream: null };
      }
    }

    function errorKey(error) {
      const message = String(error && error.message);
      for (const key of [
        'readableHighWaterMark',
        'decodeStrings',
        'objectMode',
        'highWaterMark',
        'encoding',
        'signal',
        'options',
      ]) {
        if (message.includes(key)) return key;
      }
      return 'source';
    }

    function errorTag(error) {
      if (!error) return 'ok';
      return error.constructor.name + '/' + (error.code || 'none') + '/' + errorKey(error);
    }

    function inheritedGetters(keys, thrownKey, marker, order = []) {
      const owner = Object.create(null);
      for (const key of keys) {
        Object.defineProperty(owner, key, {
          get() {
            order.push(key);
            if (key === thrownKey) throw marker;
            return undefined;
          },
        });
      }
      return { options: Object.create(owner), order };
    }

    function hwm(adapter, stream) {
      if (adapter === 'Readable') return stream.readableHighWaterMark;
      if (adapter === 'Writable') return stream.writableHighWaterMark;
      return stream.readableHighWaterMark + '/' + stream.writableHighWaterMark;
    }

    for (const spec of specs) {
      const bag = inheritedGetters(spec.keys);
      const result = capture(() => invoke(spec.adapter, bag.options, {}));
      console.log('source-' + spec.adapter + ':' + errorTag(result.error) + ' getters=' + bag.order.join(','));
    }

    for (const spec of specs) {
      const result = capture(() => invoke(spec.adapter, null));
      console.log('options-' + spec.adapter + ':' + errorTag(result.error));
    }

    for (const spec of specs) {
      const bag = inheritedGetters(spec.keys);
      const result = capture(() => invoke(spec.adapter, bag.options));
      if (!result.error) dispose(result.stream);
      console.log('order-' + spec.adapter + ':' + bag.order.join(','));
    }

    for (const spec of specs) {
      const thrownKey = 'objectMode';
      const marker = { adapter: spec.adapter };
      const bag = inheritedGetters(spec.keys, thrownKey, marker);
      const result = capture(() => invoke(spec.adapter, bag.options));
      console.log(
        'raw-' + spec.adapter +
        ':same=' + (result.error === marker) +
        ' order=' + bag.order.join(','),
      );
    }

    const signal = new AbortController().signal;
    const priorityRows = [
      ['Readable', 'encoding', { encoding: 'wat', objectMode: 'yes', highWaterMark: -1, signal }],
      ['Readable', 'objectMode', { objectMode: 'yes', highWaterMark: -1, signal }],
      ['Readable', 'hwm', { highWaterMark: -1, signal }],
      ['Writable', 'objectMode', { objectMode: 'yes', decodeStrings: 'yes', highWaterMark: -1, signal }],
      ['Writable', 'decodeStrings', { decodeStrings: 'yes', highWaterMark: -1, signal }],
      ['Writable', 'hwm', { highWaterMark: -1, signal }],
      ['Duplex', 'objectMode', { objectMode: 'yes', encoding: 'wat', highWaterMark: -1, signal }],
      ['Duplex', 'encoding', { encoding: 'wat', highWaterMark: -1, signal }],
      ['Duplex', 'hwm', { highWaterMark: -1, signal }],
    ];
    for (const [adapter, label, options] of priorityRows) {
      const result = capture(() => invoke(adapter, options));
      console.log('priority-' + adapter + '-' + label + ':' + errorTag(result.error));
    }

    const invalidHwm = [-1, NaN, Infinity, 1.5, '1'];
    for (const spec of specs) {
      const codes = invalidHwm.map((value) => {
        const result = capture(() => invoke(spec.adapter, { highWaterMark: value }));
        return result.error ? result.error.code || 'none' : 'ok';
      });
      console.log('hwm-invalid-' + spec.adapter + ':' + codes.join(','));
    }

    for (const spec of specs) {
      const withNull = invoke(spec.adapter, { highWaterMark: null });
      const withUndefined = invoke(spec.adapter, { highWaterMark: undefined });
      const withZero = invoke(spec.adapter, { highWaterMark: 0 });
      const sameDefault = hwm(spec.adapter, withNull) === hwm(spec.adapter, withUndefined);
      console.log(
        'hwm-normal-' + spec.adapter +
        ':same-default=' + sameDefault +
        ' zero=' + hwm(spec.adapter, withZero),
      );
      dispose(withNull);
      dispose(withUndefined);
      dispose(withZero);
    }

    for (const spec of specs) {
      const result = capture(() => invoke(spec.adapter, { signal: {} }));
      console.log('signal-invalid-' + spec.adapter + ':' + errorTag(result.error));
    }

    for (const spec of specs) {
      const withNull = capture(() => invoke(spec.adapter, { signal: null }));
      const withUndefined = capture(() => invoke(spec.adapter, { signal: undefined }));
      const withZero = capture(() => invoke(spec.adapter, { signal: 0 }));
      const withEmpty = capture(() => invoke(spec.adapter, { signal: '' }));
      const withFalse = capture(() => invoke(spec.adapter, { signal: false }));
      console.log(
        'signal-absent-' + spec.adapter +
        ':null=' + errorTag(withNull.error) +
        ' undefined=' + errorTag(withUndefined.error) +
        ' zero=' + errorTag(withZero.error) +
        ' empty=' + errorTag(withEmpty.error) +
        ' false=' + errorTag(withFalse.error),
      );
    }

    for (const spec of specs) {
      const events = [];
      const fixture = acquisitionFixture(spec.adapter, events);
      const bag = inheritedGetters(spec.keys, undefined, undefined, events);
      capture(() => invoke(spec.adapter, bag.options, fixture.input));
      console.log('stage-success-' + spec.adapter + ':' + events.join(','));
    }

    for (const spec of specs) {
      const events = [];
      const fixture = acquisitionFixture(spec.adapter, events);
      const result = capture(() => invoke(spec.adapter, null, fixture.input));
      console.log(
        'stage-options-' + spec.adapter + ':' + errorTag(result.error) +
        ' acq=' + events.join('') + ' locks=' + fixture.locks(),
      );
    }

    const earlyRows = [
      ['Readable', { encoding: 'wat' }],
      ['Writable', { decodeStrings: 'yes' }],
      ['Duplex', { objectMode: 'yes' }],
    ];
    for (const [adapter, options] of earlyRows) {
      const events = [];
      const fixture = acquisitionFixture(adapter, events);
      const result = capture(() => invoke(adapter, options, fixture.input));
      console.log(
        'stage-early-' + adapter + ':' + errorTag(result.error) +
        ' acq=' + events.join('') + ' locks=' + fixture.locks(),
      );
    }

    for (const spec of specs) {
      const events = [];
      const fixture = acquisitionFixture(spec.adapter, events);
      const result = capture(() =>
        invoke(spec.adapter, { highWaterMark: -1 }, fixture.input),
      );
      console.log(
        'stage-hwm-' + spec.adapter + ':' + errorTag(result.error) +
        ' acq=' + events.join('') + ' locks=' + fixture.locks(),
      );
    }

    for (const spec of specs) {
      for (const [label, signal] of [
        ['invalid', {}],
        ['raw', { aborted: false }],
      ]) {
        const events = [];
        const fixture = acquisitionFixture(spec.adapter, events);
        const result = capture(() => invoke(spec.adapter, { signal }, fixture.input));
        console.log(
          'stage-signal-' + label + '-' + spec.adapter + ':' + errorTag(result.error) +
          ' acq=' + events.join('') + ' locks=' + fixture.locks(),
        );
      }
    }

    for (const spec of specs) {
      const sourceAccess = [];
      const fake = (key) => {
        const value = {};
        Object.defineProperty(value, key, {
          get() { sourceAccess.push(key); return () => {}; },
        });
        return value;
      };
      const input = spec.adapter === 'Readable'
        ? fake('getReader')
        : spec.adapter === 'Writable'
          ? fake('getWriter')
          : { readable: fake('getReader'), writable: fake('getWriter') };
      const bag = inheritedGetters(spec.keys);
      const result = capture(() => invoke(spec.adapter, bag.options, input));
      console.log(
        'brand-fake-' + spec.adapter + ':' + errorTag(result.error) +
        ' source=' + sourceAccess.join(',') + ' options=' + bag.order.join(','),
      );
    }

    {
      const events = [];
      const fixture = acquisitionFixture('Duplex', events);
      const actual = fixture.input;
      const pair = {};
      Object.defineProperty(pair, 'readable', {
        get() { events.push('pair:R'); return actual.readable; },
      });
      Object.defineProperty(pair, 'writable', {
        get() { events.push('pair:W'); return actual.writable; },
      });
      const bag = inheritedGetters(specs[2].keys, undefined, undefined, events);
      capture(() => invoke('Duplex', bag.options, pair));
      console.log('duplex-pair-order:' + events.join(','));
    }

    {
      const marker = { stage: 'pair writable' };
      const pairOrder = [];
      const pair = {};
      Object.defineProperty(pair, 'readable', {
        get() { pairOrder.push('R'); return {}; },
      });
      Object.defineProperty(pair, 'writable', {
        get() { pairOrder.push('W'); throw marker; },
      });
      const bag = inheritedGetters(specs[2].keys);
      const result = capture(() => invoke('Duplex', bag.options, pair));
      console.log(
        'duplex-pair-raw:same=' + (result.error === marker) +
        ' pair=' + pairOrder.join(',') + ' options=' + bag.order.join(','),
      );
    }

    for (const [adapter, values, thrownKey] of [
      ['Readable', { highWaterMark: -1, encoding: 'wat' }, 'objectMode'],
      ['Writable', { highWaterMark: -1, decodeStrings: 'yes' }, 'objectMode'],
      ['Duplex', { objectMode: 'yes', encoding: 'wat', highWaterMark: -1 }, 'signal'],
    ]) {
      const marker = { adapter };
      const spec = specs.find((candidate) => candidate.adapter === adapter);
      const order = [];
      const options = {};
      for (const key of spec.keys) {
        Object.defineProperty(options, key, {
          get() {
            order.push(key);
            if (key === thrownKey) throw marker;
            return values[key];
          },
        });
      }
      const events = [];
      const fixture = acquisitionFixture(adapter, events);
      const result = capture(() => invoke(adapter, options, fixture.input));
      console.log(
        'snapshot-' + adapter + ':same=' + (result.error === marker) +
        ' order=' + order.join(',') + ' acq=' + events.join(''),
      );
    }

    const duplexDecode = capture(() =>
      invoke('Duplex', { decodeStrings: 'yes' }),
    );
    console.log('duplex-decodeStrings-nonboolean:' + errorTag(duplexDecode.error));
  `,
};

export default c;
