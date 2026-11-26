// Oracle-side trace, real Node only: `node -r ./trace.cjs <script> <pdf…>`. Extended copy of the
// repo's docs/backlog/distribution/reference/isolate-library-probe/trace.cjs. At exit prints one
// `TRACE {…}` line on stderr:
//   modules   builtin modules loaded (require / import() / process.getBuiltinModule), first-load frames
//   esm       non-builtin specifiers resolved with ESM conditions (static import or import())
//   globals   web / DOM globals read (a `typeof X` check included), first-read frames
//   used      globals actually called or constructed, static members called, with counts
//   textDecoderLabels
const Module = require('node:module');
const { builtinModules } = Module;

const site = () => {
  const hits = new Error().stack
    .split('\n')
    .slice(2)
    .filter((l) => l.includes('node_modules'))
    .map((l) => l.replace(/.*node_modules\//, '').replace(/\)$/, ''));
  return hits.length ? hits.slice(0, 6) : ['(script)'];
};
const modules = {};
const esm = {};
const globals = {};
const used = {};
const note = (map, key) => {
  if (!(key in map)) map[key] = site();
};
const count = (key) => {
  if (!used[key]) used[key] = { n: 0, at: site() };
  used[key].n += 1;
};
const isBuiltin = (id) => id.startsWith('node:') || builtinModules.includes(id.split('/')[0]);
Error.stackTraceLimit = 200;
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (isBuiltin(request)) note(modules, request.replace(/^node:/, ''));
  return load.call(this, request, parent, isMain);
};
Module.registerHooks({
  resolve(specifier, context, next) {
    const isRequire = context.conditions?.includes('require');
    if (isBuiltin(specifier)) {
      if (!isRequire) note(modules, `${specifier.replace(/^node:/, '')} (import)`);
    } else if (!isRequire) {
      const r = next(specifier, context);
      const short = String(r.url).replace(/.*node_modules\//, '');
      if (!String(r.url).includes('/scripts/') && !(short in esm)) esm[short] = r.format || '?';
      return r;
    }
    return next(specifier, context);
  },
});
if (typeof process.getBuiltinModule === 'function') {
  const gbm = process.getBuiltinModule;
  process.getBuiltinModule = function (id) {
    note(modules, `${String(id).replace(/^node:/, '')} (process.getBuiltinModule)`);
    return gbm.call(this, id);
  };
}

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
  'ByteLengthQueuingStrategy',
  'CountQueuingStrategy',
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
  'DOMMatrix',
  'DOMMatrixReadOnly',
  'DOMPoint',
  'DOMRect',
  'Path2D',
  'ImageData',
  'ImageBitmap',
  'createImageBitmap',
  'Worker',
  'SharedWorker',
  'location',
  'WebAssembly',
  'Intl',
  'XMLHttpRequest',
  'FontFace',
  'localStorage',
  'requestAnimationFrame',
  'importScripts',
  'DOMException',
  'SharedArrayBuffer',
  'Atomics',
  'CSS',
  'matchMedia',
  'ImageDecoder',
  'VideoFrame',
  'WorkerGlobalScope',
  'require',
  'Buffer',
];
// Functions wrapped so that a call / construction is told apart from a mere read.
const WRAP = new Set([
  'URL',
  'structuredClone',
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'CompressionStream',
  'DecompressionStream',
  'AbortController',
  'Blob',
  'Response',
  'Request',
  'Headers',
  'fetch',
  'MessageChannel',
  'DOMMatrix',
  'Path2D',
  'ImageData',
  'OffscreenCanvas',
  'Worker',
  'FinalizationRegistry',
  'WeakRef',
  'atob',
  'btoa',
  'EventTarget',
  'Event',
  'TextEncoder',
  'ByteLengthQueuingStrategy',
  'CountQueuingStrategy',
  'FileReader',
  'createImageBitmap',
  'XMLHttpRequest',
]);
let armed = false;
const wrapFn = (name, value) =>
  new Proxy(value, {
    construct(t, args, nt) {
      if (armed) count(`new ${name}`);
      return Reflect.construct(t, args, nt === undefined ? t : nt);
    },
    apply(t, self, args) {
      if (armed) count(`${name}()`);
      return Reflect.apply(t, self, args);
    },
    get(t, key, _recv) {
      const v = Reflect.get(t, key, t);
      if (
        armed &&
        typeof key === 'string' &&
        typeof v === 'function' &&
        Object.hasOwn(t, key) &&
        key !== 'prototype'
      )
        count(`${name}.${key} (read)`);
      return v;
    },
  });
for (const name of WEB) {
  const d = Object.getOwnPropertyDescriptor(globalThis, name);
  if (!d) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        if (armed) note(globals, `${name} (absent in Node too)`);
        return undefined;
      },
      set(v) {
        if (armed) count(`globalThis.${name} = … (defined by the library)`);
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: v });
      },
    });
    continue;
  }
  let value = d.get ? d.get.call(globalThis) : d.value;
  if (WRAP.has(name) && typeof value === 'function') value = wrapFn(name, value);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      if (armed) note(globals, name);
      return value;
    },
    set(v) {
      if (armed) count(`globalThis.${name} = … (replaced by the library)`);
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: v });
    },
  });
}
// WebAssembly entry points, newer JS statics, static URL members.
for (const [obj, label, names] of [
  [
    WebAssembly,
    'WebAssembly',
    [
      'instantiate',
      'instantiateStreaming',
      'compile',
      'compileStreaming',
      'validate',
      'Module',
      'Instance',
      'Memory',
      'Table',
    ],
  ],
  [Promise, 'Promise', ['withResolvers', 'try']],
  [Array, 'Array', ['fromAsync']],
  [Uint8Array, 'Uint8Array', ['fromBase64', 'fromHex']],
  [Uint8Array.prototype, 'Uint8Array.prototype', ['toBase64', 'toHex']],
  [Math, 'Math', ['sumPrecise']],
  [Object, 'Object', ['groupBy']],
]) {
  for (const n of names) {
    const d = Object.getOwnPropertyDescriptor(obj, n);
    if (!d || typeof d.value !== 'function') {
      if (!d)
        Object.defineProperty(obj, n, {
          configurable: true,
          get() {
            if (armed) note(globals, `${label}.${n} (absent in Node too)`);
            return undefined;
          },
          set(v) {
            Object.defineProperty(obj, n, { configurable: true, writable: true, value: v });
          },
        });
      continue;
    }
    const orig = d.value;
    const wrapped = new Proxy(orig, {
      construct(t, a, nt) {
        if (armed) count(`new ${label}.${n}`);
        return Reflect.construct(t, a, nt === undefined ? t : nt);
      },
      apply(t, self, a) {
        if (armed) count(`${label}.${n}()`);
        return Reflect.apply(t, self === wrapped ? t : self, a);
      },
    });
    Object.defineProperty(obj, n, { ...d, value: wrapped });
  }
}
const labels = new Set();
const TD = TextDecoder;
const tdDesc = Object.getOwnPropertyDescriptor(globalThis, 'TextDecoder');
const Wrapped = class TextDecoder extends TD {
  constructor(label, o) {
    labels.add(
      `${String(label === undefined ? 'utf-8' : label).toLowerCase()}${o?.fatal ? ' fatal' : ''}`,
    );
    super(label, o);
  }
};
Object.defineProperty(globalThis, 'TextDecoder', {
  configurable: true,
  enumerable: tdDesc.enumerable,
  get() {
    if (armed) note(globals, 'TextDecoder');
    return Wrapped;
  },
  set(v) {
    Object.defineProperty(globalThis, 'TextDecoder', {
      configurable: true,
      writable: true,
      value: v,
    });
  },
});
armed = true;
process.on('exit', () => {
  armed = false;
  process.stderr.write(
    `TRACE ${JSON.stringify({ modules, esm, globals, used, textDecoderLabels: [...labels] })}\n`,
  );
});
