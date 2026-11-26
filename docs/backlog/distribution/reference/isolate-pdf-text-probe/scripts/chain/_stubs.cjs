// PROBE ONLY — not a product path. Script-side ponyfills that replace a ceiling global, so a run
// gets past one stop and shows the next. install('a,b') → globals replaced before the library loads.
const table = {
  URLSearchParams: () => {
    // biome-ignore lint/performance/noDelete: probe removes a ceiling global / own property; undefined differs
    delete globalThis.URLSearchParams;
    globalThis.URLSearchParams = require('core-js-pure/actual/url-search-params');
  },
  URL: () => {
    // biome-ignore lint/performance/noDelete: probe removes a ceiling global / own property; undefined differs
    delete globalThis.URL;
    // biome-ignore lint/performance/noDelete: probe removes a ceiling global / own property; undefined differs
    delete globalThis.URLSearchParams;
    globalThis.URLSearchParams = require('core-js-pure/actual/url-search-params');
    globalThis.URL = require('core-js-pure/actual/url');
  },
  // The ceiling is deleted first: core-js takes a global function for a native one and calls it.
  structuredClone: () => {
    // biome-ignore lint/performance/noDelete: probe removes a ceiling global / own property; undefined differs
    delete globalThis.structuredClone;
    globalThis.structuredClone = require('core-js-pure/actual/structured-clone');
  },
  ReadableStream: () => {
    const ws = require('web-streams-polyfill');
    for (const k of [
      'ReadableStream',
      'WritableStream',
      'TransformStream',
      'ByteLengthQueuingStrategy',
      'CountQueuingStrategy',
    ])
      globalThis[k] = ws[k];
  },
  AbortController: () => {
    const ac = require('abort-controller');
    const ets = require('event-target-shim');
    globalThis.AbortController = ac.AbortController;
    globalThis.AbortSignal = ac.AbortSignal;
    globalThis.EventTarget = ets.EventTarget;
  },
  getBuiltinModule: () => {
    process.getBuiltinModule = (id) => require(id);
  },
  DOMMatrix: () => {
    globalThis.DOMMatrix = require('dommatrix');
  },
  DOMMatrixStub: () => {
    globalThis.DOMMatrix = class DOMMatrix {};
  },
  noDecompressionStream: () => {
    // biome-ignore lint/performance/noDelete: probe removes a ceiling global / own property; undefined differs
    delete globalThis.DecompressionStream;
  },
  MessageChannel: () => {
    // Minimal same-thread channel: async delivery of a structuredClone'd message.
    class Port {
      constructor() {
        this.other = null;
        this.onmessage = null;
        this.l = [];
      }
      postMessage(m) {
        const o = this.other;
        const data = globalThis.structuredClone(m);
        setTimeout(() => {
          const ev = { data };
          if (o.onmessage) o.onmessage(ev);
          for (const f of o.l) f(ev);
        }, 0);
      }
      addEventListener(t, f) {
        if (t === 'message') this.l.push(f);
      }
      removeEventListener(_t, f) {
        this.l = this.l.filter((x) => x !== f);
      }
      start() {}
      close() {}
      unref() {}
    }
    globalThis.MessageChannel = class MessageChannel {
      constructor() {
        this.port1 = new Port();
        this.port2 = new Port();
        this.port1.other = this.port2;
        this.port2.other = this.port1;
      }
    };
  },
};
exports.names = Object.keys(table);
exports.install = (list) => {
  for (const n of String(list || '')
    .split(',')
    .filter((s) => s && s !== '-')) {
    if (!table[n]) throw new Error(`unknown stub ${n}`);
    table[n]();
  }
};
