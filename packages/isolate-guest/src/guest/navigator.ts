/**
 * Node 24's `navigator` / `Navigator` (`lib/internal/navigator.js`, v24.16.0):
 * same members, descriptors, brand checks and illegal constructor. Values are
 * the guest's identity — what its `process`, `os` and `Intl` report — never the
 * host's (ADR-0557 §5, 2026-11-24 line).
 */
import { NODE_PROCESS_IDENTITY } from '@riftydev/runtime-js/builtins/process-identity';
import { notImplemented } from './loud.ts';

const { version, platform, arch } = NODE_PROCESS_IDENTITY;
// Computed before guest code: Node uses its internal `nodeVersion`/`process` copies.
const USER_AGENT = `Node.js/${version.slice(1, version.indexOf('.'))}`;
// Node's `getNavigatorPlatform`: `'rifty'` takes its last branch (no named platform).
const PLATFORM = `${platform[0]?.toUpperCase()}${platform.slice(1)} ${arch}`;
/** One thread, no Workers (`worker_threads` is a ceiling); `os.availableParallelism()` reads it. */
const PARALLELISM = 1;
// Node reads ICU's default locale through a binding; this is V8's default, captured.
const DateTimeFormat = Intl.DateTimeFormat;
const resolvedOptions = DateTimeFormat.prototype.resolvedOptions;
const reflectApply = Reflect.apply;
const freeze = Object.freeze;
const INITIALIZE = Symbol('kInitialize');

class Navigator {
  // Private fields are Node's brand checks: a getter on another receiver throws naming them.
  #availableParallelism: number | undefined;
  #locks: undefined;
  #userAgent: string | undefined;
  #platform: string | undefined;
  #languages: readonly string[] | undefined;

  constructor(...args: unknown[]) {
    if (args[0] === INITIALIZE) return;
    throw Object.assign(new TypeError('Illegal constructor'), { code: 'ERR_ILLEGAL_CONSTRUCTOR' });
  }

  get hardwareConcurrency(): number {
    this.#availableParallelism ??= PARALLELISM;
    return this.#availableParallelism;
  }

  get locks(): never {
    void this.#locks;
    throw notImplemented(
      'isolate-host.navigator.locks',
      'not available in the rifty isolate host, ADR-0557',
    );
  }

  get language(): string {
    const options = reflectApply(resolvedOptions, new DateTimeFormat(), []) as { locale: string };
    return options.locale || 'en-US';
  }

  get languages(): readonly string[] {
    this.#languages ??= freeze([this.language]);
    return this.#languages;
  }

  get userAgent(): string {
    this.#userAgent ??= USER_AGENT;
    return this.#userAgent;
  }

  get platform(): string {
    this.#platform ??= PLATFORM;
    return this.#platform;
  }
}
for (const member of [
  'hardwareConcurrency',
  'locks',
  'language',
  'languages',
  'userAgent',
  'platform',
]) {
  Object.defineProperty(Navigator.prototype, member, { enumerable: true });
}

const navigator = new (Navigator as new (key: symbol) => Navigator)(INITIALIZE);
// Node's lazy global: an enumerable getter named `get navigator`, no setter.
const getter = Object.getOwnPropertyDescriptor(
  {
    get navigator() {
      return navigator;
    },
  },
  'navigator',
)?.get;

export function installNavigator(): void {
  Object.defineProperty(globalThis, 'Navigator', {
    value: Navigator,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    get: getter,
    enumerable: true,
    configurable: true,
  });
}
