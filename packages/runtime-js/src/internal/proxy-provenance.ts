import type { ProxyProvenanceAuthority, ProxyProvenanceOwner } from './proxy-provenance-types.ts';
import { publishRuntimeGlobal, readRuntimeGlobal } from './worker-globals.ts';

function createOwner(): ProxyProvenanceOwner {
  const NativeProxy = Proxy;
  const apply = Reflect.apply;
  const construct = Reflect.construct;
  const define = Object.defineProperty;
  const descriptor = Object.getOwnPropertyDescriptor;
  const freeze = Object.freeze;
  const clone = structuredClone;
  const ErrorConstructor = Error;
  const add = WeakSet.prototype.add;
  const has = WeakSet.prototype.has;
  const get = WeakMap.prototype.get;
  const set = WeakMap.prototype.set;
  const proxies = new WeakSet<object>();
  const guestProxies = new WeakMap<object, () => string>();
  const originals = new WeakMap<object, object>();
  let sealed = false;
  let installed = false;

  const authority: ProxyProvenanceAuthority = freeze({
    Proxy: NativeProxy,
    cloneFailure(value: object): string | undefined {
      const guestFailure = apply(get, guestProxies, [value]) as (() => string) | undefined;
      if (guestFailure) return guestFailure();
      if (!apply(has, proxies, [value])) return undefined;
      try {
        clone(value);
      } catch (error) {
        if (error instanceof ErrorConstructor) {
          return error.message.replace(
            /^Failed to execute 'structuredClone' on '(?:WorkerGlobalScope|Window)': /,
            '',
          );
        }
        throw error;
      }
      throw new ErrorConstructor('tracked Proxy unexpectedly passed structuredClone');
    },
    markGuestProxy(wrapper: object, failure: () => string): void {
      apply(set, guestProxies, [wrapper, failure]);
    },
  });

  return freeze({
    acquireDuringBootstrap() {
      if (sealed) throw new ErrorConstructor('Proxy provenance bootstrap is sealed');
      return authority;
    },
    sealBootstrap() {
      sealed = true;
    },
    install() {
      if (installed) return;
      installed = true;
      const record = (value: object): object => {
        apply(add, proxies, [value]);
        return value;
      };
      const revocable = new NativeProxy(NativeProxy.revocable, {
        apply(target, receiver, args) {
          const result = apply(target, receiver, args) as { proxy: object; revoke: () => void };
          record(result.proxy);
          return result;
        },
      });
      const facade = new NativeProxy(NativeProxy, {
        construct(target, args, newTarget) {
          return record(construct(target, args, newTarget));
        },
      });
      const nativeToString = Function.prototype.toString;
      const toString = new NativeProxy(nativeToString, {
        apply(target, receiver, args) {
          return apply(target, apply(get, originals, [receiver]) ?? receiver, args);
        },
      });
      apply(set, originals, [facade, NativeProxy]);
      apply(set, originals, [revocable, NativeProxy.revocable]);
      apply(set, originals, [toString, nativeToString]);
      define(NativeProxy, 'revocable', {
        ...descriptor(NativeProxy, 'revocable'),
        value: revocable,
      });
      define(globalThis, 'Proxy', { ...descriptor(globalThis, 'Proxy'), value: facade });
      define(Function.prototype, 'toString', {
        ...descriptor(Function.prototype, 'toString'),
        value: toString,
      });
    },
  });
}

let owner = readRuntimeGlobal('proxyProvenance');
if (owner === null) {
  owner = createOwner();
  publishRuntimeGlobal('proxyProvenance', owner);
}
// Trusted duplicate bundles acquire before guest entry. No raw constructor or
// writable provenance authority remains obtainable after bootstrap (ADR-0453).
const authority = owner.acquireDuringBootstrap();
export const RuntimeProxy = authority.Proxy;
export const proxyCloneFailure = authority.cloneFailure;
export const markGuestProxy = authority.markGuestProxy;
export const installNodeProxyProvenance = owner.install;
export const sealNodeProxyBootstrap = owner.sealBootstrap;
