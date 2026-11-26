// Isolate guest EventTarget/Event/CustomEvent/AbortController/AbortSignal (ADR-0579): one line per
// observation (`id<TAB>outcome`), run unchanged by `node`, a sandbox `exec` and `runCode`.
// Outcome: a value's description or the throw's `Ctor|name [code]: message`.
'use strict';
const events = require('node:events');
const fs = require('node:fs');
const tp = require('node:timers/promises');
const util = require('node:util');

const CLASSES = { EventTarget, Event, CustomEvent, AbortController, AbortSignal };
const NAMES = Object.keys(CLASSES);
const lines = [];
const out = (id, v) => lines.push(`${id}\t${v}`);
const thrown = (e) => {
  if (e === null || (typeof e !== 'object' && typeof e !== 'function')) return `throw ${String(e)}`;
  const code = e.code === undefined ? '' : ` [${e.code}]`;
  const cause =
    e.cause === undefined
      ? ''
      : ` cause=${e.cause instanceof Error ? e.cause.name : String(e.cause)}`;
  return `throw ${e.constructor?.name}|${e.name}${code}: ${String(e.message).split('\n')[0]}${cause}`;
};
function desc(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (typeof v === 'symbol') return v.toString();
  if (typeof v === 'function') return `function ${v.name}`;
  if (Array.isArray(v)) return `[${v.map(desc).join(', ')}]`;
  const proto = Object.getPrototypeOf(v);
  return `object ${proto?.constructor?.name ?? 'null-proto'}`;
}
const pin = (id, fn) => {
  let v;
  try {
    v = desc(fn());
  } catch (e) {
    v = thrown(e);
  }
  out(id, v);
};
const pinAsync = async (id, fn, ms = 300) => {
  let v;
  try {
    v = desc(
      await Promise.race([fn(), new Promise((r) => setTimeout(r, ms, `pending after ${ms}ms`))]),
    );
  } catch (e) {
    v = thrown(e);
  }
  out(id, v);
};
const descriptor = (o, k) => {
  const d = Object.getOwnPropertyDescriptor(o, k);
  if (!d) return 'absent';
  if ('value' in d)
    return `data ${typeof d.value} w${+d.writable}e${+d.enumerable}c${+d.configurable}`;
  return `accessor get:${d.get?.name ?? '-'} set:${d.set?.name ?? '-'} e${+d.enumerable}c${+d.configurable}`;
};
const turn = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  // --- globals and shape ---
  for (const n of [...NAMES, 'DOMException']) out(`global ${n}`, descriptor(globalThis, n));
  for (const n of NAMES) {
    const C = CLASSES[n];
    out(`${n} name/length`, `${C.name}/${C.length}`);
    out(`${n} parent`, Object.getPrototypeOf(C).name ?? '-');
    pin(`${n}() without new`, () => C());
    out(`${n} statics`, Reflect.ownKeys(C).map(String).sort().join(','));
    out(
      `${n} static descriptors`,
      Reflect.ownKeys(C)
        .filter((k) => typeof k === 'string' && /^[A-Z_]+$/.test(k))
        .map((k) => `${k}:${descriptor(C, k)}`)
        .join(','),
    );
    const p = C.prototype;
    out(
      `${n}.prototype keys`,
      Reflect.ownKeys(p)
        .filter((k) => typeof k === 'string')
        .join(','),
    );
    out(
      `${n}.prototype symbols`,
      Reflect.ownKeys(p)
        .filter((k) => typeof k === 'symbol')
        .map((s) => s.description)
        .sort()
        .join(','),
    );
    for (const k of Reflect.ownKeys(p))
      if (typeof k === 'string' && k !== 'constructor')
        out(`${n}.prototype.${k}`, descriptor(p, k));
    out(`${n} toStringTag`, Object.prototype.toString.call(p));
  }
  for (const k of ['abort', 'timeout', 'any'])
    out(
      `AbortSignal.${k}`,
      `${descriptor(AbortSignal, k)} ${AbortSignal[k].name}/${AbortSignal[k].length}`,
    );

  // --- AbortController / AbortSignal ---
  pin('new AbortSignal()', () => new AbortSignal());
  pin('aborted getter on {}', () =>
    Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get.call({}),
  );
  {
    const ac = new AbortController();
    const first = ac.signal;
    out('signal identity', first === ac.signal);
    out(
      'signal instanceof',
      `${ac.signal instanceof AbortSignal} ${ac.signal instanceof EventTarget}`,
    );
    out('aborted before', ac.signal.aborted);
    let n = 0;
    ac.signal.onabort = (e) => {
      n++;
      out(
        'onabort event',
        `${e.type} ${e.isTrusted} ${e.target === ac.signal} ${e instanceof Event}`,
      );
    };
    ac.abort();
    ac.abort('again');
    out('listeners ran', n);
    const r = ac.signal.reason;
    out(
      'default reason',
      `${r instanceof DOMException} ${r.constructor === DOMException} ${r.name} ${r.code} ${r.message}`,
    );
    out('default reason own keys', Reflect.ownKeys(r).map(String).join(','));
  }
  pin('abort(reason) reason', () => {
    const ac = new AbortController();
    ac.abort(new Error('mine'));
    return ac.signal.reason.message;
  });
  pin(
    'AbortSignal.abort().reason',
    () => `${AbortSignal.abort().reason.name} ${AbortSignal.abort().reason.code}`,
  );
  pin('AbortSignal.abort(1).reason', () => AbortSignal.abort(1).reason);
  pin('throwIfAborted aborted', () => AbortSignal.abort('r').throwIfAborted());
  pin('throwIfAborted live', () => new AbortController().signal.throwIfAborted());
  for (const v of [-1, 'x', 1.5, 2 ** 32, undefined, Number.NaN])
    pin(`AbortSignal.timeout(${String(v)})`, () => AbortSignal.timeout(v));
  pin('AbortSignal.any([1])', () => AbortSignal.any([1]));
  pin('AbortSignal.any(1)', () => AbortSignal.any(1));
  pin('AbortSignal.any([]).aborted', () => AbortSignal.any([]).aborted);
  pin(
    'AbortSignal.any with aborted',
    () => AbortSignal.any([new AbortController().signal, AbortSignal.abort('A')]).reason,
  );
  {
    const a = new AbortController();
    const b = new AbortController();
    const s = AbortSignal.any([a.signal, b.signal]);
    const log = [];
    s.addEventListener('abort', () => log.push(`any ${s.reason}`));
    b.abort('B');
    a.abort('A');
    out('AbortSignal.any order', `${log.join(',')} reason=${s.reason}`);
    out('AbortSignal.any nested', AbortSignal.any([s]).reason);
  }
  await pinAsync('AbortSignal.timeout(5) fires', () => {
    const s = AbortSignal.timeout(5);
    return new Promise((r) =>
      s.addEventListener('abort', () => r(`${s.reason.name} ${s.reason.code} ${s.reason.message}`)),
    );
  });

  // --- Event / CustomEvent / EventTarget ---
  pin('new Event()', () => new Event());
  pin('new Event(x, 1)', () => new Event('x', 1));
  pin('new Event(x, opts)', () => {
    const e = new Event('x', { bubbles: 1, cancelable: true, composed: 0 });
    return [
      e.type,
      e.bubbles,
      e.cancelable,
      e.composed,
      e.eventPhase,
      e.defaultPrevented,
      e.isTrusted,
      e.target,
      e.currentTarget,
      e.returnValue,
      e.cancelBubble,
    ];
  });
  pin('timeStamp type', () => typeof new Event('x').timeStamp);
  pin('Event getter on {}', () =>
    Object.getOwnPropertyDescriptor(Event.prototype, 'type').get.call({}),
  );
  pin('new CustomEvent(x).detail', () => new CustomEvent('x').detail);
  pin(
    'new CustomEvent(x,{detail}).detail',
    () => new CustomEvent('x', { detail: { a: 1 } }).detail.a,
  );
  pin('CustomEvent detail on Event', () =>
    Object.getOwnPropertyDescriptor(CustomEvent.prototype, 'detail').get.call(new Event('x')),
  );
  {
    const t = new EventTarget();
    const log = [];
    const fn = (e) => log.push(`fn ${e.eventPhase} ${e.currentTarget === t}`);
    t.addEventListener('x', fn);
    t.addEventListener('x', fn);
    t.addEventListener('x', { handleEvent: (e) => log.push(`obj ${e.type}`) });
    t.addEventListener('x', () => log.push('once'), { once: true });
    t.addEventListener(
      'x',
      (e) => {
        e.preventDefault();
        log.push(`passive ${e.defaultPrevented}`);
      },
      { passive: true },
    );
    const r1 = t.dispatchEvent(new Event('x', { cancelable: true }));
    const r2 = t.dispatchEvent(new Event('x'));
    t.removeEventListener('x', fn);
    t.dispatchEvent(new Event('x'));
    out('EventTarget dispatch', `${log.join(',')} r=${r1},${r2}`);
  }
  pin('dispatchEvent({type})', () => new EventTarget().dispatchEvent({ type: 'x' }));
  pin('dispatchEvent()', () => new EventTarget().dispatchEvent());
  pin('addEventListener(x)', () => new EventTarget().addEventListener('x'));
  pin('addEventListener(x, 1)', () => new EventTarget().addEventListener('x', 1));
  pin('addEventListener on {}', () =>
    EventTarget.prototype.addEventListener.call({}, 'x', () => {}),
  );
  pin('dispatch recursion', () => {
    const t = new EventTarget();
    const e = new Event('x');
    let err;
    t.addEventListener('x', () => {
      try {
        t.dispatchEvent(e);
      } catch (x) {
        err = thrown(x);
      }
    });
    t.dispatchEvent(e);
    return err;
  });
  await pinAsync('listener throw is uncaught', async () => {
    const t = new EventTarget();
    let got;
    const h = (e) => {
      got = e.message;
    };
    process.once('uncaughtException', h);
    t.addEventListener('x', () => {
      throw new Error('in listener');
    });
    t.dispatchEvent(new Event('x'));
    await turn();
    return got;
  });
  {
    const t = new EventTarget();
    const ac = new AbortController();
    let n = 0;
    t.addEventListener('x', () => n++, { signal: ac.signal });
    t.dispatchEvent(new Event('x'));
    ac.abort();
    t.dispatchEvent(new Event('x'));
    out('listener signal option', n);
    pin('listener signal option bad', () => t.addEventListener('x', () => {}, { signal: 1 }));
  }
  await pinAsync('MaxListeners warning', async () => {
    const t = new EventTarget();
    let w;
    const h = (x) => {
      w = `${x.name} ${x.message} count=${x.count} type=${x.type}`;
    };
    // Without the default printer: the warning is this line, not stderr.
    process.removeAllListeners('warning');
    process.on('warning', h);
    for (let i = 0; i < 11; i++) t.addEventListener('y', () => {});
    await turn();
    process.off('warning', h);
    return w;
  });
  out(
    'abort signal no max listeners',
    (() => {
      const s = new AbortController().signal;
      let warned = false;
      const h = () => {
        warned = true;
      };
      process.on('warning', h);
      for (let i = 0; i < 50; i++) s.addEventListener('abort', () => {});
      process.off('warning', h);
      return warned;
    })(),
  );
  for (const k of ['kMaxEventTargetListeners', 'kMaxEventTargetListenersWarned'])
    pin(`events.${k}`, () => `${descriptor(events, k)} ${events[k].description}`);

  // --- Node APIs taking a signal ---
  {
    const ac = new AbortController();
    ac.signal.addEventListener('abort', (e) => e.stopImmediatePropagation());
    let n = 0;
    events.addAbortListener(ac.signal, () => n++);
    ac.abort();
    out('addAbortListener after a stopping listener', n);
  }
  {
    const ac = new AbortController();
    ac.signal.addEventListener('abort', (e) => e.stopImmediatePropagation());
    const p = events.once(new events.EventEmitter(), 'x', { signal: ac.signal });
    ac.abort();
    await pinAsync('events.once after a stopping listener', () => p);
  }
  await pinAsync('events.once(ee, x, {signal}) aborted', () =>
    events.once(new events.EventEmitter(), 'x', { signal: AbortSignal.abort() }),
  );
  await pinAsync('events.once(et, x)', async () => {
    const t = new EventTarget();
    const p = events.once(t, 'x');
    t.dispatchEvent(new Event('x'));
    return (await p)[0].type;
  });
  pin('typeof events.on', () => typeof events.on);
  pin('typeof events.getEventListeners', () => typeof events.getEventListeners);
  pin('typeof events.setMaxListeners', () => typeof events.setMaxListeners);
  await pinAsync('timers/promises.setTimeout aborted', () =>
    tp.setTimeout(5, 'v', { signal: AbortSignal.abort() }),
  );
  await pinAsync('timers/promises.setTimeout abort later', () => {
    const ac = new AbortController();
    const p = tp.setTimeout(50, 'v', { signal: ac.signal });
    ac.abort();
    return p;
  });
  await pinAsync('timers/promises.setImmediate aborted', () =>
    tp.setImmediate('v', { signal: AbortSignal.abort('why') }),
  );
  await pinAsync('timers/promises.setInterval aborted', async () => {
    for await (const _ of tp.setInterval(1, 'i', { signal: AbortSignal.abort() }));
  });
  await pinAsync('timers/promises.setTimeout live signal', () =>
    tp.setTimeout(1, 'v', { signal: new AbortController().signal }),
  );
  fs.writeFileSync('f.txt', 'abc');
  await pinAsync(
    'fs.readFile signal aborted',
    () =>
      new Promise((res, rej) =>
        fs.readFile('f.txt', { encoding: 'utf8', signal: AbortSignal.abort() }, (e, d) =>
          e ? rej(e) : res(d),
        ),
      ),
  );
  await pinAsync(
    'fs.readFile signal live',
    () =>
      new Promise((res, rej) =>
        fs.readFile('f.txt', { encoding: 'utf8', signal: new AbortController().signal }, (e, d) =>
          e ? rej(e) : res(d),
        ),
      ),
  );
  await pinAsync('fs.promises.readFile signal aborted', () =>
    fs.promises.readFile('f.txt', { encoding: 'utf8', signal: AbortSignal.abort() }),
  );
  await pinAsync('fs.promises.writeFile signal aborted', () =>
    fs.promises.writeFile('g.txt', 'x', { signal: AbortSignal.abort() }),
  );
  pin('g.txt exists', () => fs.existsSync('g.txt'));

  // --- util ---
  pin('util.inspect(controller)', () => util.inspect(new AbortController()));
  pin('util.inspect(signal)', () => util.inspect(AbortSignal.abort()));
  pin('util.inspect(event)', () =>
    util.inspect(new Event('x')).replace(/timeStamp: [\d.]+/, 'timeStamp: N'),
  );
  pin('util.inspect(target)', () => util.inspect(new EventTarget()));

  // --- transfer: structuredClone/postMessage ceilings; the symbol path is the MessageChannel gap ---
  pin('signal[kTransferList]()', () => {
    const s = new AbortController().signal;
    const k = Object.getOwnPropertySymbols(AbortSignal.prototype).find(
      (x) => x.description === 'messaging_transfer_list_symbol',
    );
    return s[k]().length;
  });

  for (const l of lines) process.stdout.write(`${l}\n`);
})();
