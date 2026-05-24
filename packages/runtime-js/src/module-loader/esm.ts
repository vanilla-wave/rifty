import { dirname } from '@rifty/vfs';
import { ModuleLoadError } from './errors.ts';
import { transformEsm } from './esm-ast.ts';
import type { ModuleRecord, ModuleRegistry } from './registry.ts';
import type { ResolvedModule, Resolver } from './resolver.ts';

export interface EsmLoaderDeps {
  readonly registry: ModuleRegistry;
  readonly resolver: Resolver;
  loadAsync(id: string): Promise<Record<string, unknown>>;
  resolve(specifier: string, fromFile: string, esm: boolean): ResolvedModule;
}

/**
 * Loads and executes an ESM module, populating its slot table and exports
 * namespace. The body is transformed by `transformEsm` (AST-based, see
 * ADR 0009) into a sequence of statements that, when wrapped in an async
 * arrow, populate the slot table via the helpers (`__import`, `__importStatic`,
 * `__slots`, `__rebuildExports`).
 */
export async function executeEsm(
  resolved: ResolvedModule,
  deps: EsmLoaderDeps,
): Promise<Record<string, unknown>> {
  const { registry } = deps;
  const existing = registry.get(resolved.id);
  if (existing && existing.state === 'loaded') return existing.exports;
  const record = existing ?? registry.getOrCreate(resolved.id, 'esm');

  if (resolved.kind === 'json') {
    const value = JSON.parse(resolved.source) as Record<string, unknown>;
    record.slots = { default: value, ...value };
    rebuildExports(record);
    record.state = 'loaded';
    return record.exports;
  }

  const transformed = transformEsm(resolved.source, resolved.id);
  // Stash by file path so multiple modules don't overwrite each other.
  const store = globalThis as unknown as { __riftyEsmStash?: Record<string, string> };
  store.__riftyEsmStash ??= {};
  store.__riftyEsmStash[resolved.id] = transformed.body;
  // Eagerly resolve all static imports before executing the body. This both
  // satisfies cycles (the dep's record is registered before our body runs) and
  // gives us deterministic load order.
  const importNamespaces = new Map<string, Record<string, unknown>>();
  for (const spec of transformed.staticImports) {
    const dep = deps.resolve(spec, resolved.id, true);
    const ns = await deps.loadAsync(dep.id);
    importNamespaces.set(spec, ns);
  }

  // Make sure the namespace is observable BEFORE the body runs (for cycles).
  rebuildExports(record);

  const __metaDirname = dirname(resolved.id);
  const __metaFilename = resolved.id;
  const __importMetaUrl = `file://${resolved.id}`;

  // ESM (unlike CJS) does NOT inject `__dirname` / `__filename` as
  // locals — Node only exposes them on `import.meta`. We previously did and
  // it collided with user code declaring its own `const __dirname` (e.g.
  // Vite's `dep-BK3b2jBa.js`). Keep `import_meta.{dirname,filename}` only.
  let factory: (
    importer: (s: string) => Promise<Record<string, unknown>>,
    importStatic: (s: string) => Record<string, unknown>,
    slots: Record<string, unknown>,
    resolveStatic: (s: string) => Record<string, unknown>,
    rebuildExports: () => void,
    __importMetaUrl: string,
    __metaDirname: string,
    __metaFilename: string,
  ) => Promise<void>;
  try {
    factory = new Function(
      '__import',
      '__importStatic',
      '__slots',
      '__resolveStatic',
      '__rebuildExports',
      '__importMetaUrl',
      '__metaDirname',
      '__metaFilename',
      `return (async () => {\nconst import_meta = { url: __importMetaUrl, dirname: __metaDirname, filename: __metaFilename, resolve: (s) => new URL(s, __importMetaUrl).href };\n${transformed.body}\n})();\n//# sourceURL=${resolved.id}`,
    ) as typeof factory;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    // Stash the body globally so we can pull it out of Playwright while
    // diagnosing transformer issues.
    (globalThis as unknown as Record<string, unknown>).__riftyLastEsmBody = transformed.body;
    (globalThis as unknown as Record<string, unknown>).__riftyLastEsmFile = resolved.id;
    const stack = (err as Error).stack ?? '';
    const m = /<anonymous>:(\d+):(\d+)/.exec(stack);
    const around = m
      ? snippetForBody(transformed.body, Number(m[1]), Number(m[2]))
      : `\n(no offset in stack; body length=${transformed.body.length}, stashed at globalThis.__riftyLastEsmBody)`;
    throw new ModuleLoadError(
      'SYNTAX_ERROR',
      resolved.id,
      `Failed to wrap transformed ESM body for ${resolved.id}: ${msg}${around}`,
      resolved.id,
    );
  }
  const importStatic = (spec: string): Record<string, unknown> => {
    const ns = importNamespaces.get(spec);
    if (!ns) {
      throw new ModuleLoadError(
        'MODULE_NOT_FOUND',
        spec,
        `Static import was not preloaded: ${spec}`,
        resolved.id,
      );
    }
    return ns;
  };

  const dynamicImport = async (spec: string): Promise<Record<string, unknown>> => {
    const dep = deps.resolve(spec, resolved.id, true);
    return deps.loadAsync(dep.id);
  };

  try {
    await factory(
      dynamicImport,
      importStatic,
      record.slots,
      importStatic,
      () => rebuildExports(record),
      __importMetaUrl,
      __metaDirname,
      __metaFilename,
    );
  } catch (err) {
    record.state = 'errored';
    throw err;
  }

  rebuildExports(record);
  record.state = 'loaded';
  return record.exports;
}

function snippetForBody(body: string, line: number, _col: number): string {
  // The wrapper preamble adds 2 lines before the body (the `return (async()=>{`
  // line and the `const import_meta = …` line). Subtract them to land in body.
  const bodyLine = line - 2;
  const lines = body.split('\n');
  const start = Math.max(0, bodyLine - 4);
  const end = Math.min(lines.length, bodyLine + 4);
  const numbered = lines
    .slice(start, end)
    .map((l, i) => {
      const n = start + i;
      const marker = n === bodyLine - 1 ? '>> ' : '   ';
      return `${marker}${String(n + 1).padStart(5, ' ')} | ${l.length > 200 ? `${l.slice(0, 200)}…` : l}`;
    })
    .join('\n');
  return `\nNear body line ${bodyLine}:\n${numbered}`;
}

/**
 * Recreate the `exports` object on a record from its slot table. ESM-style
 * exports are getter-backed so re-exports remain live.
 */
export function rebuildExports(record: ModuleRecord): void {
  const ns: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(record.slots)) {
    Object.defineProperty(ns, key, {
      configurable: true,
      enumerable: true,
      get: () => record.slots[key],
    });
  }
  Object.defineProperty(ns, Symbol.toStringTag, { value: 'Module' });
  record.exports = ns;
}
