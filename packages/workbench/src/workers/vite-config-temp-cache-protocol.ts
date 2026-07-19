export const VITE_CONFIG_TEMP_CACHE_CAPABILITY = 'rifty.vite-config-temp-cache.v1';

export const VITE_CONFIG_TEMP_CACHE_METHODS = Object.freeze({
  scope: 'workbench.vite-config-temp-cache.scope',
  sourceRead: 'workbench.vite-config-temp-cache.source-read',
  mkdir: 'workbench.vite-config-temp-cache.mkdir',
  begin: 'workbench.vite-config-temp-cache.begin',
  write: 'workbench.vite-config-temp-cache.write',
  commit: 'workbench.vite-config-temp-cache.commit',
  inspect: 'workbench.vite-config-temp-cache.inspect',
  read: 'workbench.vite-config-temp-cache.read',
  remove: 'workbench.vite-config-temp-cache.remove',
  abort: 'workbench.vite-config-temp-cache.abort',
  retire: 'workbench.vite-config-temp-cache.retire',
});

export const VITE_CONFIG_TEMP_CACHE_GENERATION_CAPACITY = 8 * 1024 * 1024;

export const VITE_CONFIG_TEMP_CACHE_ADMISSION_TIMEOUT_MS = 10_000;

export const VITE_CONFIG_TEMP_CACHE_BINDING = '__riftyViteConfigTempFs';

export interface ViteConfigTempCacheAdmissionMessage {
  readonly type: 'workbench:vite-config-temp-cache-admission';
  readonly token: string;
}

export function inspectViteConfigTempCacheAdmissionMessage(
  value: unknown,
): ViteConfigTempCacheAdmissionMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Vite config temp-cache admission must be an object');
  }
  const record = value as Record<string, unknown>;
  if (
    record.type !== 'workbench:vite-config-temp-cache-admission' ||
    typeof record.token !== 'string' ||
    record.token.length === 0
  ) {
    throw new TypeError('Malformed Vite config temp-cache admission');
  }
  return Object.freeze({ type: record.type, token: record.token });
}
