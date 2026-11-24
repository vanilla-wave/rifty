// Oracle-side trace, real Node only: `node -r ./trace.cjs gen/<lib>.cjs <out>`. At exit prints one
// `TRACE {…}` line on stderr: every builtin module the run loads (require or import(), with the
// node_modules frames of its first load) and every web global it reads (a `typeof X` check included), with
// TextDecoder labels. The isolate guest's gaps are the intersection with the compat ❌ rows; the
// sandbox runs confirm which of them a run actually needs.
const Module = require('node:module');
const { builtinModules } = Module;

// The node_modules frames of the first load, innermost first (the require chain for a builtin).
const site = () => {
  const hits = new Error().stack
    .split('\n')
    .slice(2)
    .filter((l) => l.includes('node_modules'))
    .map((l) => l.replace(/.*node_modules\//, '').replace(/\)$/, ''));
  return hits.length ? hits.slice(0, 20) : ['(generator)'];
};
const modules = {};
const note = (map, key) => {
  if (!(key in map)) map[key] = site();
};
const isBuiltin = (id) => id.startsWith('node:') || builtinModules.includes(id.split('/')[0]);
Error.stackTraceLimit = 200;
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (isBuiltin(request)) note(modules, request.replace(/^node:/, ''));
  return load.call(this, request, parent, isMain);
};
// import(): the resolve hook (it sees require() too, told apart by its conditions).
Module.registerHooks({
  resolve(specifier, context, next) {
    if (isBuiltin(specifier) && !context.conditions?.includes('require'))
      note(modules, `${specifier.replace(/^node:/, '')} (import())`);
    return next(specifier, context);
  },
});

const WEB = [
  'URL',
  'URLSearchParams',
  'structuredClone',
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'CompressionStream',
  'DecompressionStream',
  'TextEncoderStream',
  'TextDecoderStream',
  'AbortController',
  'AbortSignal',
  'Event',
  'EventTarget',
  'CustomEvent',
  'Blob',
  'File',
  'FileReader',
  'Request',
  'Response',
  'Headers',
  'FormData',
  'fetch',
  'WebSocket',
  'MessageChannel',
  'MessagePort',
  'BroadcastChannel',
  'navigator',
  'crypto',
  'performance',
  'TextEncoder',
  'TextDecoder',
  'atob',
  'btoa',
  'queueMicrotask',
  'setImmediate',
  'DOMParser',
  'XMLSerializer',
  'document',
  'window',
  'self',
  'Image',
  'OffscreenCanvas',
  'WeakRef',
  'FinalizationRegistry',
];
const globals = {};
let armed = false; // Node's own startup reads some of these
for (const name of WEB) {
  const d = Object.getOwnPropertyDescriptor(globalThis, name);
  if (!d) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        if (armed) note(globals, `${name} (absent in Node too)`);
        return undefined;
      },
    });
    continue;
  }
  const value = d.get ? d.get.call(globalThis) : d.value;
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      if (armed) note(globals, name);
      return value;
    },
    set(v) {
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: v });
    },
  });
}
const labels = new Set();
const TD = TextDecoder;
const tdDesc = Object.getOwnPropertyDescriptor(globalThis, 'TextDecoder');
const Wrapped = class TextDecoder extends TD {
  constructor(label, o) {
    labels.add(String(label).toLowerCase());
    super(label, o);
  }
};
Object.defineProperty(globalThis, 'TextDecoder', {
  ...tdDesc,
  get() {
    if (armed) note(globals, 'TextDecoder');
    return Wrapped;
  },
});
armed = true;
process.on('exit', () => {
  armed = false;
  process.stderr.write(
    `TRACE ${JSON.stringify({ modules, globals, textDecoderLabels: [...labels] })}\n`,
  );
});
