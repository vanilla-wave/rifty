import type { ParityCase } from '../../src/types.ts';

// CJS twin of global-computed-key-writes-esm: undici 8.10.2 lib/global.js and
// lib/web/fetch/global.js shapes (Symbol.for const keys), plus runtime string
// and object keys through `global`/`globalThis`. Symbol.for names are prefixed
// and descriptors configurable so the in-process rifty side leaves the shared
// harness global as it found it.
const c: ParityCase = {
  setup: {
    files: {
      // undici/lib/global.js:5-6,20-50,57-59 (Agent reduced to a dispatch object).
      'undici-global.js': `
        'use strict'
        const globalDispatcher = Symbol.for('rifty-parity:undici.globalDispatcher.2')
        const legacyGlobalDispatcher = Symbol.for('rifty-parity:undici.globalDispatcher.1')
        let fallbackDispatcher
        function setGlobalDispatcher (agent) {
          if (!agent || typeof agent.dispatch !== 'function') {
            throw new TypeError('Argument agent must implement Agent')
          }
          try {
            Object.defineProperty(globalThis, globalDispatcher, {
              value: agent,
              writable: true,
              enumerable: false,
              configurable: true
            })
          } catch (err) {
            if (err instanceof TypeError) {
              fallbackDispatcher = agent
              return
            }
            throw err
          }
          Object.defineProperty(globalThis, legacyGlobalDispatcher, {
            value: { wrapped: agent },
            writable: true,
            enumerable: false,
            configurable: true
          })
        }
        function getGlobalDispatcher () {
          return globalThis[globalDispatcher] ?? fallbackDispatcher
        }
        module.exports = { globalDispatcher, legacyGlobalDispatcher, setGlobalDispatcher, getGlobalDispatcher }
      `,
      // undici/lib/web/fetch/global.js:5-35.
      'undici-fetch-global.js': `
        'use strict'
        const { URL } = require('node:url')
        const globalOrigin = Symbol.for('rifty-parity:undici.globalOrigin.1')
        function getGlobalOrigin () {
          return globalThis[globalOrigin]
        }
        function setGlobalOrigin (newOrigin) {
          if (newOrigin === undefined) {
            Object.defineProperty(globalThis, globalOrigin, {
              value: undefined,
              writable: true,
              enumerable: false,
              configurable: true
            })
            return
          }
          const parsedURL = new URL(newOrigin)
          if (parsedURL.protocol !== 'http:' && parsedURL.protocol !== 'https:') {
            throw new TypeError(\`Only http & https urls are allowed, received \${parsedURL.protocol}\`)
          }
          Object.defineProperty(globalThis, globalOrigin, {
            value: parsedURL,
            writable: true,
            enumerable: false,
            configurable: true
          })
        }
        module.exports = { globalOrigin, getGlobalOrigin, setGlobalOrigin }
      `,
      // Runtime keys through the CJS \`global\` binding: for-in and parameter keys.
      'dynamic-keys.js': `
        function setupDefines (defines) {
          for (const key in defines) global[key] = defines[key]
        }
        function stub (name, value) {
          Object.defineProperty(global, name, { value, writable: true, configurable: true, enumerable: true })
        }
        function unstub (name) {
          return Reflect.deleteProperty(global, name)
        }
        function removeGlobals (keys) {
          for (const key of keys) Reflect.deleteProperty(globalThis, key)
        }
        module.exports = { setupDefines, stub, unstub, removeGlobals }
      `,
      // Object keys: Node coerces the key once per property access, in its own order.
      'object-keys.js': `
        module.exports = function objectKeys () {
          const log = []
          const objectKey = { toString () { log.push('key'); return '__riftyParityCjsObjectKey__' } }
          const rhs = (value) => (log.push('rhs'), value)
          global[objectKey] = rhs(1)
          global[objectKey] += rhs(1)
          Object.defineProperty(global, objectKey, { get value () { log.push('desc'); return 3 }, configurable: true, writable: true })
          const entry = ['objectKey', log.join(','), global.__riftyParityCjsObjectKey__]
          delete global[objectKey]
          return entry
        }
      `,
    },
  },
  code: `
    const undici = require('./undici-global.js');
    const fetchGlobal = require('./undici-fetch-global.js');
    const dynamic = require('./dynamic-keys.js');
    const objectKeys = require('./object-keys.js');
    const out = [];

    const agent = { dispatch () { return true; } };
    undici.setGlobalDispatcher(agent);
    out.push(['dispatcher', undici.getGlobalDispatcher() === agent, globalThis[undici.legacyGlobalDispatcher].wrapped === agent]);
    fetchGlobal.setGlobalOrigin('http://localhost:3000/path');
    out.push(['origin', fetchGlobal.getGlobalOrigin().origin]);
    fetchGlobal.setGlobalOrigin(undefined);
    out.push(['originCleared', fetchGlobal.getGlobalOrigin(), Object.hasOwn(globalThis, fetchGlobal.globalOrigin)]);

    dynamic.setupDefines({ __RIFTY_PARITY_CJS_DEFINE__: 'cjs' });
    dynamic.stub('__riftyParityCjsStub__', 9);
    out.push(['dynamic', global.__RIFTY_PARITY_CJS_DEFINE__, global.__riftyParityCjsStub__, dynamic.unstub('__riftyParityCjsStub__'), Object.hasOwn(global, '__riftyParityCjsStub__')]);

    out.push(objectKeys());
    dynamic.removeGlobals([undici.globalDispatcher, undici.legacyGlobalDispatcher, fetchGlobal.globalOrigin, '__RIFTY_PARITY_CJS_DEFINE__']);
    out.push(['clean', Object.hasOwn(globalThis, undici.globalDispatcher), Object.hasOwn(global, '__RIFTY_PARITY_CJS_DEFINE__'), Object.hasOwn(global, '__riftyParityCjsObjectKey__')]);
    console.log(JSON.stringify(out));
  `,
};

export default c;
