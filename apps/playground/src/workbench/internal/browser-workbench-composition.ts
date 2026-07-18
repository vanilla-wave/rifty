import { type OpenWorkbenchDependencies, createOpenWorkbench } from '../open-workbench.ts';
import { createBrowserWorkbenchOwnerPort } from '../workbench-browser-owner.ts';
import type { WorkbenchOwnerPort } from '../workbench-owner-port.ts';

export interface BrowserWorkbenchCompositionOptions {
  readonly owner?: WorkbenchOwnerPort;
  readonly urlContext?: () => { readonly apiBaseUrl: string; readonly clientUrl: string };
  readonly openOwnerProject?: OpenWorkbenchDependencies['openOwnerProject'];
}

/** Generic browser effects; internal companions may inject one owner and URL context. */
export function createBrowserOpenWorkbench(options: BrowserWorkbenchCompositionOptions = {}) {
  const owner = options.owner ?? createBrowserWorkbenchOwnerPort();
  return createOpenWorkbench({
    urlContext:
      options.urlContext ??
      (() => ({
        apiBaseUrl: globalThis.document.baseURI,
        clientUrl: globalThis.location.href,
      })),
    capabilities: () => ({
      dom: typeof globalThis.document === 'object',
      worker: typeof globalThis.Worker === 'function',
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      webLocks: typeof globalThis.navigator?.locks?.request === 'function',
    }),
    locks: {
      request: async (name, lockOptions, callback) => {
        await globalThis.navigator.locks.request<void>(name, lockOptions, (lock) => {
          if (lock === null) return callback(null);
          return callback({ name: lock.name, mode: 'exclusive' });
        });
      },
    },
    serviceWorker: {
      register: async (url, registrationOptions) => {
        await globalThis.navigator.serviceWorker.register(url, registrationOptions);
      },
      get controller() {
        return globalThis.navigator.serviceWorker.controller;
      },
      addEventListener: (type, listener) =>
        globalThis.navigator.serviceWorker.addEventListener(type, listener),
      removeEventListener: (type, listener) =>
        globalThis.navigator.serviceWorker.removeEventListener(type, listener),
    },
    owner,
    ...(options.openOwnerProject === undefined
      ? {}
      : { openOwnerProject: options.openOwnerProject }),
    timers: {
      setTimeout: (callback, delayMs) => globalThis.window.setTimeout(callback, delayMs),
      clearTimeout: (timerId) => globalThis.window.clearTimeout(timerId),
    },
  } satisfies OpenWorkbenchDependencies);
}
