import { NotImplementedError } from '@riftydev/io';
import { dirname } from '@riftydev/vfs';
import { ModuleLoadError } from './errors.ts';
import type { ModuleRegistry } from './registry.ts';
import type { ResolvedModule } from './resolver.ts';
import type { Resolver } from './resolver.ts';

/**
 * Reject a `.ts`/`.tsx` that reached the CJS path with a directed
 * {@link NotImplementedError}, instead of feeding raw TS to `new Function`
 * (opaque `SyntaxError: Unexpected token`).
 *
 * The TS type-strip hook is async (esbuild-via-`runWasi`, ADR-0052 D1 alt-C);
 * synchronous `require()` cannot await it, so a `.ts`/`.tsx` in a
 * non-`type:module` scope is unsupported. In a `type:module` scope it loads as
 * ESM via `import()` where the async strip runs. Registered in
 * `docs/compat/modules.md` as not-supported.
 */
function assertNotTsCjs(id: string): void {
  if (id.endsWith('.ts') || id.endsWith('.tsx')) {
    throw new NotImplementedError(
      'module-loader.ts-via-require',
      `require() of ${id} (TypeScript) is not supported: the esbuild type-strip is async, so a synchronous require() cannot transform it. A .ts/.tsx is only loadable when its package scope is type:module (loads as ESM via import()).`,
    );
  }
}

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

/**
 * Best-effort source snippet for a `new Function` compile failure. A bare
 * SyntaxError often carries no `<anonymous>:line:col`; then returns '' (the
 * caller's directed error still names the module). When V8 gives an offset,
 * subtract the 2-line synthetic `function anonymous(...) {` header to map back
 * onto the source.
 */
function snippetForSource(source: string, stack: string): string {
  const m = /<anonymous>:(\d+):(\d+)/.exec(stack);
  if (!m) return '';
  const srcLine = Number(m[1]) - 2;
  const lines = source.split('\n');
  if (srcLine < 1 || srcLine > lines.length) return '';
  const start = Math.max(0, srcLine - 3);
  const end = Math.min(lines.length, srcLine + 2);
  const numbered = lines
    .slice(start, end)
    .map((l, i) => {
      const n = start + i + 1;
      const marker = n === srcLine ? '>> ' : '   ';
      return `${marker}${String(n).padStart(5, ' ')} | ${l.length > 200 ? `${l.slice(0, 200)}…` : l}`;
    })
    .join('\n');
  return `\nNear line ${srcLine}:\n${numbered}`;
}

export function executeCjs(resolved: ResolvedModule, deps: CjsLoaderDeps): Record<string, unknown> {
  // Guard BEFORE touching the registry so repeated require() calls throw
  // idempotently, not return a stale loading record (ADR-0052 D1 alt-C).
  if (resolved.kind !== 'json') assertNotTsCjs(resolved.id);

  const { registry } = deps;
  const existing = registry.get(resolved.id);
  if (existing && existing.state === 'loaded') return existing.exports;
  // Cycle: re-entry mid-execution — hand back the half-populated exports so
  // the cyclic dep sees what's been set so far.
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

  if (resolved.kind === 'text') {
    // Text-asset import (ADR-0067): the module value IS the raw file contents.
    // `require('./f.txt')` returns the string; ESM `import x from './f.txt'`
    // routes here, then `wrapCjsAsEsmNamespace` maps the non-object export to
    // `default`.
    record.exports = resolved.source as unknown as Record<string, unknown>;
    record.cjsModule = { exports: record.exports };
    record.state = 'loaded';
    return record.exports;
  }

  // Expose the half-populated exports so a CJS cycle re-entering via require()
  // during this module's execution sees it.
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

  type CjsFactory = (
    module: { exports: Record<string, unknown> },
    exports: Record<string, unknown>,
    require: (s: string) => unknown,
    __filename: string,
    __dirname: string,
  ) => void;
  let fn: CjsFactory;
  try {
    fn = new Function(
      'module',
      'exports',
      'require',
      '__filename',
      '__dirname',
      `${resolved.source}\n//# sourceURL=${resolved.id}`,
    ) as CjsFactory;
  } catch (err) {
    // `new Function` SyntaxError has no file context — surface a directed error
    // naming the module and offending line (mirrors the ESM path in esm.ts).
    record.state = 'errored';
    const msg = (err as Error).message ?? String(err);
    throw new ModuleLoadError(
      'SYNTAX_ERROR',
      resolved.id,
      `Failed to compile CJS module ${resolved.id}: ${msg}${snippetForSource(resolved.source, (err as Error).stack ?? '')}`,
      resolved.id,
    );
  }

  try {
    fn(moduleObject, moduleObject.exports, require, __filename, __dirname);
  } catch (err) {
    record.state = 'errored';
    throw err;
  }

  // Exports may have been reassigned (`module.exports = ...`); re-point.
  record.exports = moduleObject.exports;
  record.state = 'loaded';
  return moduleObject.exports;
}
