import { createOpenWorkbench } from './open-workbench.ts';
import { createBrowserWorkbenchOwnerPort } from './workbench-browser-owner.ts';

export {
  ClosedHandleError,
  ProjectBusyError,
  ProjectDefinitionMismatchError,
  ProjectRunExitedBeforeReadyError,
  StdinClosedError,
} from './errors.ts';
export type {
  StoragePersistence,
  Workbench,
  WorkbenchOptions,
  WorkbenchSnapshot,
  WorkbenchStorageSnapshot,
} from './open-workbench.ts';
export type { PreviewHandle } from './preview-readiness.ts';
export { projects } from './project-definition.ts';
export type { ProjectRun, ProjectSession } from './project-session.ts';
export type {
  ProjectTerminal,
  ProjectTerminalRun,
} from './project-terminal.ts';

const owner = createBrowserWorkbenchOwnerPort();

/** Public browser composition; deployment assets remain explicit caller input. */
export const openWorkbench = createOpenWorkbench({
  urlContext: () => ({
    apiBaseUrl: globalThis.document.baseURI,
    clientUrl: globalThis.location.href,
  }),
  capabilities: () => ({
    dom: typeof globalThis.document === 'object',
    worker: typeof globalThis.Worker === 'function',
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    webLocks: typeof globalThis.navigator?.locks?.request === 'function',
  }),
  locks: {
    request: async (name, options, callback) => {
      await globalThis.navigator.locks.request<void>(name, options, (lock) => {
        if (lock === null) {
          return callback(null);
        }
        return callback({ name: lock.name, mode: 'exclusive' });
      });
    },
  },
  serviceWorker: {
    register: async (url, options) => {
      await globalThis.navigator.serviceWorker.register(url, options);
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
  timers: {
    setTimeout: (callback, delayMs) => globalThis.window.setTimeout(callback, delayMs),
    clearTimeout: (timerId) => globalThis.window.clearTimeout(timerId),
  },
});
