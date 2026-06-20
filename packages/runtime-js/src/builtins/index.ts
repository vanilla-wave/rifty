import { registerBuiltin } from '@riftydev/io';
import assertModule, { strict as assertStrict } from './assert.ts';
import bufferModule from './buffer.ts';
import childProcessModule, { ensureExecSyncHandlerInstalled } from './child_process.ts';
import consoleModule from './console.ts';
import nodeConstants from './constants.ts';
import cryptoModule from './crypto.ts';
import diagnosticsChannelModule from './diagnostics_channel.ts';
/**
 * Registry of Node-compatible built-ins for our module loader.
 *
 * Each factory returns the CJS-shape `module.exports`. ESM imports go through
 * `wrapCjsAsEsmNamespace` in the loader, which adds `default` and named
 * bindings, so the same factory output works for both `require('node:path')`
 * and `import path from 'node:path'`.
 *
 * The registry implementation lives in `@riftydev/io/builtin-registry.ts`
 * (ADR-0035). This barrel re-exports its public surface so internal
 * runtime-js callers (`module-loader/loader.ts`, `module-loader/resolver.ts`,
 * `builtins/module.ts`) and `src/index.ts`'s public re-exports continue to
 * use a single import path.
 */
import { EventEmitter, once as eventsOnce } from './events.ts';
import fsModule, { promises as fsPromises } from './fs.ts';
import { cluster, punycode, repl, sys, async_hooks, inspector, v8 } from './misc-stubs.ts';
import moduleModule from './module.ts';
import { dgram, dns, readline, tls, http2 } from './null-net-stubs.ts';
import osModule from './os.ts';
import pathModule from './path.ts';
import perfHooksModule from './perf_hooks.ts';
import { NodeProcess, riftyProcess } from './process.ts';
import querystringModule from './querystring.ts';
import streamModule, { streamConsumers } from './stream.ts';
import stringDecoderModule from './string_decoder.ts';
import timersModule, { timersPromises } from './timers.ts';
import ttyModule from './tty.ts';
import urlModule from './url.ts';
import utilTypesModule from './util-types.ts';
import utilModule from './util.ts';
import vmModule from './vm/index.ts';
import wasiModule from './wasi.ts';
import workerThreadsModule from './worker_threads.ts';
import zlibModule from './zlib.ts';

// Re-export the registry surface so existing consumers
// (`@riftydev/runtime-js` public index, the module loader/resolver,
// `builtins/module.ts`) keep their import paths.
export {
  isBuiltinSpecifier,
  listBuiltins,
  loadBuiltin,
  registerBuiltin,
  type BuiltinFactory,
} from '@riftydev/io';

let runtimeJsBuiltinsRegistered = false;

export function ensureRuntimeJsBuiltinsRegistered(): void {
  if (runtimeJsBuiltinsRegistered) return;
  runtimeJsBuiltinsRegistered = true;

  registerBuiltin('path', () => pathModule);
  registerBuiltin('events', () => {
    const exports = EventEmitter as unknown as Record<string, unknown>;
    exports.EventEmitter = EventEmitter;
    exports.once = eventsOnce;
    return exports;
  });
  registerBuiltin('util', () => utilModule);
  registerBuiltin('util/types', () => utilTypesModule);
  registerBuiltin('querystring', () => querystringModule);
  registerBuiltin('url', () => urlModule);
  registerBuiltin('assert', () => assertModule);
  registerBuiltin('assert/strict', () => assertStrict);
  // Return the assembled module object directly (NOT Object.assign'd into a fresh
  // object) so the live `INSPECT_MAX_BYTES` getter/setter survives — copying it
  // would snapshot the getter's value and drop the setter.
  registerBuiltin('buffer', () => bufferModule);
  // `require('process')` returns the LIVE realm process (the spec-seeded one in a
  // kernel child, ADR-0157) so it === globalThis.process, like Node — but ONLY when
  // that is a rifty NodeProcess. In the in-process harness / parity runner
  // `globalThis.process` is the REAL Node process (wrong platform/arch), so fall
  // back to the rifty no-spec singleton there.
  registerBuiltin('process', () => {
    const live = (globalThis as { process?: unknown }).process;
    return live instanceof NodeProcess ? live : riftyProcess;
  });
  registerBuiltin('timers', () => timersModule);
  registerBuiltin('timers/promises', () => timersPromises);
  registerBuiltin('fs', () => fsModule);
  registerBuiltin('fs/promises', () => fsPromises);
  registerBuiltin('stream', () => streamModule);
  registerBuiltin('stream/promises', () => ({
    pipeline: streamModule.pipeline,
    finished: streamModule.finished,
  }));
  registerBuiltin('stream/consumers', () => streamConsumers);
  // #26 PART B: install the execSync SAB handler on first require, not at startup.
  registerBuiltin('child_process', () => {
    ensureExecSyncHandlerInstalled();
    return childProcessModule;
  });
  registerBuiltin('worker_threads', () => workerThreadsModule);
  registerBuiltin('os', () => osModule);
  registerBuiltin('crypto', () => cryptoModule);
  registerBuiltin('console', () => consoleModule);
  registerBuiltin('diagnostics_channel', () => diagnosticsChannelModule);
  registerBuiltin('module', () => moduleModule);
  registerBuiltin('perf_hooks', () => perfHooksModule);
  registerBuiltin('tty', () => ttyModule);
  registerBuiltin('string_decoder', () => stringDecoderModule);
  registerBuiltin('dns', () => dns);
  registerBuiltin('dns/promises', () => dns.promises);
  registerBuiltin('tls', () => tls);
  registerBuiltin('dgram', () => dgram);
  registerBuiltin('http2', () => http2);
  registerBuiltin('zlib', () => zlibModule);
  registerBuiltin('readline', () => readline);
  registerBuiltin('v8', () => v8);
  registerBuiltin('vm', () => vmModule);
  registerBuiltin('wasi', () => wasiModule);
  registerBuiltin('async_hooks', () => async_hooks);
  registerBuiltin('inspector', () => inspector);
  registerBuiltin('repl', () => repl);
  registerBuiltin('constants', () => nodeConstants);
  registerBuiltin('punycode', () => punycode);
  registerBuiltin('sys', () => sys);
  registerBuiltin('cluster', () => cluster);
}

ensureRuntimeJsBuiltinsRegistered();
