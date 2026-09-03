/**
 * Host options -> normalized owner input: the ONE validation authority for the
 * public `WorkbenchOptions` (and, by derivation, `PlaygroundWorkbenchOptions`).
 * Split out of open-workbench.ts under the file-size ratchet; keeping it whole
 * keeps a second, drifting option parser from appearing beside it.
 */
import { DEFAULT_READY_TIMEOUT_MS } from '@riftydev/service-worker';
import type { OwnerStoragePersistence } from '../../workers/owner-storage.ts';
import type { WorkbenchOwnerStartInput } from '../workbench-owner-port.ts';

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
    readonly wasm: {
      readonly sqlite: string;
    };
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
  };
  readonly packageAcquisition: {
    readonly registryUrl: string;
    readonly eddy?: {
      readonly resolverUrl: string;
      readonly bundleBaseUrl?: string;
      readonly presetPins?: Readonly<Record<string, string>>;
    };
  };
  readonly storage: {
    readonly persistence: StoragePersistence;
  };
}

export interface ValidatedOptions {
  readonly serviceWorker: {
    readonly url: string;
    readonly scope: string;
  };
  readonly owner: Omit<NormalizedWorkbenchOwnerInput, 'storage'>;
  readonly storage: StoragePersistence;
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
  const wasm = record(deployment.wasm, 'deployment.wasm');
  const acquisition = record(root.packageAcquisition, 'packageAcquisition');
  if (Reflect.ownKeys(acquisition).includes('snapshotUrl')) {
    throw new TypeError(
      'packageAcquisition.snapshotUrl is retired; trusted snapshots belong to Playground definitions',
    );
  }
  const storage = record(root.storage, 'storage');

  const timeoutValue = deployment.previewProbeTimeoutMs;
  const previewProbeTimeoutMs =
    timeoutValue === undefined
      ? DEFAULT_READY_TIMEOUT_MS
      : positiveFinite(timeoutValue, 'deployment.previewProbeTimeoutMs');

  // ADR-0360: same positive-finite authority as its preview-timeout sibling.
  // Left ABSENT when unset — the owner owns the one shipped default, so no
  // second copy of 60 000 ms can drift here.
  const silenceValue = deployment.ownerOperationSilenceTimeoutMs;
  const ownerOperationSilenceTimeoutMs =
    silenceValue === undefined
      ? undefined
      : positiveFinite(silenceValue, 'deployment.ownerOperationSilenceTimeoutMs');

  const eddyValue = acquisition.eddy;
  let eddy: NormalizedWorkbenchOwnerInput['packageAcquisition']['eddy'];
  if (eddyValue !== undefined) {
    const input = record(eddyValue, 'packageAcquisition.eddy');
    const hasExplicitBundleBase = input.bundleBaseUrl !== undefined;
    const resolverUrl = httpEndpointUrl(
      input.resolverUrl,
      'packageAcquisition.eddy.resolverUrl',
      urlContext.apiBaseUrl,
      { pathBase: !hasExplicitBundleBase },
    );
    const presetPins = stringMap(input.presetPins, 'packageAcquisition.eddy.presetPins');
    eddy = Object.freeze({
      resolverUrl,
      bundleBaseUrl: !hasExplicitBundleBase
        ? resolverUrl
        : httpEndpointUrl(
            input.bundleBaseUrl,
            'packageAcquisition.eddy.bundleBaseUrl',
            urlContext.apiBaseUrl,
            { pathBase: true },
          ),
      presetPins,
    });
  }

  const persistence = storage.persistence;
  if (persistence !== 'required' && persistence !== 'preferred' && persistence !== 'ephemeral') {
    throw new TypeError('storage.persistence must be required, preferred, or ephemeral');
  }

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

  return Object.freeze({
    serviceWorker: Object.freeze({
      url: serviceWorkerUrl,
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
          sqlite: wasmAssetUrl(wasm.sqlite, 'deployment.wasm.sqlite', urlContext),
        }),
        previewProbeTimeoutMs,
        ...(ownerOperationSilenceTimeoutMs === undefined ? {} : { ownerOperationSilenceTimeoutMs }),
      }),
      packageAcquisition: Object.freeze({
        registryUrl: httpEndpointUrl(
          acquisition.registryUrl,
          'packageAcquisition.registryUrl',
          urlContext.apiBaseUrl,
          { pathBase: true },
        ),
        ...(eddy === undefined ? {} : { eddy }),
      }),
    }),
    storage: persistence,
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

function positiveFinite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive finite number`);
  }
  return value;
}

function stringMap(value: unknown, path: string): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  const input = record(value, path);
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (key.length === 0 || typeof entry !== 'string' || entry.trim().length === 0) {
      throw new TypeError(`${path}.${key || '<empty>'} must be a non-empty string`);
    }
    Object.defineProperty(result, key, {
      value: entry,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return Object.freeze(result);
}
