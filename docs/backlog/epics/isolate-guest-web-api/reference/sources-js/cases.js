// Differential cases: the same text runs under live Node (W = globalThis) and in a bare
// isolated-vm isolate (W = a candidate's classes). Each case returns JSON-able data.
// Errors are compared by constructor name, name, code and message.
globalThis.__cases = (() => {
  const d = (e) =>
    e && typeof e === 'object' && 'message' in e
      ? { ctor: e.constructor?.name, name: e.name, code: e.code, message: e.message }
      : { value: typeof e === 'symbol' ? String(e) : e };
  const caught = async (f) => {
    try {
      return { ok: await f() };
    } catch (e) {
      return { threw: d(e) };
    }
  };
  const tick = () => new Promise((r) => r());
  const drain = async (rs) => {
    const out = [];
    for await (const c of rs) out.push(c);
    return out;
  };
  const sleep = (W, ms) => new Promise((r) => W.__setTimeout(r, ms));
  const SHAPE = [
    'EventTarget',
    'Event',
    'CustomEvent',
    'AbortController',
    'AbortSignal',
    'ReadableStream',
    'ReadableStreamDefaultReader',
    'ReadableStreamBYOBReader',
    'ReadableStreamBYOBRequest',
    'ReadableByteStreamController',
    'ReadableStreamDefaultController',
    'WritableStream',
    'WritableStreamDefaultWriter',
    'WritableStreamDefaultController',
    'TransformStream',
    'TransformStreamDefaultController',
    'ByteLengthQueuingStrategy',
    'CountQueuingStrategy',
    'TextEncoderStream',
    'TextDecoderStream',
  ];
  const cases = [];
  const c = (group, id, run) => cases.push({ group, id, run });
  for (const name of SHAPE) {
    const group = /Stream|Queuing/.test(name) ? 'streams' : 'events';
    c(group, `shape:${name}`, (W) => {
      const C = W[name];
      if (typeof C !== 'function') return { missing: typeof C };
      return {
        name: C.name,
        length: C.length,
        statics: Object.getOwnPropertyNames(C)
          .filter((k) => !['prototype', 'length', 'name', 'caller', 'arguments'].includes(k))
          .sort(),
        proto: Object.getOwnPropertyNames(C.prototype).sort(),
        tag: C.prototype[Symbol.toStringTag],
        parent: Object.getPrototypeOf(C.prototype)?.constructor?.name,
        asyncIterator: Symbol.asyncIterator in C.prototype,
      };
    });
  }
  // ---- streams ----
  c('streams', 'read sequence', async (W) => {
    const rs = new W.ReadableStream({
      start(ctl) {
        ctl.enqueue(1);
        ctl.enqueue(2);
        ctl.close();
      },
    });
    const r = rs.getReader();
    return [await r.read(), await r.read(), await r.read()];
  });
  c('streams', 'desiredSize hwm 3', (W) => {
    const out = [];
    new W.ReadableStream(
      {
        start(ctl) {
          for (let i = 0; i < 4; i++) {
            out.push(ctl.desiredSize);
            ctl.enqueue(i);
          }
          out.push(ctl.desiredSize);
          ctl.close();
          out.push(ctl.desiredSize);
        },
      },
      { highWaterMark: 3 },
    );
    return out;
  });
  c('streams', 'queuing strategies', (W) => {
    const b = new W.ByteLengthQueuingStrategy({ highWaterMark: 16 });
    const n = new W.CountQueuingStrategy({ highWaterMark: 2 });
    return [
      b.highWaterMark,
      b.size({ byteLength: 5 }),
      n.highWaterMark,
      n.size('x'),
      b.size.name,
      n.size.name,
      b.size === new W.ByteLengthQueuingStrategy({ highWaterMark: 1 }).size,
    ];
  });
  c('streams', 'pull count', async (W) => {
    let pulls = 0;
    const rs = new W.ReadableStream(
      {
        pull(ctl) {
          pulls++;
          ctl.enqueue(pulls);
          if (pulls === 5) ctl.close();
        },
      },
      { highWaterMark: 2 },
    );
    await tick();
    await tick();
    await tick();
    const before = pulls;
    const got = await drain(rs);
    return { before, got, pulls };
  });
  c('streams', 'tee', async (W) => {
    const rs = new W.ReadableStream({
      start(ctl) {
        ctl.enqueue('a');
        ctl.enqueue('b');
        ctl.close();
      },
    });
    const [x, y] = rs.tee();
    return [await drain(x), await drain(y), rs.locked];
  });
  c('streams', 'tee cancel both', async (W) => {
    let reason;
    const rs = new W.ReadableStream({
      cancel(r) {
        reason = r;
      },
    });
    const [x, y] = rs.tee();
    await Promise.all([x.cancel('r1'), y.cancel('r2')]);
    return reason;
  });
  c('streams', 'pipeTo', async (W) => {
    const got = [];
    const rs = new W.ReadableStream({
      start(ctl) {
        ctl.enqueue(1);
        ctl.enqueue(2);
        ctl.close();
      },
    });
    const r = await rs.pipeTo(
      new W.WritableStream({
        write(ch) {
          got.push(ch);
        },
        close() {
          got.push('closed');
        },
      }),
    );
    return { r, got };
  });
  c('streams', 'pipeTo preventClose', async (W) => {
    let closed = false;
    const rs = new W.ReadableStream({
      start(ctl) {
        ctl.close();
      },
    });
    await rs.pipeTo(
      new W.WritableStream({
        close() {
          closed = true;
        },
      }),
      { preventClose: true },
    );
    return closed;
  });
  c('streams', 'pipeTo signal abort', async (W) => {
    const ac = new W.AbortController();
    const rs = new W.ReadableStream({});
    const p = caught(() => rs.pipeTo(new W.WritableStream({}), { signal: ac.signal }));
    ac.abort();
    return p;
  });
  c('streams', 'pipeTo source error aborts dest', async (W) => {
    let abortReason;
    const err = new Error('src');
    const rs = new W.ReadableStream({
      start(ctl) {
        ctl.error(err);
      },
    });
    const res = await caught(() =>
      rs.pipeTo(
        new W.WritableStream({
          abort(r) {
            abortReason = r;
          },
        }),
      ),
    );
    return { res, same: abortReason === err };
  });
  c('streams', 'pipeThrough upper', async (W) => {
    const rs = new W.ReadableStream({
      start(ctl) {
        ctl.enqueue('ab');
        ctl.enqueue('c');
        ctl.close();
      },
    });
    const t = new W.TransformStream({
      transform(ch, ctl) {
        ctl.enqueue(ch.toUpperCase());
      },
      flush(ctl) {
        ctl.enqueue('!');
      },
    });
    return drain(rs.pipeThrough(t));
  });
  c('streams', 'transform strategies desiredSize', (W) => {
    const t = new W.TransformStream({}, { highWaterMark: 4 }, { highWaterMark: 2 });
    const w = t.writable.getWriter();
    return [w.desiredSize];
  });
  c('streams', 'writable backpressure', async (W) => {
    const log = [];
    const ws = new W.WritableStream(
      {
        write() {
          return new Promise((r) => setTimeoutLike(r));
        },
      },
      { highWaterMark: 2 },
    );
    function setTimeoutLike(r) {
      Promise.resolve().then(r);
    }
    const w = ws.getWriter();
    log.push(w.desiredSize);
    w.write(1);
    log.push(w.desiredSize);
    w.write(2);
    log.push(w.desiredSize);
    w.write(3);
    log.push(w.desiredSize);
    await w.ready;
    log.push(w.desiredSize);
    await w.close();
    log.push(w.desiredSize);
    return log;
  });
  c('streams', 'writable abort reason', async (W) => {
    let got;
    let sig;
    const ws = new W.WritableStream({
      start(ctl) {
        sig = ctl.signal;
      },
      abort(r) {
        got = r;
      },
    });
    await ws.abort('why');
    return [got, sig.aborted, sig.reason];
  });
  c('streams', 'writer close then write', async (W) => {
    const w = new W.WritableStream({}).getWriter();
    w.close();
    return caught(() => w.write(1));
  });
  c('streams', 'cancel reason', async (W) => {
    let got;
    const rs = new W.ReadableStream({
      cancel(r) {
        got = r;
      },
    });
    const res = await rs.cancel('stop');
    return [res, got];
  });
  c('streams', 'start throws', async (W) => {
    const rs = new W.ReadableStream({
      start() {
        throw new TypeError('boom');
      },
    });
    return caught(() => rs.getReader().read());
  });
  c('streams', 'controller.error', async (W) => {
    const rs = new W.ReadableStream({
      start(ctl) {
        ctl.error(new RangeError('bad'));
      },
    });
    const r = rs.getReader();
    return [await caught(() => r.read()), await caught(() => r.closed)];
  });
  c('streams', 'getReader twice', async (W) => {
    const rs = new W.ReadableStream();
    rs.getReader();
    return caught(() => rs.getReader());
  });
  c('streams', 'locked', (W) => {
    const rs = new W.ReadableStream();
    const a = rs.locked;
    const r = rs.getReader();
    const b = rs.locked;
    r.releaseLock();
    return [a, b, rs.locked];
  });
  c('streams', 'read after releaseLock', async (W) => {
    const r = new W.ReadableStream().getReader();
    r.releaseLock();
    return caught(() => r.read());
  });
  c('streams', 'enqueue after close', (W) => {
    let e;
    new W.ReadableStream({
      start(ctl) {
        ctl.close();
        try {
          ctl.enqueue(1);
        } catch (x) {
          e = d(x);
        }
      },
    });
    return e;
  });
  c('streams', 'bad underlyingSource', () => caught(() => new globalThis.__W.ReadableStream(1)));
  c('streams', 'bad highWaterMark', (W) =>
    caught(() => new W.WritableStream({}, { highWaterMark: -1 })),
  );
  c('streams', 'bad type', (W) => caught(() => new W.ReadableStream({ type: 'nope' })));
  c('streams', 'byob read', async (W) => {
    const rs = new W.ReadableStream({
      type: 'bytes',
      start(ctl) {
        ctl.enqueue(new Uint8Array([1, 2, 3, 4]));
        ctl.close();
      },
    });
    const r = rs.getReader({ mode: 'byob' });
    const a = await r.read(new Uint8Array(2));
    const b = await r.read(new Uint8Array(8));
    return [
      [...a.value],
      a.done,
      a.value.byteLength,
      a.value.buffer.byteLength,
      [...b.value],
      b.done,
    ];
  });
  c('streams', 'byob request respond', async (W) => {
    const log = [];
    const rs = new W.ReadableStream({
      type: 'bytes',
      pull(ctl) {
        const req = ctl.byobRequest;
        log.push(req.view.byteLength);
        req.view[0] = 9;
        req.respond(1);
        ctl.close();
      },
    });
    const r = rs.getReader({ mode: 'byob' });
    const a = await r.read(new Uint8Array(4));
    return [log, [...a.value], a.done];
  });
  c('streams', 'byob detached source buffer', async (W) => {
    const rs = new W.ReadableStream({ type: 'bytes' });
    const r = rs.getReader({ mode: 'byob' });
    const view = new Uint8Array(4);
    r.read(view);
    return view.buffer.byteLength;
  });
  c('streams', 'byob zero-length view', async (W) => {
    const r = new W.ReadableStream({ type: 'bytes' }).getReader({ mode: 'byob' });
    return caught(() => r.read(new Uint8Array(0)));
  });
  c('streams', 'ReadableStream.from', async (W) =>
    typeof W.ReadableStream.from === 'function'
      ? drain(W.ReadableStream.from([1, 2, 3]))
      : 'absent',
  );
  c('streams', 'for await break cancels', async (W) => {
    let cancelled = false;
    const rs = new W.ReadableStream({
      pull(ctl) {
        ctl.enqueue(1);
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const x of rs) {
      void x;
      break;
    }
    return cancelled;
  });
  c('streams', 'values preventCancel', async (W) => {
    let cancelled = false;
    const rs = new W.ReadableStream({
      pull(ctl) {
        ctl.enqueue(1);
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const x of rs.values({ preventCancel: true })) {
      void x;
      break;
    }
    return [cancelled, rs.locked];
  });
  c('streams', 'microtask order', async (W) => {
    const log = [];
    const rs = new W.ReadableStream({
      start(ctl) {
        ctl.enqueue('x');
      },
    });
    const r = rs.getReader();
    r.read().then(() => log.push('read'));
    Promise.resolve()
      .then(() => log.push('p1'))
      .then(() => log.push('p2'))
      .then(() => log.push('p3'));
    for (let i = 0; i < 6; i++) await tick();
    return log;
  });
  c('streams', 'pending read order', async (W) => {
    const log = [];
    let ctl;
    const rs = new W.ReadableStream({
      start(c2) {
        ctl = c2;
      },
    });
    const r = rs.getReader();
    r.read().then((v) => log.push(['r1', v.value]));
    r.read().then((v) => log.push(['r2', v.value]));
    ctl.enqueue('a');
    log.push('enq-a');
    ctl.enqueue('b');
    log.push('enq-b');
    for (let i = 0; i < 4; i++) await tick();
    return log;
  });
  c('streams', 'TextEncoderStream', async (W) => {
    if (typeof W.TextEncoderStream !== 'function') return 'absent';
    const s = new W.TextEncoderStream();
    const w = s.writable.getWriter();
    w.write('hé');
    w.write('\ud83d');
    w.write('\ude00');
    w.close();
    const out = await drain(s.readable);
    return [s.encoding, out.map((u) => [...u])];
  });
  c('streams', 'TextDecoderStream split', async (W) => {
    if (typeof W.TextDecoderStream !== 'function') return 'absent';
    const s = new W.TextDecoderStream();
    const w = s.writable.getWriter();
    w.write(new Uint8Array([0x68, 0xc3]));
    w.write(new Uint8Array([0xa9]));
    w.close();
    return [s.encoding, s.fatal, s.ignoreBOM, await drain(s.readable)];
  });
  c('streams', 'TextDecoderStream fatal', async (W) => {
    if (typeof W.TextDecoderStream !== 'function') return 'absent';
    const s = new W.TextDecoderStream('utf-8', { fatal: true });
    const w = s.writable.getWriter();
    w.write(new Uint8Array([0xff])).catch(() => {});
    w.close().catch(() => {});
    return caught(() => drain(s.readable));
  });
  c('streams', 'size NaN', (W) => {
    let e;
    new W.ReadableStream(
      {
        start(ctl) {
          try {
            ctl.enqueue(1);
          } catch (x) {
            e = d(x);
          }
        },
      },
      { size: () => Number.NaN },
    );
    return e;
  });
  c('streams', 'brand check', (W) => caught(() => W.ReadableStream.prototype.getReader.call({})));
  c('streams', 'reader on locked via constructor', (W) => {
    const rs = new W.ReadableStream();
    rs.getReader();
    return caught(() => new W.ReadableStreamDefaultReader(rs));
  });
  // ---- events / abort ----
  c('events', 'listener order + return', (W) => {
    const t = new W.EventTarget();
    const log = [];
    t.addEventListener('x', () => log.push(1));
    t.addEventListener('x', () => log.push(2));
    t.addEventListener('x', {
      handleEvent() {
        log.push('obj');
      },
    });
    const r = t.dispatchEvent(new W.Event('x'));
    return [log, r];
  });
  c('events', 'once', (W) => {
    const t = new W.EventTarget();
    let n = 0;
    t.addEventListener('x', () => n++, { once: true });
    t.dispatchEvent(new W.Event('x'));
    t.dispatchEvent(new W.Event('x'));
    return n;
  });
  c('events', 'signal option', (W) => {
    const t = new W.EventTarget();
    const ac = new W.AbortController();
    let n = 0;
    t.addEventListener('x', () => n++, { signal: ac.signal });
    t.dispatchEvent(new W.Event('x'));
    ac.abort();
    t.dispatchEvent(new W.Event('x'));
    return n;
  });
  c('events', 'duplicate ignored + capture distinct', (W) => {
    const t = new W.EventTarget();
    let n = 0;
    const f = () => n++;
    t.addEventListener('x', f);
    t.addEventListener('x', f);
    t.addEventListener('x', f, true);
    t.dispatchEvent(new W.Event('x'));
    return n;
  });
  c('events', 'removeEventListener', (W) => {
    const t = new W.EventTarget();
    let n = 0;
    const f = () => n++;
    t.addEventListener('x', f);
    t.removeEventListener('x', f);
    t.dispatchEvent(new W.Event('x'));
    return n;
  });
  c('events', 'stopImmediatePropagation', (W) => {
    const t = new W.EventTarget();
    const log = [];
    t.addEventListener('x', (e) => {
      log.push(1);
      e.stopImmediatePropagation();
    });
    t.addEventListener('x', () => log.push(2));
    t.dispatchEvent(new W.Event('x'));
    return log;
  });
  c('events', 'preventDefault', (W) => {
    const t = new W.EventTarget();
    t.addEventListener('x', (e) => e.preventDefault());
    const a = new W.Event('x', { cancelable: true });
    const b = new W.Event('x');
    return [
      t.dispatchEvent(a),
      a.defaultPrevented,
      a.returnValue,
      t.dispatchEvent(b),
      b.defaultPrevented,
    ];
  });
  c('events', 'event props in dispatch', (W) => {
    const t = new W.EventTarget();
    let seen;
    t.addEventListener('x', (e) => {
      seen = [
        e.type,
        e.eventPhase,
        e.target === t,
        e.currentTarget === t,
        e.isTrusted,
        e.bubbles,
        e.composed,
        e.composedPath().length,
        typeof e.timeStamp,
      ];
    });
    const e = new W.Event('x', { bubbles: true });
    t.dispatchEvent(e);
    return [seen, e.eventPhase, e.currentTarget, e.target === t];
  });
  c('events', 'Event constants', (W) => [
    W.Event.NONE,
    W.Event.CAPTURING_PHASE,
    W.Event.AT_TARGET,
    W.Event.BUBBLING_PHASE,
  ]);
  c('events', 'CustomEvent detail', (W) =>
    typeof W.CustomEvent === 'function'
      ? [
          new W.CustomEvent('c', { detail: { a: 1 } }).detail,
          new W.CustomEvent('c').detail,
          new W.CustomEvent('c') instanceof W.Event,
        ]
      : 'absent',
  );
  c('events', 'dispatch non-Event', (W) =>
    caught(() => new W.EventTarget().dispatchEvent({ type: 'x' })),
  );
  c('events', 'new Event()', (W) => caught(() => new W.Event()));
  c('events', 'redispatch during dispatch', (W) => {
    const t = new W.EventTarget();
    const e = new W.Event('x');
    let r;
    t.addEventListener('x', () => {
      try {
        t.dispatchEvent(e);
      } catch (x) {
        r = d(x);
      }
    });
    t.dispatchEvent(e);
    return r;
  });
  c('events', 'abort default reason', (W) => {
    const ac = new W.AbortController();
    ac.abort();
    const r = ac.signal.reason;
    return [ac.signal.aborted, d(r), r instanceof W.DOMException, r.code];
  });
  c('events', 'abort custom reason + event once', (W) => {
    const ac = new W.AbortController();
    const log = [];
    ac.signal.addEventListener('abort', (e) => log.push(e.type, e.target === ac.signal));
    ac.signal.onabort = () => log.push('on');
    ac.abort('r');
    ac.abort('again');
    return [log, ac.signal.reason];
  });
  c('events', 'throwIfAborted', (W) => {
    const ac = new W.AbortController();
    const before = caught(() => ac.signal.throwIfAborted());
    ac.abort(42);
    let after;
    try {
      ac.signal.throwIfAborted();
    } catch (e) {
      after = e;
    }
    return Promise.all([before]).then(([b]) => [b, after]);
  });
  c('events', 'AbortSignal.abort()', (W) => {
    const s = W.AbortSignal.abort();
    return [s.aborted, d(s.reason)];
  });
  c('events', 'AbortSignal.abort(reason)', (W) => W.AbortSignal.abort('x').reason);
  c('events', 'AbortSignal.timeout', async (W) => {
    if (typeof W.AbortSignal.timeout !== 'function') return 'absent';
    const s = W.AbortSignal.timeout(5);
    const a = s.aborted;
    await new Promise((r) => s.addEventListener('abort', r));
    return [a, s.aborted, d(s.reason), s.reason.code];
  });
  c('events', 'AbortSignal.timeout(-1)', (W) =>
    typeof W.AbortSignal.timeout !== 'function'
      ? 'absent'
      : caught(() => W.AbortSignal.timeout(-1)),
  );
  c('events', 'AbortSignal.any', (W) => {
    if (typeof W.AbortSignal.any !== 'function') return 'absent';
    const a = new W.AbortController();
    const b = new W.AbortController();
    const s = W.AbortSignal.any([a.signal, b.signal]);
    const before = s.aborted;
    b.abort('B');
    a.abort('A');
    const pre = W.AbortSignal.any([W.AbortSignal.abort('P'), a.signal]);
    return [before, s.aborted, s.reason, pre.aborted, pre.reason];
  });
  c('events', 'AbortSignal.any bad arg', (W) =>
    typeof W.AbortSignal.any !== 'function' ? 'absent' : caught(() => W.AbortSignal.any([{}])),
  );
  c('events', 'new AbortSignal()', (W) => caught(() => new W.AbortSignal()));
  c('events', 'signal instanceof EventTarget', (W) => [
    new W.AbortController().signal instanceof W.EventTarget,
    Object.prototype.toString.call(new W.AbortController().signal),
  ]);
  c('events', 'abort() with undefined arg', (W) => {
    const ac = new W.AbortController();
    ac.abort(undefined);
    return d(ac.signal.reason);
  });
  c('events', 'listener on aborted signal option', (W) => {
    const t = new W.EventTarget();
    let n = 0;
    t.addEventListener('x', () => n++, { signal: W.AbortSignal.abort() });
    t.dispatchEvent(new W.Event('x'));
    return n;
  });
  return { cases, sleep };
})();
globalThis.__runCases = async (W, only) => {
  globalThis.__W = W;
  const out = {};
  for (const { group, id, run } of globalThis.__cases.cases) {
    if (only && group !== only) continue;
    try {
      out[id] = JSON.stringify({ ok: await run(W) });
    } catch (e) {
      out[id] = JSON.stringify({
        threwOutside: e && {
          ctor: e.constructor?.name,
          name: e.name,
          code: e.code,
          message: e.message,
        },
      });
    }
  }
  return JSON.stringify(out);
};
