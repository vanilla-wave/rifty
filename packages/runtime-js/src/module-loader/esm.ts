import { dirname } from '@riftydev/vfs';
import { ref as keepaliveRef, unref as keepaliveUnref } from '../internal/event-loop-keepalive.ts';
import { publishRuntimeGlobal, readRuntimeGlobal } from '../internal/worker-globals.ts';
import { ModuleLoadError } from './errors.ts';
import { RUNTIME_OBJECT_BINDING, type TransformResult, transformEsm } from './esm-ast.ts';
import type { ModuleRecord, ModuleRegistry } from './registry.ts';
import type { ResolvedModule, Resolver } from './resolver.ts';
import { type SourceMapRegistry, withStackRemapping } from './source-maps.ts';

/**
 * Per-file source transform for `.ts`/`.tsx`/`.jsx` modules, run BEFORE the AST
 * ESM rewriter ({@link transformEsm}) parses them. The loader carries no
 * esbuild/runtime-wasi edge — the caller injects a closure (typically wrapping
 * `transformWithEsbuild`), the same DI seam the WASI esbuild binding uses for
 * `runWasi` (ADR-0047/0049). Request shape is a load-bearing contract (ADR-0052 D1).
 *
 * @param req.source    raw module source from the VFS
 * @param req.id        absolute resolved file path
 * @param req.loader    esbuild loader, from file extension only
 * @param req.workspace esbuild guest cwd/preopen for the strip
 * @returns stripped/lowered JS that {@link transformEsm} parses
 */
export type TransformSourceHook = (req: {
  readonly source: string;
  readonly id: string;
  readonly loader: 'ts' | 'tsx' | 'jsx';
  readonly workspace: string;
}) => Promise<string>;

/**
 * esbuild loader from file extension only (ADR-0052 D3). `null` for non-TS/JSX,
 * leaving the source untouched.
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
  /**
   * Async load of an ALREADY-RESOLVED module — carries the resolved record so
   * the static-import preload / dynamic import skip a redundant re-resolve
   * (perf #14). `deps.resolve(...)` already returns the full {@link ResolvedModule}.
   */
  loadAsyncResolved(resolved: ResolvedModule): Promise<Record<string, unknown>>;
  resolve(specifier: string, fromFile: string, esm: boolean): ResolvedModule;
  /** esbuild guest cwd/preopen threaded through to {@link TransformSourceHook}. */
  readonly workspace: string;
  /** Internal transform sourcemap registry, keyed by resolved id. */
  readonly sourceMaps?: SourceMapRegistry;
  /** Injected per-file TS/JSX source transform; absent on plain-JS loaders. */
  readonly transformSource?: TransformSourceHook;
  /**
   * Injected ESM AST rewrite (acorn parse + walk). When absent, the direct
   * {@link transformEsm} import is used. The loader injects a cached wrapper so
   * the heaviest per-module CPU step is not re-run on a byte-identical re-load
   * (perf #16, TODO(backlog: perf/transformesm-result-cache)). Pure: same id+source -> same output.
   */
  readonly transformEsm?: (source: string, id: string) => TransformResult;
}

// V8 renders `new Function(args, body)` as `function anonymous(args\n) {\n<body>`
// — the module body starts 4 lines below the reported frame line. Coupled to
// the factory wrapper in `executeEsm`; wrong on non-V8 engines (we target
// Chromium, D-001). Remapping is active only while the module factory runs
// (top-level evaluation) — frames rendered later, e.g. an exported handler
// throwing at request time, stay unmapped.
// TODO(backlog: runtime-js/worker-stack-remap-error-overlay)
const ESM_STACK_LINE_OFFSET = 4;

/**
 * Loads and executes an ESM module, populating its slot table and exports
 * namespace. `transformEsm` (AST-based, ADR 0009) rewrites the body into
 * statements that, wrapped in an async arrow, populate the slot table via the
 * helpers (`__import`, `__importStatic`, `__slots`, `__rebuildExports`).
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

  // Strip TS / lower JSX before the AST rewriter parses. Transform is injected
  // (no esbuild/runtime-wasi edge here, ADR-0052). Reaching a TS/JSX module with
  // NO hook throws a directed error rather than letting raw TS fall through to
  // acorn (opaque SYNTAX_ERROR) — no silent stub (feature-02 T3).
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

  // Cached AST rewrite when the loader injected one (perf #16); the direct
  // import is the default so plain construction stays unchanged.
  const transformed = (deps.transformEsm ?? transformEsm)(source, resolved.id);
  deps.sourceMaps?.setGeneratedLineMap(resolved.id, transformed.lineMap);
  // Stash by file path so modules don't overwrite each other. Lives on the typed
  // owner table at `__rifty.esmStash` — see `internal/worker-globals.ts`.
  const stash: Record<string, string> = readRuntimeGlobal('esmStash') ?? {};
  stash[resolved.id] = transformed.body;
  publishRuntimeGlobal('esmStash', stash);
  // Eagerly resolve static imports before the body runs: satisfies cycles (dep's
  // record is registered first) and gives deterministic load order.
  const importNamespaces = new Map<string, Record<string, unknown>>();
  for (const spec of transformed.staticImports) {
    const dep = deps.resolve(spec, resolved.id, true);
    // Carry the resolved record — `loadAsyncResolved` skips re-resolving it (#14).
    const ns = await deps.loadAsyncResolved(dep);
    importNamespaces.set(spec, ns);
  }

  // Namespace must be observable BEFORE the body runs (cycles).
  rebuildExports(record);

  const __metaDirname = dirname(resolved.id);
  const __metaFilename = resolved.id;
  const __importMetaUrl = `file://${resolved.id}`;

  // ESM (unlike CJS) does NOT inject `__dirname`/`__filename` as locals — Node
  // exposes them only on `import.meta`. Injecting them collided with user code
  // declaring `const __dirname` (Vite's `dep-BK3b2jBa.js`). `import_meta` only.
  let factory: (
    importer: (s: string) => Promise<Record<string, unknown>>,
    importStatic: (s: string) => Record<string, unknown>,
    slots: Record<string, unknown>,
    resolveStatic: (s: string) => Record<string, unknown>,
    rebuildExports: () => void,
    __importMetaUrl: string,
    __metaDirname: string,
    __metaFilename: string,
    __assetPath: (s: string) => string,
    __metaResolve: (s: string) => string,
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
      '__assetPath',
      '__metaResolve',
      // Bind the genuine global `Object` to a mangled name at FUNCTION scope
      // (`new Function` body runs in global scope), outside the user-body arrow.
      // The generated body reaches its export `Object.defineProperty`/`Object.keys`
      // machinery through this binding (esm-ast.ts RUNTIME_OBJECT_BINDING), so a
      // module shadowing the global with `export const Object = …` (opencode's
      // config/permission.ts) can't break codegen. Kept on the `return` line so
      // body line numbering (snippetForBody) is unchanged.
      `const ${RUNTIME_OBJECT_BINDING} = Object; return (async () => {\nconst import_meta = { url: __importMetaUrl, dirname: __metaDirname, filename: __metaFilename, resolve: __metaResolve };\n${transformed.body}\n})();\n//# sourceURL=${resolved.id}`,
    ) as typeof factory;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    // Stash the body globally to pull it out of Playwright while diagnosing
    // transformer issues. Owner table — see `internal/worker-globals.ts`.
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

  // This is the routed dynamic import: a user-code `import()` rewritten to
  // `__import`. It MUST hold a keepalive ref while in flight, symmetric with
  // `loader.import` (loader.ts) — otherwise a detached `import('./x').then(run)`
  // whose load spans a macrotask (esbuild strip) lets the run-to-completion
  // realm drain to refCount 0 and reap before `run` arms its work → silent drop
  // (child-realm-async-lifecycle; review M2). `keepaliveRef()` runs synchronously
  // at call time (before the first await), so the ref is held the instant user
  // code invokes `import()`. finally unrefs on both resolve and reject.
  const dynamicImport = async (spec: string): Promise<Record<string, unknown>> => {
    keepaliveRef();
    try {
      const dep = deps.resolve(spec, resolved.id, true);
      // Carry the resolved record — `loadAsyncResolved` skips re-resolving it (#14).
      return await deps.loadAsyncResolved(dep);
    } finally {
      keepaliveUnref();
    }
  };

  // `with { type: "file" }` file loader (ADR-0068): resolve to absolute path
  // without loading as a module — the asset may be binary.
  const assetPath = (spec: string): string => deps.resolve(spec, resolved.id, true).id;

  // `import.meta.resolve(spec)` (Node v20.6, synchronous): real resolution via
  // the loader's resolver — replaces the inline `new URL(s, baseUrl).href` stub
  // that returned a WRONG `file://` URL for bare ('lodash') and `node:` specifiers.
  // node: builtins keep their `node:` id; files become `file://<abs>`; a genuine
  // miss propagates the resolver's MODULE_NOT_FOUND throw (Node throws
  // ERR_MODULE_NOT_FOUND). Feature ownership: process-module-loader-surface.
  const metaResolve = (spec: string): string => {
    // Node returns ANY `node:`-prefixed specifier VERBATIM from import.meta.resolve
    // without validating the builtin exists (existence is enforced only at import
    // time) — `import.meta.resolve('node:zlibbbb')` → `'node:zlibbbb'`. So don't
    // route `node:` through the resolver, which throws on an unregistered builtin.
    if (spec.startsWith('node:')) return spec;
    const dep = deps.resolve(spec, resolved.id, true);
    return dep.kind === 'builtin' ? dep.id : `file://${dep.id}`;
  };

  try {
    await withStackRemapping(deps.sourceMaps, resolved.id, ESM_STACK_LINE_OFFSET, () =>
      factory(
        dynamicImport,
        importStatic,
        record.slots,
        importStatic,
        () => rebuildExports(record),
        __importMetaUrl,
        __metaDirname,
        __metaFilename,
        assetPath,
        metaResolve,
      ),
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
 * Recreate the `exports` namespace from a record's slot table. Exports are
 * getter-backed so re-exports stay live.
 *
 * The namespace is mutated IN PLACE (identity preserved), never reallocated. A
 * `export * as ns from SPEC` captures the target's `exports` identity at preload
 * time; for self-referential `export * as Self from "."` (opencode idiom, e.g.
 * `effect-drizzle-sqlite/index.ts`) that capture happens during eager preload,
 * BEFORE the first `rebuildExports` and before the body merges any
 * `export * from "./sibling"` names. Reallocating `record.exports` each rebuild
 * would freeze that reference as the initial empty object, leaving the
 * self-namespace empty. Reusing the object and only (re)defining getters keeps
 * the captured reference live across every later slot/star-merge — matching ESM's
 * single cached, live Module Namespace (Node: `Self.Self === Self`, with `Self`
 * carrying the full export set).
 */
export function rebuildExports(record: ModuleRecord): void {
  const ns = record.exports ?? Object.create(null);
  // Drop own keys no longer exported. Defensive: slots only grow within one
  // execution, but a re-execute after `invalidate` could shrink them.
  // `Object.keys` skips the non-enumerable `Symbol.toStringTag`, so it survives.
  for (const key of Object.keys(ns)) delete ns[key];
  for (const key of Object.keys(record.slots)) {
    Object.defineProperty(ns, key, {
      configurable: true,
      enumerable: true,
      get: () => record.slots[key],
    });
  }
  // Define the tag once: non-configurable, so redefining it on a later rebuild
  // of the reused object would throw.
  if (!Object.getOwnPropertyDescriptor(ns, Symbol.toStringTag)) {
    Object.defineProperty(ns, Symbol.toStringTag, { value: 'Module' });
  }
  record.exports = ns;
}
