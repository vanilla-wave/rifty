/**
 * Inputs of Node v24.16.0's generated legacy `url`/`querystring` (ADR-0574 §2–§5): `primordials`
 * (captured at load), Node's error classes and validators, the active process, `toASCII`,
 * `isInsideNodeModules` (constant, below), `bindingUrl.format`. Everything else is upstream's text. Error message
 * building and `bindingUrl.format` still call live intrinsics
 * (`backlog/runtime-js/post-guest-paths-use-replaceable-intrinsics`).
 */
import { NotImplementedError } from '@riftydev/io';
import { invalidArgTypeMessage } from '../../internal/node-received.ts';
import { URLConstructor } from '../../internal/posix-file-url.ts';
import bufferModule from '../buffer.ts';
import { publicNodeProcess } from '../process-public.ts';
import createUrlLegacy from './generated/legacy.js';
import { createToASCII, nativeHostOf } from './to-ascii.ts';

type Fn = (...args: never[]) => unknown;
const apply = Reflect.apply;
const uncurry =
  <T extends Fn>(f: T) =>
  (self: unknown, ...args: Parameters<T>): ReturnType<T> =>
    apply(f, self, args) as ReturnType<T>;

const setProto = Set.prototype;
/** Node's `SafeSet`: a `Set` whose methods are the ones captured here. */
class SafeSet<T> extends Set<T> {}
for (const key of Reflect.ownKeys(setProto)) {
  if (key === 'constructor') continue;
  const desc = Reflect.getOwnPropertyDescriptor(setProto, key);
  if (desc) Reflect.defineProperty(SafeSet.prototype, key, desc);
}

const primordials = {
  Array,
  ArrayIsArray: Array.isArray,
  ArrayPrototypeJoin: uncurry(Array.prototype.join),
  Boolean,
  Int8Array,
  MathAbs: Math.abs,
  NumberIsFinite: Number.isFinite,
  NumberPrototypeToString: uncurry(Number.prototype.toString),
  ObjectAssign: Object.assign,
  ObjectKeys: Object.keys,
  SafeSet,
  String,
  StringPrototypeAt: uncurry(String.prototype.at),
  StringPrototypeCharCodeAt: uncurry(String.prototype.charCodeAt),
  StringPrototypeIndexOf: uncurry(String.prototype.indexOf),
  StringPrototypeReplaceAll: uncurry(String.prototype.replaceAll),
  StringPrototypeSlice: uncurry(String.prototype.slice),
  StringPrototypeToUpperCase: uncurry(String.prototype.toUpperCase),
  decodeURIComponent,
};

/** Node's `makeNodeErrorWithCode` shape: own `code`, `constructor` → the base, coded `toString`. */
function nodeError<A extends unknown[]>(
  Base: TypeErrorConstructor | URIErrorConstructor,
  key: string,
  message: (self: Error, ...args: A) => string,
) {
  const Parent: ErrorConstructor = Base;
  return class NodeError extends Parent {
    code = key;
    constructor(...args: A) {
      super();
      Reflect.defineProperty(this, 'message', {
        value: message(this, ...args),
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
    // Node's NodeError: `constructor` reads the base. A class cannot name an accessor `constructor`.
    // biome-ignore lint/complexity/useLiteralKeys: see above
    override get ['constructor']() {
      return Base;
    }
    override toString(): string {
      return `${this.name} [${key}]: ${this.message}`;
    }
  };
}

const ERR_INVALID_ARG_TYPE = nodeError(
  TypeError,
  'ERR_INVALID_ARG_TYPE',
  (_: Error, name: string, expected: string | string[], actual: unknown) =>
    invalidArgTypeMessage(name, expected, actual),
);
const ERR_INVALID_URL = nodeError(
  TypeError,
  'ERR_INVALID_URL',
  (self, input: unknown, base?: unknown) => {
    Object.assign(self, { input });
    if (base != null) Object.assign(self, { base });
    return 'Invalid URL';
  },
);
const ERR_INVALID_URI = nodeError(URIError, 'ERR_INVALID_URI', () => 'URI malformed');

const validators = {
  validateString(value: unknown, name: string): void {
    if (typeof value !== 'string') throw new ERR_INVALID_ARG_TYPE(name, 'string', value);
  },
  /** Node's `validateObject` with its default options. */
  validateObject(value: unknown, name: string): void {
    if (value === null || Array.isArray(value) || typeof value !== 'object')
      throw new ERR_INVALID_ARG_TYPE(name, 'Object', value);
  },
};

/** `internal/util` `spliceOne`. */
function spliceOne(list: unknown[], index: number): void {
  for (let i = index; i + 1 < list.length; i++) list[i] = list[i + 1];
  list.pop();
}

/** No `URL` at load (isolate guest): no value is one. */
const NoURL = { [Symbol.hasInstance]: (): boolean => false };
/** The `URL` captured when the runtime loaded (`undefined` in the isolate guest) and its getters. */
const NativeURL = URLConstructor as typeof URL | undefined;
const getter = (name: string): ((this: URL) => string) | undefined =>
  NativeURL === undefined
    ? undefined
    : (Reflect.getOwnPropertyDescriptor(NativeURL.prototype, name)?.get as (this: URL) => string);
const hostnameOf = getter('hostname');
const usernameOf = getter('username');
const passwordOf = getter('password');
const read = (get: ((this: URL) => string) | undefined, url: URL): string =>
  get === undefined ? '' : (apply(get, url, []) as string);
const hostOf = nativeHostOf(NativeURL, hostnameOf);

/**
 * `bindingUrl.format(href, fragment, unicode, search, auth)` (ada, `format(URL, options)`):
 * `href` where no option changes it; otherwise the named gap (contract Acceptance 9).
 */
function formatURL(
  href: string,
  fragment: boolean,
  unicode: boolean,
  search: boolean,
  auth: boolean,
): string {
  const hash = href.indexOf('#');
  const beforeHash = hash === -1 ? href : href.slice(0, hash);
  let changes = (!fragment && hash !== -1) || (!search && beforeHash.includes('?'));
  if (!changes && NativeURL !== undefined && (!auth || unicode)) {
    const parsed = new NativeURL(href);
    if (!auth && (read(usernameOf, parsed) !== '' || read(passwordOf, parsed) !== ''))
      changes = true;
    if (unicode && /(?:^|\.)xn--/.test(read(hostnameOf, parsed))) changes = true;
  }
  if (changes)
    throw new NotImplementedError('url.format.options', 'an option that changes the href');
  return href;
}

/** The active process at call time: a guest's `process.emitWarning` patch is seen, as in Node. */
const processFacade = {
  get platform(): unknown {
    return (publicNodeProcess() as { platform?: unknown }).platform;
  },
  emitWarning(...args: unknown[]): unknown {
    const active = publicNodeProcess() as { emitWarning: (...a: unknown[]) => unknown };
    return apply(active.emitWarning, active, args);
  },
};

const BINDINGS: Readonly<Record<string, unknown>> = {
  encoding_binding: { toASCII: createToASCII(hostOf) },
  url: { format: formatURL },
  url_pattern: {},
  // Node walks the caller's stack to emit DEP0169 for code outside `node_modules`. rifty has no
  // such walk (removed, the user's choice 2026-11-24, ADR-0574): every caller counts as inside,
  // so `url.parse` never emits DEP0169 (declared, compat modules.md `node:url`).
  util: { isInsideNodeModules: () => true },
};
const MODULES: Readonly<Record<string, unknown>> = {
  buffer: bufferModule,
  'internal/errors': { codes: { ERR_INVALID_ARG_TYPE, ERR_INVALID_URL, ERR_INVALID_URI } },
  'internal/validators': validators,
  'internal/util': { spliceOne },
  // `url.js` reads only `URL` (`instanceof`); rifty's WHATWG members are composed in url.ts.
  'internal/url': { URL: NativeURL ?? NoURL },
};

function lookup(table: Readonly<Record<string, unknown>>, id: string): unknown {
  if (!Object.hasOwn(table, id)) throw new Error(`url-legacy: no binding for ${id}`);
  return table[id];
}

export const legacy = createUrlLegacy(
  primordials,
  (id) => lookup(BINDINGS, id),
  (id) => lookup(MODULES, id),
  processFacade,
);
