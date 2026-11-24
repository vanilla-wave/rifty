/**
 * Named gaps of the guest's builtin modules (ADR-0557 §6, 2026-11-24): a member
 * that needs what the host lacks (network, a compression engine, processes,
 * workers) keeps Node's name, length and kind and throws
 * `NotImplementedError('isolate-host.<feature>')` when called or constructed.
 */
import { NotImplementedError } from '@riftydev/io';

export const NO_NETWORK = 'no network in the rifty isolate host, ADR-0557';

/** Loud though Node's constructor opens nothing (unit Decisions, manager-confirmed (а)). */
export const NO_CONNECTION =
  "Node's HTTP message, server and socket objects are not in the rifty isolate host, ADR-0557";

export const gap = (feature: string, hint = NO_NETWORK): NotImplementedError =>
  new NotImplementedError(`isolate-host.${feature}`, hint);

/** Node's `name` (the bundler may rename a declaration). */
export function named<T extends object>(f: T, name: string, length?: number): T {
  Object.defineProperty(f, 'name', { value: name, configurable: true });
  if (length !== undefined)
    Object.defineProperty(f, 'length', { value: length, configurable: true });
  return f;
}

/** A plain function (with a `prototype`, as Node's declarations) that throws its gap. */
export function loudFunction(name: string, length: number, feature: string, hint?: string) {
  function loud(): never {
    throw gap(feature, hint);
  }
  return named(loud, name, length);
}

/** A loud static (Node's statics are methods: no `prototype`). */
export function loudMethod(name: string, length: number, feature: string, hint?: string) {
  const method = {
    [name](): never {
      throw gap(feature, hint);
    },
  }[name] as () => never;
  return named(method, name, length);
}

/** Anything with Node's constructor shape: a class, an ES5 constructor, `Stream`. */
export type Base = { readonly prototype: object };

/**
 * A constructor whose instance would carry what the host lacks: subclassable
 * (`class extends`, `util.inherits`), Node's prototype chain, and its
 * construction (or call) throws the gap. `es6`: Node declares it with `class`
 * (a call without `new` is V8's `TypeError`).
 */
export function loudClass(
  name: string,
  length: number,
  feature: string,
  base?: Base,
  hint?: string,
  es6 = false,
) {
  const C = es6
    ? named(
        class {
          constructor() {
            throw gap(feature, hint);
          }
        },
        name,
        length,
      )
    : loudFunction(name, length, feature, hint);
  if (base !== undefined) {
    Object.setPrototypeOf(C.prototype, base.prototype);
    Object.setPrototypeOf(C, base);
  }
  return C;
}

/** An `async` member (no `prototype`, as Node's): the gap is its rejection, as Node's errors are. */
export function loudAsync(name: string, length: number, feature: string, hint?: string) {
  return named(
    async (): Promise<never> => {
      throw gap(feature, hint);
    },
    name,
    length,
  );
}
