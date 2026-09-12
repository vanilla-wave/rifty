import { ModuleLoadError } from './errors.ts';

type TsconfigPaths = typeof import('./tsconfig-paths.ts');
let ready: TsconfigPaths | undefined;

/** Prepare opt-in synchronous discovery without adding compiler bytes to boot. */
export async function preloadTsconfigPaths(): Promise<void> {
  try {
    ready = await import('./tsconfig-paths.ts');
  } catch (cause) {
    throw new Error('TypeScript compiler chunk failed to load', { cause });
  }
}

export function requireTsconfigPaths(): TsconfigPaths {
  if (ready === undefined) {
    throw new ModuleLoadError(
      'TSCONFIG_NOT_READY',
      'autoDiscoverTsconfigPaths',
      'Call await preloadTsconfigPaths() before enabling autoDiscoverTsconfigPaths',
    );
  }
  return ready;
}
