/** Node Fetch classes, one counted network source, and the streaming-Wasm ceiling (ADR-0541). */
import { NotImplementedError } from '@riftydev/io';
import { runtimeProxy } from '../internal/proxy-identity.ts';
import { installNodeFetch } from './fetch/install.ts';

interface FetchTarget {
  fetch?: typeof fetch;
  WebAssembly?: Pick<typeof WebAssembly, 'compileStreaming' | 'instantiateStreaming'>;
}

const WEBASSEMBLY_STREAMING_APIS = ['compileStreaming', 'instantiateStreaming'] as const;

/** Install once on the target before guest entry. */
export function installFetchKeepalive(target: FetchTarget = globalThis as FetchTarget): void {
  installWebAssemblyStreamingCeilings(target.WebAssembly);
  installNodeFetch(target);
}

/** Preserve effective property + name/length/own descriptors; close the realm loudly. */
function installWebAssemblyStreamingCeilings(namespace: FetchTarget['WebAssembly']): void {
  if (namespace === undefined) return;

  for (const name of WEBASSEMBLY_STREAMING_APIS) {
    const original = namespace[name];
    if (typeof original !== 'function') continue;
    const feature = `WebAssembly.${name}`;
    const ceiling = runtimeProxy(original, {
      apply() {
        return Promise.reject(new NotImplementedError(feature));
      },
    });
    const descriptor = findPropertyDescriptor(namespace, name);
    Object.defineProperty(namespace, name, {
      configurable: descriptor?.configurable ?? true,
      enumerable: descriptor?.enumerable ?? false,
      value: ceiling,
      writable: descriptor !== undefined && 'writable' in descriptor ? descriptor.writable : true,
    });
  }
}

function findPropertyDescriptor(target: object, key: PropertyKey): PropertyDescriptor | undefined {
  let owner: object | null = target;
  while (owner !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor !== undefined) return descriptor;
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return undefined;
}
