import { validateRegistryUrl } from './glue/registry-fetch.ts';
import { validateWorkspaceId, validateWorkspaceRoot } from './glue/workspace-boundary.ts';
import {
  type WorkbenchProjectCatalog,
  type WorkbenchStarterFile,
  resolveProjectSpec,
  resolveStarter,
  validateProjectCatalog,
} from './project-catalog.ts';

export interface WorkbenchAssetUrls {
  readonly ownerWorkerUrl: string | URL;
  readonly kernelWorkerUrl: string | URL;
  readonly nodeWorkerUrl: string | URL;
  readonly devServerWorkerUrl: string | URL;
  readonly serviceWorkerUrl: string | URL;
  readonly sqliteWasmUrl: string | URL;
  readonly esbuildWasmUrl: string | URL;
}

export interface WorkbenchProjectConfig {
  readonly catalog: WorkbenchProjectCatalog;
  readonly templateId?: string;
  readonly starterId?: string;
  /** Optional caller files overlay the selected starter bundle. */
  readonly files?: readonly WorkbenchStarterFile[];
  readonly root?: string;
  readonly workspaceId?: string;
  readonly setup?: 'instant' | 'from-scratch';
}

export interface WorkbenchRegistryConfig {
  readonly registryUrl: string;
  readonly resolverUrl?: string;
  readonly resolverBundleUrl?: string;
  readonly resolverPins?: Readonly<Record<string, string>>;
}

export interface WorkbenchSessionConfig {
  readonly assets: WorkbenchAssetUrls;
  readonly registry: WorkbenchRegistryConfig;
  readonly project: WorkbenchProjectConfig;
  readonly serviceWorkerScope?: string;
  readonly previewProbeTimeoutMs?: number;
  readonly onLog?: (line: string) => void;
}

export interface ResolvedWorkbenchAssetUrls {
  readonly ownerWorkerUrl: string;
  readonly kernelWorkerUrl: string;
  readonly nodeWorkerUrl: string;
  readonly devServerWorkerUrl: string;
  readonly serviceWorkerUrl: string;
  readonly sqliteWasmUrl: string;
  readonly esbuildWasmUrl: string;
}

export interface ResolvedWorkbenchSessionConfig {
  readonly assets: ResolvedWorkbenchAssetUrls;
  readonly registry: WorkbenchRegistryConfig & { readonly registryUrl: string };
  readonly project: Required<
    Pick<
      WorkbenchProjectConfig,
      'catalog' | 'templateId' | 'starterId' | 'root' | 'workspaceId' | 'setup'
    >
  >;
  readonly serviceWorkerScope: string;
  readonly previewProbeTimeoutMs: number;
  readonly onLog: (line: string) => void;
}

function pageHref(): string {
  const href = (globalThis as { readonly location?: { readonly href?: string } }).location?.href;
  if (!href) throw new Error('@riftydev/workbench is browser-only: location is unavailable');
  return href;
}

function assetUrl(value: unknown, field: string, base: string): string {
  if (!(typeof value === 'string' || value instanceof URL)) {
    throw new TypeError(`workbench assets.${field} is required`);
  }
  const raw = String(value);
  if (raw.trim().length === 0) throw new TypeError(`workbench assets.${field} is required`);
  let parsed: URL;
  try {
    parsed = new URL(raw, base);
  } catch {
    throw new TypeError(`workbench assets.${field} is malformed: ${raw}`);
  }
  if (!['http:', 'https:', 'blob:'].includes(parsed.protocol)) {
    throw new TypeError(`workbench assets.${field} has unsupported protocol ${parsed.protocol}`);
  }
  return parsed.href;
}

function optionalHttpUrl(value: unknown, field: string, base: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`workbench registry.${field} must be a non-empty string`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value, base);
  } catch {
    throw new TypeError(`workbench registry.${field} is malformed: ${value}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError(`workbench registry.${field} must use http or https`);
  }
  return parsed.href.replace(/\/$/, '');
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function projectRoot(value: unknown): string {
  return validateWorkspaceRoot(value ?? '/workspace', 'workbench project.root');
}

function workspaceId(value: unknown): string {
  return validateWorkspaceId(value ?? randomWorkspaceId(), 'workbench project.workspaceId');
}

function projectSetup(value: unknown): 'instant' | 'from-scratch' {
  if (value === undefined) return 'from-scratch';
  if (value !== 'instant' && value !== 'from-scratch') {
    throw new TypeError("workbench project.setup must be 'instant' or 'from-scratch'");
  }
  return value;
}

function resolverPins(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('workbench registry.resolverPins must be an object');
  }
  const pins: Record<string, string> = {};
  for (const [key, pin] of Object.entries(value)) {
    if (key.length === 0 || typeof pin !== 'string' || pin.length === 0) {
      throw new TypeError(
        `workbench registry.resolverPins.${key || '<empty>'} must be a non-empty string`,
      );
    }
    pins[key] = pin;
  }
  return pins;
}

function resolvedServiceWorkerScope(value: unknown, base: string): string {
  const raw = value ?? '/';
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new TypeError('workbench serviceWorkerScope must be a non-empty string');
  }
  let scope: URL;
  try {
    scope = new URL(raw, base);
  } catch {
    throw new TypeError(`workbench serviceWorkerScope is malformed: ${raw}`);
  }
  if (scope.origin !== new URL(base).origin) {
    throw new TypeError('workbench serviceWorkerScope must be same-origin');
  }
  if (scope.search || scope.hash) {
    throw new TypeError('workbench serviceWorkerScope must not contain query or fragment');
  }
  if (!new URL(base).pathname.startsWith(scope.pathname)) {
    throw new TypeError('workbench serviceWorkerScope must contain the current page');
  }
  return scope.pathname;
}

function positiveTimeout(value: unknown): number {
  const timeout = value ?? 10_000;
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
    throw new TypeError('workbench previewProbeTimeoutMs must be a positive finite number');
  }
  return timeout;
}

function overlayStarterFiles(base: readonly WorkbenchStarterFile[], overlay: unknown): unknown {
  if (!Array.isArray(overlay)) return overlay;
  const merged: unknown[] = base.map((file) => ({ ...file }));
  const positions = new Map(
    base.map((file, index) => [file.path.replace(/^\/+/, ''), index] as const),
  );
  const overlayPaths = new Set<string>();
  for (const entry of overlay) {
    const record = asRecord(entry);
    const canonical = typeof record.path === 'string' ? record.path.replace(/^\/+/, '') : null;
    if (canonical === null) {
      merged.push(entry);
      continue;
    }
    if (overlayPaths.has(canonical)) {
      throw new TypeError(`workbench project.files has duplicate path ${canonical}`);
    }
    overlayPaths.add(canonical);
    const position = positions.get(canonical);
    if (position === undefined) {
      positions.set(canonical, merged.length);
      merged.push(entry);
    } else {
      merged[position] = entry;
    }
  }
  return merged;
}

function randomWorkspaceId(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return randomUUID();
  return `workbench-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function assertBrowserWorkbenchHost(): void {
  if (typeof (globalThis as { readonly document?: unknown }).document !== 'object') {
    throw new Error('@riftydev/workbench is browser-only: document is unavailable');
  }
  if (typeof (globalThis as { readonly Worker?: unknown }).Worker !== 'function') {
    throw new Error('@riftydev/workbench is browser-only: Worker is unavailable');
  }
}

export function resolveWorkbenchConfig(
  config: WorkbenchSessionConfig,
): ResolvedWorkbenchSessionConfig {
  assertBrowserWorkbenchHost();
  const base = pageHref();
  const input = asRecord(config);
  const assetsInput = asRecord(input.assets);
  const registryInput = asRecord(input.registry);
  const projectInput = asRecord(input.project);
  const catalog = validateProjectCatalog(projectInput.catalog);
  const starterId =
    projectInput.starterId === undefined
      ? catalog.defaultStarterId
      : String(projectInput.starterId);
  const baseStarter = resolveStarter(catalog, starterId);
  const templateId =
    projectInput.templateId === undefined
      ? baseStarter.templateId
      : String(projectInput.templateId);
  resolveProjectSpec(catalog, templateId);
  if (baseStarter.templateId !== templateId) {
    throw new TypeError(
      `workbench project starter ${starterId} belongs to ${baseStarter.templateId}, not ${templateId}`,
    );
  }
  const starters =
    projectInput.files !== undefined
      ? catalog.starters.map((starter) =>
          starter.id === starterId
            ? { ...starter, files: overlayStarterFiles(starter.files, projectInput.files) }
            : starter,
        )
      : catalog.starters;
  const resolvedCatalog = validateProjectCatalog({ ...catalog, starters });
  const registryUrl = validateRegistryUrl({
    registryUrl: registryInput.registryUrl as string,
    baseUrl: base,
  });
  const resolverUrl = optionalHttpUrl(registryInput.resolverUrl, 'resolverUrl', base);
  const resolverBundleUrl = optionalHttpUrl(
    registryInput.resolverBundleUrl,
    'resolverBundleUrl',
    base,
  );
  const pins = resolverPins(registryInput.resolverPins);
  const assets: ResolvedWorkbenchAssetUrls = {
    ownerWorkerUrl: assetUrl(assetsInput.ownerWorkerUrl, 'ownerWorkerUrl', base),
    kernelWorkerUrl: assetUrl(assetsInput.kernelWorkerUrl, 'kernelWorkerUrl', base),
    nodeWorkerUrl: assetUrl(assetsInput.nodeWorkerUrl, 'nodeWorkerUrl', base),
    devServerWorkerUrl: assetUrl(assetsInput.devServerWorkerUrl, 'devServerWorkerUrl', base),
    serviceWorkerUrl: assetUrl(assetsInput.serviceWorkerUrl, 'serviceWorkerUrl', base),
    sqliteWasmUrl: assetUrl(assetsInput.sqliteWasmUrl, 'sqliteWasmUrl', base),
    esbuildWasmUrl: assetUrl(assetsInput.esbuildWasmUrl, 'esbuildWasmUrl', base),
  };
  return {
    assets,
    registry: {
      registryUrl,
      ...(resolverUrl === undefined ? {} : { resolverUrl }),
      ...(resolverBundleUrl === undefined ? {} : { resolverBundleUrl }),
      ...(pins === undefined ? {} : { resolverPins: pins }),
    },
    project: {
      catalog: resolvedCatalog,
      templateId,
      starterId,
      root: projectRoot(projectInput.root),
      workspaceId: workspaceId(projectInput.workspaceId),
      setup: projectSetup(projectInput.setup),
    },
    serviceWorkerScope: resolvedServiceWorkerScope(input.serviceWorkerScope, base),
    previewProbeTimeoutMs: positiveTimeout(input.previewProbeTimeoutMs),
    onLog:
      input.onLog === undefined
        ? () => {}
        : typeof input.onLog === 'function'
          ? (input.onLog as (line: string) => void)
          : (() => {
              throw new TypeError('workbench onLog must be a function');
            })(),
  };
}
