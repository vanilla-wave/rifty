/**
 * The `sourceURL` a host-realm vm script names itself with (ADR-0450). V8
 * takes the last valid `//# sourceURL=` / `//@ sourceURL=` comment and rifty's
 * appended one would win, so V8 itself reads the guest code first: parsed as
 * the body of a never-called function (same tokens, same comments), named by
 * the frame of an error created before that body. V8 skips a JS stack hook
 * while it formats a stack (vm called inside a hook or a formatter's getter,
 * overflow); the name then comes from V8's own rendering of that frame.
 */

import { NotImplementedError } from '@riftydev/io';

interface NamedSite {
  getScriptNameOrSourceURL(): unknown;
}

type Probe = (errorCtor: unknown) => object;

const HostFunction = Function;
const HostError = Error;
const HostSyntaxError = SyntaxError;
// A hashbang is legal only at script start and never a magic comment.
const HASHBANG = /^#![^\n\r\u2028\u2029]*/;
// V8's default rendering of the probe frame: its name, or (unnamed) its eval
// origin `eval at …` — never a name, names end at whitespace.
const RENDERED_PROBE = /^Error\n {4}at eval \((.*):3:8\)$/;

/** Set by {@link captureName}: V8 called the borrowed hook. */
let hookRan = false;

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
  } catch (error) {
    // Not a script: evaluating it throws its own SyntaxError.
    if (error instanceof HostSyntaxError) return undefined;
    throw error;
  }
  const limit = Object.getOwnPropertyDescriptor(HostError, 'stackTraceLimit');
  const hook = Object.getOwnPropertyDescriptor(HostError, 'prepareStackTrace');
  try {
    // Descriptors, not assignments: a guest accessor on either is never invoked.
    define('stackTraceLimit', { configurable: true, enumerable: true, value: 1, writable: true });
    define('prepareStackTrace', { configurable: true, value: captureName, writable: true });
    const error = probe(HostError);
    // Read by V8's own formatter: own data, never a guest accessor.
    Reflect.defineProperty(error, 'name', { value: 'Error' });
    Reflect.defineProperty(error, 'message', { value: '' });
    hookRan = false;
    const stack: unknown = Reflect.get(error, 'stack');
    const name = hookRan ? stack : renderedName(stack);
    return typeof name === 'string' && name !== '' ? name : undefined;
  } finally {
    restore('stackTraceLimit', limit);
    restore('prepareStackTrace', hook);
  }
}

function captureName(_error: unknown, sites: readonly NamedSite[]): unknown {
  hookRan = true;
  return sites[0]?.getScriptNameOrSourceURL();
}

function renderedName(stack: unknown): string | undefined {
  const location = typeof stack === 'string' ? RENDERED_PROBE.exec(stack)?.[1] : undefined;
  if (location === undefined) {
    throw new NotImplementedError(
      'vm.runInThisContext.ownSourceURL',
      `probe rendered ${String(stack)}`,
    );
  }
  return location.includes(' ') ? undefined : location;
}

function define(key: string, descriptor: PropertyDescriptor): void {
  if (!Reflect.defineProperty(HostError, key, descriptor)) throw frozenErrorGap(key);
}

function restore(key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Reflect.defineProperty(HostError, key, descriptor);
  else Reflect.deleteProperty(HostError, key);
}
