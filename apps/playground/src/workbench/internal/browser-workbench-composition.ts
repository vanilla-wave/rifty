import {
  type OpenWorkbenchDependencies,
  type Workbench,
  createOpenWorkbench,
  inspectWorkbenchInternals,
} from '../open-workbench.ts';
import type { OpenPlaygroundWorkbench } from '../playground.ts';
import { createBrowserWorkbenchOwnerPort } from '../workbench-browser-owner.ts';
import type {
  WorkbenchOwnerPort,
  WorkbenchOwnerStartInput,
  WorkbenchOwnerStartResult,
} from '../workbench-owner-port.ts';
import { capturePlaygroundLegacyWorkspacePrefix } from './playground-boot-config.ts';
import { definePlaygroundProject } from './playground-project-definition.ts';
import {
  createOpenPlaygroundWorkbench,
  createPlaygroundWorkbenchFacade,
} from './playground-workbench.ts';

export interface BrowserWorkbenchCompositionOptions {
  readonly owner?: WorkbenchOwnerPort;
  readonly urlContext?: () => { readonly apiBaseUrl: string; readonly clientUrl: string };
  readonly openOwnerProject?: OpenWorkbenchDependencies['openOwnerProject'];
}

/** Shared browser effects; companion may inject one captured context and owner boot extension. */
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
    reload: () => globalThis.location.reload(),
    ...(options.openOwnerProject === undefined
      ? {}
      : { openOwnerProject: options.openOwnerProject }),
    timers: {
      setTimeout: (callback, delayMs) => globalThis.window.setTimeout(callback, delayMs),
      clearTimeout: (timerId) => globalThis.window.clearTimeout(timerId),
    },
  } satisfies OpenWorkbenchDependencies);
}

interface PendingPlaygroundBoot {
  readonly urlContext: { readonly apiBaseUrl: string; readonly clientUrl: string };
  readonly legacyWorkspacePrefix?: string;
}

function captureLegacyWorkspacePrefix(): string | undefined {
  try {
    return capturePlaygroundLegacyWorkspacePrefix(globalThis.sessionStorage);
  } catch {
    return undefined;
  }
}

/** First-party browser companion; one root claim and one physical owner. */
export function createBrowserOpenPlaygroundWorkbench(): OpenPlaygroundWorkbench {
  const browserOwner = createBrowserWorkbenchOwnerPort();
  let pendingBoot: PendingPlaygroundBoot | null = null;
  let admittedBoot: PendingPlaygroundBoot | null = null;

  const owner: WorkbenchOwnerPort = Object.freeze({
    start(input: WorkbenchOwnerStartInput): Promise<WorkbenchOwnerStartResult> {
      const boot = pendingBoot;
      if (boot === null) {
        return Promise.reject(new Error('Playground owner boot context is unavailable'));
      }
      pendingBoot = null;
      admittedBoot = boot;
      let starting: Promise<WorkbenchOwnerStartResult>;
      try {
        starting = browserOwner.start(
          Object.freeze({
            ...input,
            ...(boot.legacyWorkspacePrefix === undefined
              ? {}
              : { legacyWorkspacePrefix: boot.legacyWorkspacePrefix }),
            playgroundUrlContext: boot.urlContext,
          }),
        );
      } catch (error) {
        if (admittedBoot === boot) admittedBoot = null;
        return Promise.reject(error);
      }
      void starting.catch(() => {
        if (admittedBoot === boot) admittedBoot = null;
      });
      return starting;
    },
  });

  const openRoot = createBrowserOpenWorkbench({
    owner,
    urlContext: () => {
      if (pendingBoot === null) {
        throw new Error('Playground URL context is unavailable');
      }
      return pendingBoot.urlContext;
    },
    openOwnerProject: ({ owner: workbenchOwner, definition }) => {
      const playground = workbenchOwner.playground;
      if (playground === undefined) {
        return Promise.reject(new Error('Workbench owner omitted the Playground companion'));
      }
      return playground.openProject(definition);
    },
  });

  return createOpenPlaygroundWorkbench({
    captureUrlContext: () => ({
      apiBaseUrl: globalThis.document.baseURI,
      clientUrl: globalThis.location.href,
    }),
    openWorkbench(options, urlContext): Promise<Workbench> {
      if (pendingBoot !== null || admittedBoot !== null) {
        return Promise.reject(new Error('Workbench is busy: this page already has one open'));
      }
      const legacyWorkspacePrefix = captureLegacyWorkspacePrefix();
      const boot = Object.freeze({
        urlContext,
        ...(legacyWorkspacePrefix === undefined ? {} : { legacyWorkspacePrefix }),
      });
      pendingBoot = boot;
      const opening = openRoot(options);
      void opening.catch(() => {
        if (pendingBoot === boot) pendingBoot = null;
        if (admittedBoot === boot) admittedBoot = null;
      });
      return opening;
    },
    createFacade({ workbench, urlContext }) {
      const boot = admittedBoot;
      if (boot === null) throw new Error('Playground admitted boot context is unavailable');
      try {
        const internals = inspectWorkbenchInternals(workbench);
        const playground = internals.owner.playground;
        if (playground === undefined) {
          throw new Error('Workbench owner omitted the Playground companion');
        }
        const facade = createPlaygroundWorkbenchFacade({
          workbench,
          urlContext,
          ...(boot.legacyWorkspacePrefix === undefined
            ? {}
            : { legacyWorkspacePrefix: boot.legacyWorkspacePrefix }),
          definePlan: (plan) => definePlaygroundProject(plan, urlContext),
          catalog: playground.catalog,
          openProject: (definition, projectOptions) =>
            internals.openProjectWithOwner(definition, () =>
              playground.openProject(definition, projectOptions),
            ),
          createSessionTools: (session) => playground.sessionTools(session),
          registerBeforeClose: (session, hook) => internals.registerBeforeClose(session, hook),
        });
        return facade;
      } finally {
        if (admittedBoot === boot) admittedBoot = null;
      }
    },
  });
}
