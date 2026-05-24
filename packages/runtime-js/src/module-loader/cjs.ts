import { dirname } from '@rifty/vfs';
import { ModuleLoadError } from './errors.ts';
import type { ModuleRegistry } from './registry.ts';
import type { ResolvedModule } from './resolver.ts';
import type { Resolver } from './resolver.ts';

export interface CjsLoaderDeps {
  readonly registry: ModuleRegistry;
  readonly resolver: Resolver;
  /**
   * Load any module (CJS or ESM or JSON) by resolved id. Returns the module's
   * exports namespace. The CJS loader uses this to recursively load deps.
   *
   * CJS can only loadSync if the dep is itself CJS/JSON; importing ESM from
   * CJS requires `import()` (per Node).
   */
  loadSync(id: string): Record<string, unknown>;
  loadAsync(id: string): Promise<Record<string, unknown>>;
  resolve(specifier: string, fromFile: string, esm: boolean): ResolvedModule;
}

export function executeCjs(resolved: ResolvedModule, deps: CjsLoaderDeps): Record<string, unknown> {
  const { registry } = deps;
  const existing = registry.get(resolved.id);
  if (existing && existing.state === 'loaded') return existing.exports;
  // Cycle: re-entry while the module is still executing — give back the
  // half-populated exports object so the cyclic dep sees what's been set so far.
  if (existing && existing.state === 'loading') {
    return existing.cjsModule?.exports ?? existing.exports;
  }
  const record = existing ?? registry.getOrCreate(resolved.id, 'cjs');

  if (resolved.kind === 'json') {
    record.exports = JSON.parse(resolved.source) as Record<string, unknown>;
    record.cjsModule = { exports: record.exports };
    record.state = 'loaded';
    return record.exports;
  }

  // Half-populated module is visible to dependents that come back through
  // require during this module's execution (CJS cycle).
  const moduleObject: { exports: Record<string, unknown> } = { exports: Object.create(null) };
  record.cjsModule = moduleObject;
  record.exports = moduleObject.exports;

  const require = (specifier: string): unknown => {
    const dep = deps.resolve(specifier, resolved.id, false);
    if (dep.kind === 'esm') {
      throw new ModuleLoadError(
        'UNSUPPORTED_PROTOCOL',
        specifier,
        `require() of ES Module ${dep.id} from ${resolved.id} is not supported. Use dynamic import() instead.`,
        resolved.id,
      );
    }
    return deps.loadSync(dep.id);
  };
  require.resolve = (specifier: string): string => deps.resolve(specifier, resolved.id, false).id;

  const __filename = resolved.id;
  const __dirname = dirname(resolved.id);

  const fn = new Function(
    'module',
    'exports',
    'require',
    '__filename',
    '__dirname',
    `${resolved.source}\n//# sourceURL=${resolved.id}`,
  ) as (
    module: { exports: Record<string, unknown> },
    exports: Record<string, unknown>,
    require: (s: string) => unknown,
    __filename: string,
    __dirname: string,
  ) => void;

  try {
    fn(moduleObject, moduleObject.exports, require, __filename, __dirname);
  } catch (err) {
    record.state = 'errored';
    throw err;
  }

  // After execution, the module's real exports might have been reassigned
  // (`module.exports = ...`), so re-point the record.
  record.exports = moduleObject.exports;
  record.state = 'loaded';
  return moduleObject.exports;
}
