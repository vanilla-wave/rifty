import { dirname } from '@rifty/vfs';
import { publishRuntimeGlobal, readRuntimeGlobal } from '../internal/worker-globals.ts';
import { ModuleLoadError } from './errors.ts';
import { transformEsm } from './esm-ast.ts';
import type { ModuleRecord, ModuleRegistry } from './registry.ts';
import type { ResolvedModule, Resolver } from './resolver.ts';

/**
 * Per-file source transform invoked for `.ts`/`.tsx`/`.jsx` modules on import,
 * BEFORE the AST ESM rewriter ({@link transformEsm}) parses them. The loader
 * itself carries no esbuild/runtime-wasi edge — the caller injects a closure
 * (typically wrapping `transformWithEsbuild` from `tools/shadow-registry`), the
 * same dependency-injection seam the WASI esbuild binding uses for `runWasi`
 * (ADR-0047/0049). The request shape is the load-bearing contract (ADR-0052 D1).
 *
 * @param req.source    the raw module source as read from the VFS
 * @param req.id        absolute resolved file path of the module
 * @param req.loader    esbuild loader derived purely from the file extension
 *                      (`.ts`->`'ts'`, `.tsx`->`'tsx'`, `.jsx`->`'jsx'`)
 * @param req.workspace esbuild guest cwd/preopen for the strip
 * @returns the stripped / lowered JavaScript that {@link transformEsm} parses
 */
export type TransformSourceHook = (req: {
  readonly source: string;
  readonly id: string;
  readonly loader: 'ts' | 'tsx' | 'jsx';
  readonly workspace: string;
}) => Promise<string>;

/**
 * Pick the esbuild loader purely from a file extension (ADR-0052 D3,
 * extension-only). Returns `null` for non-TS/JSX extensions, which leaves the
 * source untouched.
 */
function tsLoaderForId(id: string): 'ts' | 'tsx' | 'jsx' | null {
  if (id.endsWith('.tsx')) return 'tsx';
  if (id.endsWith('.ts')) return 'ts';
  if (id.endsWith('.jsx')) return 'jsx';
  return null;
}

export interface EsmLoaderDeps {
  readonly registry: ModuleRegistry;
  readonly resolver: Resolver;
  loadAsync(id: string): Promise<Record<string, unknown>>;
  resolve(specifier: string, fromFile: string, esm: boolean): ResolvedModule;
  /** esbuild guest cwd/preopen threaded through to {@link TransformSourceHook}. */
  readonly workspace: string;
  /** Injected per-file TS/JSX source transform; absent on plain-JS loaders. */
  readonly transformSource?: TransformSourceHook;
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

  // Strip TS types / lower JSX before the AST ESM rewriter parses the source.
  // The transform is injected (no esbuild/runtime-wasi edge in this package,
  // ADR-0052). When a `.ts`/`.tsx`/`.jsx` module is reached with NO hook
  // configured we throw a directed, honest error here rather than letting the
  // raw TS fall through to acorn (which dies with an opaque SYNTAX_ERROR) — no
  // silent stub (feature-02 T3).
  let source = resolved.source;
  const tsLoader = tsLoaderForId(resolved.id);
  if (tsLoader) {
    if (!deps.transformSource) {
      throw new ModuleLoadError(
        'SYNTAX_ERROR',
        resolved.id,
        `TS transform not configured for ${resolved.id}: the loader has no transformSource hook, so its .${tsLoader} syntax cannot be stripped before parsing. Inject a transformSource on createModuleLoader (ADR-0052).`,
        resolved.id,
      );
    }
    source = await deps.transformSource({
      source: resolved.source,
      id: resolved.id,
      loader: tsLoader,
      workspace: deps.workspace,
    });
  }

  const transformed = transformEsm(source, resolved.id);
  // Stash by file path so multiple modules don't overwrite each other. The
  // stash lives on the typed owner table at `__rifty.esmStash` — see
  // `internal/worker-globals.ts`.
  const stash: Record<string, string> = readRuntimeGlobal('esmStash') ?? {};
  stash[resolved.id] = transformed.body;
  publishRuntimeGlobal('esmStash', stash);
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
    // diagnosing transformer issues. Lives on the owner table — see
    // `internal/worker-globals.ts`.
    publishRuntimeGlobal('esmLastBody', transformed.body);
    publishRuntimeGlobal('esmLastFile', resolved.id);
    const stack = (err as Error).stack ?? '';
    const m = /<anonymous>:(\d+):(\d+)/.exec(stack);
    const around = m
      ? snippetForBody(transformed.body, Number(m[1]), Number(m[2]))
      : `\n(no offset in stack; body length=${transformed.body.length}, stashed at globalThis.__rifty.esmLastBody)`;
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
 * Recreate the `exports` namespace on a record from its slot table. ESM-style
 * exports are getter-backed so re-exports remain live.
 *
 * The namespace object is mutated IN PLACE (its identity is preserved), not
 * reallocated. A `export * as ns from SPEC` re-export captures the target
 * module's `exports` object identity at preload time — and for a
 * SELF-referential `export * as Self from "."` (a common opencode idiom, e.g.
 * `effect-drizzle-sqlite/index.ts`) that capture happens during the eager
 * static-import preload, BEFORE the module's first `rebuildExports` runs and
 * before its body has merged any `export * from "./sibling"` names. Reallocating
 * `record.exports` on each rebuild would leave that captured reference frozen as
 * the initial empty object, so the self-namespace would come back empty. By
 * reusing the same object and only (re)defining getters on it, the captured
 * reference stays live and reflects every later slot/star-merge — matching ESM's
 * single cached, live Module Namespace object (Node: `Self.Self === Self`, and
 * `Self` carries the module's full set of exports).
 */
export function rebuildExports(record: ModuleRecord): void {
  const ns = record.exports ?? Object.create(null);
  // Drop own keys no longer exported. Slots only grow within a single execution,
  // so this is defensive (a re-execute after `invalidate` could shrink them).
  // `Object.keys` skips the non-enumerable `Symbol.toStringTag`, so it survives.
  for (const key of Object.keys(ns)) delete ns[key];
  for (const key of Object.keys(record.slots)) {
    Object.defineProperty(ns, key, {
      configurable: true,
      enumerable: true,
      get: () => record.slots[key],
    });
  }
  // Define the tag once: it is non-configurable, so redefining it on the reused
  // object on a later rebuild would throw — guard against that.
  if (!Object.getOwnPropertyDescriptor(ns, Symbol.toStringTag)) {
    Object.defineProperty(ns, Symbol.toStringTag, { value: 'Module' });
  }
  record.exports = ns;
}
