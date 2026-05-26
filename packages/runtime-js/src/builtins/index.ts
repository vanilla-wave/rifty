import { registerBuiltin } from '@rifty/io';
import assertModule, { strict as assertStrict } from './assert.ts';
import bufferModule, { Buffer } from './buffer.ts';
import childProcessModule from './child_process.ts';
import cryptoModule from './crypto.ts';
/**
 * Registry of Node-compatible built-ins for our module loader.
 *
 * Each factory returns the CJS-shape `module.exports`. ESM imports go through
 * `wrapCjsAsEsmNamespace` in the loader, which adds `default` and named
 * bindings, so the same factory output works for both `require('node:path')`
 * and `import path from 'node:path'`.
 *
 * The registry implementation lives in `@rifty/io/builtin-registry.ts`
 * (ADR-0035). This barrel re-exports its public surface so internal
 * runtime-js callers (`module-loader/loader.ts`, `module-loader/resolver.ts`,
 * `builtins/module.ts`) and `src/index.ts`'s public re-exports continue to
 * use a single import path.
 */
import { EventEmitter, once as eventsOnce } from './events.ts';
import fsModule, { promises as fsPromises } from './fs.ts';
import {
  cluster,
  punycode,
  repl,
  sys,
  vm,
  async_hooks,
  inspector,
  constants as nodeConstants,
  v8,
} from './misc-stubs.ts';
import moduleModule from './module.ts';
import { dns, readline, tls, zlib } from './null-net-stubs.ts';
import osModule from './os.ts';
import pathModule from './path.ts';
import perfHooksModule from './perf_hooks.ts';
import { riftyProcess } from './process.ts';
import querystringModule from './querystring.ts';
import streamModule from './stream.ts';
import stringDecoderModule from './string_decoder.ts';
import timersModule from './timers.ts';
import ttyModule from './tty.ts';
import urlModule from './url.ts';
import utilModule from './util.ts';
import workerThreadsModule from './worker_threads.ts';

// Re-export the registry surface so existing consumers
// (`@rifty/runtime-js` public index, the module loader/resolver,
// `builtins/module.ts`) keep their import paths.
export {
  isBuiltinSpecifier,
  listBuiltins,
  loadBuiltin,
  registerBuiltin,
  type BuiltinFactory,
} from '@rifty/io';

registerBuiltin('path', () => pathModule);
registerBuiltin('events', () => {
  const exports = EventEmitter as unknown as Record<string, unknown>;
  exports.EventEmitter = EventEmitter;
  exports.once = eventsOnce;
  return exports;
});
registerBuiltin('util', () => utilModule);
registerBuiltin('querystring', () => querystringModule);
registerBuiltin('url', () => urlModule);
registerBuiltin('assert', () => assertModule);
registerBuiltin('assert/strict', () => assertStrict);
registerBuiltin('buffer', () => {
  const exports = { Buffer } as Record<string, unknown>;
  Object.assign(exports, bufferModule);
  return exports;
});
registerBuiltin('process', () => riftyProcess);
registerBuiltin('timers', () => timersModule);
registerBuiltin('fs', () => fsModule);
registerBuiltin('fs/promises', () => fsPromises);
registerBuiltin('stream', () => streamModule);
registerBuiltin('stream/promises', () => ({
  pipeline: streamModule.pipeline,
  finished: streamModule.finished,
}));
registerBuiltin('child_process', () => childProcessModule);
registerBuiltin('worker_threads', () => workerThreadsModule);
registerBuiltin('os', () => osModule);
registerBuiltin('crypto', () => cryptoModule);
registerBuiltin('module', () => moduleModule);
registerBuiltin('perf_hooks', () => perfHooksModule);
registerBuiltin('tty', () => ttyModule);
registerBuiltin('string_decoder', () => stringDecoderModule);
registerBuiltin('dns', () => dns);
registerBuiltin('dns/promises', () => dns.promises);
registerBuiltin('tls', () => tls);
registerBuiltin('zlib', () => zlib);
registerBuiltin('readline', () => readline);
registerBuiltin('v8', () => v8);
registerBuiltin('vm', () => vm);
registerBuiltin('async_hooks', () => async_hooks);
registerBuiltin('inspector', () => inspector);
registerBuiltin('repl', () => repl);
registerBuiltin('constants', () => nodeConstants);
registerBuiltin('punycode', () => punycode);
registerBuiltin('sys', () => sys);
registerBuiltin('cluster', () => cluster);
