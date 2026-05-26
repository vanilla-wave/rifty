import { registerBuiltin } from '@rifty/io';
import assertModule, { AssertionError, strict as assertStrict } from './assert.ts';
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

registerBuiltin('path', () => pathModule as unknown as Record<string, unknown>);
registerBuiltin('events', () => {
  const exports = EventEmitter as unknown as Record<string, unknown>;
  exports.EventEmitter = EventEmitter;
  exports.once = eventsOnce;
  return exports;
});
registerBuiltin('util', () => utilModule as unknown as Record<string, unknown>);
registerBuiltin('querystring', () => querystringModule as unknown as Record<string, unknown>);
registerBuiltin('url', () => urlModule as unknown as Record<string, unknown>);
registerBuiltin('assert', () => assertModule as unknown as Record<string, unknown>);
registerBuiltin('assert/strict', () => assertStrict as unknown as Record<string, unknown>);
registerBuiltin('buffer', () => {
  const exports = { Buffer } as Record<string, unknown>;
  Object.assign(exports, bufferModule);
  return exports;
});
registerBuiltin('process', () => riftyProcess as unknown as Record<string, unknown>);
registerBuiltin('timers', () => {
  const exports = timersModule as unknown as Record<string, unknown>;
  exports.AssertionError = AssertionError; // suppress unused warning; harmless
  exports.AssertionError = undefined;
  return exports;
});
registerBuiltin('fs', () => fsModule as unknown as Record<string, unknown>);
registerBuiltin('fs/promises', () => fsPromises as unknown as Record<string, unknown>);
registerBuiltin('stream', () => streamModule as unknown as Record<string, unknown>);
registerBuiltin(
  'stream/promises',
  () =>
    ({
      pipeline: streamModule.pipeline,
      finished: streamModule.finished,
    }) as Record<string, unknown>,
);
registerBuiltin('child_process', () => childProcessModule as unknown as Record<string, unknown>);
registerBuiltin('worker_threads', () => workerThreadsModule as unknown as Record<string, unknown>);
registerBuiltin('os', () => osModule as unknown as Record<string, unknown>);
registerBuiltin('crypto', () => cryptoModule as unknown as Record<string, unknown>);
registerBuiltin('module', () => moduleModule as unknown as Record<string, unknown>);
registerBuiltin('perf_hooks', () => perfHooksModule as unknown as Record<string, unknown>);
registerBuiltin('tty', () => ttyModule as unknown as Record<string, unknown>);
registerBuiltin('string_decoder', () => stringDecoderModule as unknown as Record<string, unknown>);
registerBuiltin('dns', () => dns as unknown as Record<string, unknown>);
registerBuiltin('dns/promises', () => dns.promises as unknown as Record<string, unknown>);
registerBuiltin('tls', () => tls as unknown as Record<string, unknown>);
registerBuiltin('zlib', () => zlib as unknown as Record<string, unknown>);
registerBuiltin('readline', () => readline as unknown as Record<string, unknown>);
registerBuiltin('v8', () => v8 as unknown as Record<string, unknown>);
registerBuiltin('vm', () => vm as unknown as Record<string, unknown>);
registerBuiltin('async_hooks', () => async_hooks as unknown as Record<string, unknown>);
registerBuiltin('inspector', () => inspector as unknown as Record<string, unknown>);
registerBuiltin('repl', () => repl as unknown as Record<string, unknown>);
registerBuiltin('constants', () => nodeConstants as unknown as Record<string, unknown>);
registerBuiltin('punycode', () => punycode as unknown as Record<string, unknown>);
registerBuiltin('sys', () => sys as unknown as Record<string, unknown>);
registerBuiltin('cluster', () => cluster as unknown as Record<string, unknown>);
