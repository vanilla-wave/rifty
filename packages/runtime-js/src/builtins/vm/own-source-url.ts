/**
 * The `sourceURL` a host-realm vm script names itself with (ADR-0450). V8
 * takes the last valid `//# sourceURL=` / `//@ sourceURL=` comment and rifty's
 * appended one would win, so V8 itself reads the guest code first: parsed as
 * the body of a never-called function (same tokens, same comments), named by
 * the frame of an error created before that body.
 */

import { NotImplementedError } from '@riftydev/io';

interface NamedSite {
  getScriptNameOrSourceURL(): unknown;
}

type Probe = (errorCtor: unknown) => { readonly stack?: unknown };

const HostFunction = Function;
const HostError = Error;
// A hashbang is legal only at script start and never a magic comment.
const HASHBANG = /^#![^\n\r\u2028\u2029]*/;

/** Frozen `Error` stack slots: neither the probe nor the ADR-0450 owner can run. */
export function frozenErrorGap(key: string): NotImplementedError {
  return new NotImplementedError('vm.runInThisContext.frozenError', `Error.${key} is locked`);
}

/** V8's name for `code` from its own magic comments, or `undefined`. */
export function ownSourceURL(code: string): string | undefined {
  // A magic comment spells `sourceURL` literally.
  if (!code.includes('sourceURL')) return undefined;
  let probe: Probe;
  try {
    probe = new HostFunction(
      'E',
      `return new E();function probe() {\n${code.replace(HASHBANG, '')}\n}`,
    ) as Probe;
  } catch {
    // Not a script: evaluating it throws its own SyntaxError.
    return undefined;
  }
  const limit = Object.getOwnPropertyDescriptor(HostError, 'stackTraceLimit');
  const hook = Object.getOwnPropertyDescriptor(HostError, 'prepareStackTrace');
  try {
    // Descriptors, not assignments: a guest accessor on either is never invoked.
    define('stackTraceLimit', { configurable: true, enumerable: true, value: 1, writable: true });
    define('prepareStackTrace', { configurable: true, value: captureName, writable: true });
    const name = probe(HostError).stack;
    return typeof name === 'string' && name !== '' ? name : undefined;
  } finally {
    restore('stackTraceLimit', limit);
    restore('prepareStackTrace', hook);
  }
}

function captureName(_error: unknown, sites: readonly NamedSite[]): unknown {
  return sites[0]?.getScriptNameOrSourceURL();
}

function define(key: string, descriptor: PropertyDescriptor): void {
  if (!Reflect.defineProperty(HostError, key, descriptor)) throw frozenErrorGap(key);
}

function restore(key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Reflect.defineProperty(HostError, key, descriptor);
  else Reflect.deleteProperty(HostError, key);
}
