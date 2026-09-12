/**
 * Host options -> normalized owner input: the ONE validation authority for the
 * public `WorkbenchOptions` (and, by derivation, `PlaygroundWorkbenchOptions`).
 * Split out of open-workbench.ts under the file-size ratchet; keeping it whole
 * keeps a second, drifting option parser from appearing beside it.
 */
import { normalizePreviewPrefix } from '@riftydev/io';
import {
  DEFAULT_READY_TIMEOUT_MS,
  configurePreviewServiceWorkerUrl,
} from '@riftydev/service-worker';
import {
  type OwnerStorageConfig,
  type OwnerStoragePersistence,
  validateOwnerStorageNamespace,
} from '../../workers/owner-storage.ts';
import { MAX_NATIVE_TIMEOUT_MS } from '../owner-protocol-inspect.ts';
import type { WorkbenchOwnerStartInput } from '../workbench-owner-port.ts';
import {
  type WorkbenchPackageAcquisition,
  normalizeWorkbenchPackageAcquisition,
} from './workbench-package-acquisition.ts';

export type StoragePersistence = OwnerStoragePersistence;

export type NormalizedWorkbenchOwnerInput = WorkbenchOwnerStartInput;

export interface WorkbenchOptions {
  readonly deployment: {
    readonly workers: {
      readonly owner: string;
      readonly kernel: string;
      readonly node: string;
      readonly devServer: string;
    };
    readonly serviceWorker: {
      readonly url: string;
      readonly scope: string;
    };
    readonly wasm?: {
      /** Optional lazy SQLite asset; omission fails only when SQLite is used. */
      readonly sqlite?: string;
    };
    /** Preview pathname prefix within the SW scope; omission keeps /preview/. */
    readonly previewPrefix?: string;
    /**
     * Budget for service-worker control and, once a matching preview is
     * advertised, its routed HTTP proof. Does not bound install/start silence
     * before the first preview candidate.
     */
    readonly previewProbeTimeoutMs?: number;
    /**
     * ADR-0360: budget of owner `durability-progress` SILENCE per owner
     * operation, not total duration — a progress frame re-arms it. Unset =
     * the owner's shipped 60 000 ms.
     */
    readonly ownerOperationSilenceTimeoutMs?: number;
    /** Owner readiness/storage proof after SW admission; omission keeps 30,000 ms. */
    readonly ownerStartupTimeoutMs?: number;
    /** Post-applied file observation and durability ACK; omission keeps 60,000/35,000 ms. */
    readonly projectFileCommitTimeoutMs?: number;
    /** Non-TS Playground requests from send, after save admission; default 60,000 ms. */
    readonly playgroundRequestTimeoutMs?: number;
  };
  readonly packageAcquisition: WorkbenchPackageAcquisition;
  readonly storage: OwnerStorageConfig;
}

export interface ValidatedOptions {
  readonly serviceWorker: {
    readonly url: string;
    readonly scope: string;
  };
  readonly owner: Omit<NormalizedWorkbenchOwnerInput, 'storage'>;
  readonly storage: OwnerStorageConfig;
}

export interface ValidatedUrlContext {
  readonly apiBaseUrl: URL;
  readonly clientUrl: URL;
}

export function validateWorkbenchOptions(
  value: unknown,
  urlContext: ValidatedUrlContext,
): ValidatedOptions {
  const root = record(value, 'options');
  const deployment = record(root.deployment, 'deployment');
  const workers = record(deployment.workers, 'deployment.workers');
  const serviceWorker = record(deployment.serviceWorker, 'deployment.serviceWorker');
  const wasm = deployment.wasm === undefined ? {} : record(deployment.wasm, 'deployment.wasm');
  const packageAcquisition = normalizeWorkbenchPackageAcquisition(
    root.packageAcquisition,
    (value, field, pathBase) => httpEndpointUrl(value, field, urlContext.apiBaseUrl, { pathBase }),
  );
  const storage = record(root.storage, 'storage');

  const previewProbeTimeoutMs =
    timeoutBudget(deployment.previewProbeTimeoutMs, 'deployment.previewProbeTimeoutMs') ??
    DEFAULT_READY_TIMEOUT_MS;
  // Preserve absence: each existing owner retains its shipped default (ADR-0410).
  const ownerOperationSilenceTimeoutMs = timeoutBudget(
    deployment.ownerOperationSilenceTimeoutMs,
    'deployment.ownerOperationSilenceTimeoutMs',
  );
  const ownerStartupTimeoutMs = timeoutBudget(
    deployment.ownerStartupTimeoutMs,
    'deployment.ownerStartupTimeoutMs',
  );
  const projectFileCommitTimeoutMs = timeoutBudget(
    deployment.projectFileCommitTimeoutMs,
    'deployment.projectFileCommitTimeoutMs',
  );
  const playgroundRequestTimeoutMs = timeoutBudget(
    deployment.playgroundRequestTimeoutMs,
    'deployment.playgroundRequestTimeoutMs',
  );
  const ioOverrides = [
    ownerStartupTimeoutMs,
    projectFileCommitTimeoutMs,
    playgroundRequestTimeoutMs,
    ownerOperationSilenceTimeoutMs,
  ].filter((value): value is number => value !== undefined);
  const ioReportTimeoutMs = ioOverrides.length === 0 ? undefined : Math.max(...ioOverrides);

  const persistence = storage.persistence;
  if (persistence !== 'required' && persistence !== 'preferred' && persistence !== 'ephemeral') {
    throw new TypeError('storage.persistence must be required, preferred, or ephemeral');
  }
  const namespace = validateOwnerStorageNamespace(storage.namespace);

  const serviceWorkerUrl = riftyServiceWorkerUrl(
    serviceWorker.url,
    'deployment.serviceWorker.url',
    urlContext,
  );
  const serviceWorkerScope = riftyServiceWorkerUrl(
    serviceWorker.scope,
    'deployment.serviceWorker.scope',
    urlContext,
  );
  const clientUrl = new URL(urlContext.clientUrl.href);
  clientUrl.hash = '';
  if (!clientUrl.href.startsWith(serviceWorkerScope)) {
    throw new TypeError('deployment.serviceWorker.scope must contain the Workbench document URL');
  }
  const prefixValue = deployment.previewPrefix;
  const previewPrefix = prefixValue === undefined ? undefined : normalizePreviewPrefix(prefixValue);
  if (
    previewPrefix !== undefined &&
    !new URL(previewPrefix, clientUrl).href.startsWith(serviceWorkerScope)
  ) {
    throw new TypeError('deployment.previewPrefix must be within deployment.serviceWorker.scope');
  }

  return Object.freeze({
    serviceWorker: Object.freeze({
      url: configurePreviewServiceWorkerUrl(serviceWorkerUrl, previewPrefix),
      scope: serviceWorkerScope,
    }),
    owner: Object.freeze({
      deployment: Object.freeze({
        workers: Object.freeze({
          owner: isolatedWorkerUrl(workers.owner, 'deployment.workers.owner', urlContext),
          kernel: isolatedWorkerUrl(workers.kernel, 'deployment.workers.kernel', urlContext),
          node: isolatedWorkerUrl(workers.node, 'deployment.workers.node', urlContext),
          devServer: isolatedWorkerUrl(
            workers.devServer,
            'deployment.workers.devServer',
            urlContext,
          ),
          ...(workers.typescript === undefined
            ? {}
            : {
                typescript: isolatedWorkerUrl(
                  workers.typescript,
                  'deployment.workers.typescript',
                  urlContext,
                ),
              }),
        }),
        wasm: Object.freeze({
          ...(wasm.sqlite === undefined
            ? {}
            : { sqlite: wasmAssetUrl(wasm.sqlite, 'deployment.wasm.sqlite', urlContext) }),
        }),
        previewProbeTimeoutMs,
        ...(previewPrefix === undefined ? {} : { previewPrefix }),
        ...(ownerOperationSilenceTimeoutMs === undefined ? {} : { ownerOperationSilenceTimeoutMs }),
        ...(ownerStartupTimeoutMs === undefined ? {} : { ownerStartupTimeoutMs }),
        ...(projectFileCommitTimeoutMs === undefined ? {} : { projectFileCommitTimeoutMs }),
        ...(playgroundRequestTimeoutMs === undefined ? {} : { playgroundRequestTimeoutMs }),
        ...(ioReportTimeoutMs === undefined ? {} : { ioReportTimeoutMs }),
      }),
      packageAcquisition,
    }),
    storage: Object.freeze({
      persistence,
      ...(namespace === undefined ? {} : { namespace }),
    }),
  });
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

export function validateUrlContext(value: {
  readonly apiBaseUrl: string;
  readonly clientUrl: string;
}): ValidatedUrlContext {
  return Object.freeze({
    apiBaseUrl: absoluteHttpUrl(value.apiBaseUrl, 'Workbench document API base URL'),
    clientUrl: absoluteHttpUrl(value.clientUrl, 'Workbench document URL'),
  });
}

function absoluteHttpUrl(value: unknown, path: string): URL {
  const candidate = nonEmptyString(value, path);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new TypeError(`${path} must be an absolute HTTP(S) URL`);
  }
  if (!isHttp(url)) throw new TypeError(`${path} must be an absolute HTTP(S) URL`);
  return url;
}

function resolveUrlReference(value: unknown, path: string, baseUrl: URL): URL {
  const candidate = nonEmptyString(value, path);
  try {
    return new URL(candidate, baseUrl);
  } catch {
    throw new TypeError(`${path} must be a valid URL reference`);
  }
}

function isolatedWorkerUrl(value: unknown, path: string, context: ValidatedUrlContext): string {
  const url = resolveUrlReference(value, path, context.apiBaseUrl);
  const supportedScheme = isHttp(url) || url.protocol === 'blob:';
  if (!supportedScheme || url.origin !== context.clientUrl.origin) {
    throw new TypeError(`${path} must be a same-origin isolated Worker URL`);
  }
  return url.href;
}

function riftyServiceWorkerUrl(value: unknown, path: string, context: ValidatedUrlContext): string {
  const url = resolveUrlReference(value, path, context.apiBaseUrl);
  url.hash = '';
  if (!isHttp(url) || url.origin !== context.clientUrl.origin) {
    throw new TypeError(`${path} must be a same-origin HTTP(S) URL`);
  }
  if (/%2f|%5c/i.test(url.pathname)) {
    throw new TypeError(`${path} path must not contain encoded separators`);
  }
  return url.href;
}

function wasmAssetUrl(value: unknown, path: string, context: ValidatedUrlContext): string {
  const url = resolveUrlReference(value, path, context.apiBaseUrl);
  const supportedScheme = isHttp(url) || url.protocol === 'blob:' || url.protocol === 'data:';
  if (!supportedScheme) {
    throw new TypeError(`${path} must use an HTTP(S), blob, or data URL`);
  }
  if (isHttp(url)) assertPotentiallyTrustworthyNetworkUrl(url, path);
  if (url.protocol === 'blob:' && url.origin !== context.clientUrl.origin) {
    throw new TypeError(`${path} must use a same-origin blob URL`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new TypeError(`${path} must not include URL credentials`);
  }
  url.hash = '';
  return url.href;
}

function httpEndpointUrl(
  value: unknown,
  path: string,
  baseUrl: URL,
  options: { readonly pathBase: boolean },
): string {
  const url = resolveUrlReference(value, path, baseUrl);
  if (!isHttp(url)) throw new TypeError(`${path} must be an HTTP(S) URL`);
  assertPotentiallyTrustworthyNetworkUrl(url, path);
  if (url.username !== '' || url.password !== '') {
    throw new TypeError(`${path} must not include URL credentials`);
  }
  if (hasFragmentDelimiter(url)) {
    throw new TypeError(`${path} must not include a fragment`);
  }
  if (options.pathBase && hasQueryDelimiter(url)) {
    throw new TypeError(`${path} must not include a query`);
  }
  return url.href;
}

function isHttp(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function assertPotentiallyTrustworthyNetworkUrl(url: URL, path: string): void {
  if (url.protocol === 'https:' || isLoopbackHttpUrl(url)) return;
  throw new TypeError(`${path} must use HTTPS or a potentially trustworthy local HTTP origin`);
}

function isLoopbackHttpUrl(url: URL): boolean {
  if (url.protocol !== 'http:') return false;
  const hostname = url.hostname.toLowerCase();
  if (hostname === '[::1]') return true;
  if (
    hostname === 'localhost' ||
    hostname === 'localhost.' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.localhost.')
  ) {
    return true;
  }
  const ipv4 = hostname.split('.');
  return (
    ipv4.length === 4 &&
    ipv4[0] === '127' &&
    ipv4.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

function hasFragmentDelimiter(url: URL): boolean {
  return url.href.includes('#');
}

function hasQueryDelimiter(url: URL): boolean {
  const fragmentIndex = url.href.indexOf('#');
  const beforeFragment = fragmentIndex === -1 ? url.href : url.href.slice(0, fragmentIndex);
  return beforeFragment.includes('?');
}

function timeoutBudget(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive finite number`);
  }
  if (value > MAX_NATIVE_TIMEOUT_MS) {
    throw new TypeError(`${path} must be greater than 0 and at most ${MAX_NATIVE_TIMEOUT_MS}ms`);
  }
  return Math.ceil(value);
}
