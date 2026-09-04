import { NotImplementedError } from '@riftydev/io';
import { type FsSync, joinPath } from '@riftydev/vfs';
import { type Node as AcornNode, parse as acornParse } from 'acorn';
// TODO(backlog: runtime-js/lazy-typescript-tsconfig-discovery):
// share the lazy compiler boundary with eval-context detection.
import ts from 'typescript';
import { loadBuiltin } from '../builtins/index.ts';
import { __setCreateRequireImpl } from '../builtins/module.ts';
import { setSameRealmWorkerModuleImporter } from '../builtins/worker_threads.ts';
import { ref as keepaliveRef, unref as keepaliveUnref } from '../internal/event-loop-keepalive.ts';
import { sandboxToolchainWebAssembly } from '../internal/sandbox-toolchain-realm.ts';
import { createCjsInteropAuthority } from './cjs-interop-authority.ts';
import {
  type CjsExtensionHook,
  type CjsExtensions,
  type CjsRequire,
  executeCjs,
  initialiseDetachedCjsRecord,
} from './cjs.ts';
import { ModuleLoadError } from './errors.ts';
import { type TransformResult, transformEsm } from './esm-ast.ts';
import { type TransformSourceHook, executeEsm, requireEsm } from './esm-job.ts';
import { type CjsModule, ModuleRegistry, createModuleRecord } from './registry.ts';
import type { PathAliases, ResolvedModule } from './resolver.ts';
import { type Resolver, createResolver } from './resolver.ts';
import { SourceMapRegistry, extractInlineSourceMap } from './source-maps.ts';

export type { TransformSourceHook } from './esm-job.ts';
export type { PathAliases } from './resolver.ts';

export interface ModuleLoaderOptions {
  /** Working directory used when the caller passes a relative `entry` to `import`/`require`. */
  readonly cwd?: string;
  /**
   * Caller-defined transform root, passed as `workspace` to every
   * {@link TransformSourceHook} call. Defaults to {@link ModuleLoaderOptions.cwd}
   * (or the internal entry stub). A single root suffices: per-file transforms
   * do not resolve imports — rifty's resolver does (ADR-0052 D5).
   */
  readonly workspace?: string;
  /**
   * Per-file source transform for `.ts`/`.tsx`/`.jsx` (see {@link TransformSourceHook}).
   * When absent these still resolve (ADR-0053) but their TS syntax reaches the
   * AST rewriter unstripped; the transform-not-configured throw is feature-02 T3.
   */
  readonly transformSource?: TransformSourceHook;
  /**
   * tsconfig-style path aliases (ADR-0066), e.g. `{ "@/*": "/workspace/src/*" }`.
   * Targets are absolute VFS path patterns; when supplied, this explicit map wins
   * over auto-discovery.
   * Absent = Node-faithful resolution (bare `@/foo` is `MODULE_NOT_FOUND`).
   */
  readonly paths?: PathAliases;
  /**
   * Locate the nearest `tsconfig.json` and derive `compilerOptions.paths` via
   * TypeScript's parser (`extends`, JSONC, `baseUrl` included). Off by default
   * so vanilla Node-style resolution stays byte-stable.
   */
  readonly autoDiscoverTsconfigPaths?: boolean;
}

export interface ModuleLoader {
  /** Synchronous Node require, including fully synchronous plain-JS ESM graphs. */
  require(specifier: string, from?: string): unknown;
  /** Asynchronous import — works for both CJS and ESM. */
  import(specifier: string, from?: string): Promise<Record<string, unknown>>;
  /** Direct id-based loader (used by REPL and tests). */
  loadById(id: string, esm?: boolean): Promise<Record<string, unknown>>;
  /**
   * The coherent invalidation seam. Drops the module record, CJS import job,
   * id-keyed transform/AST caches, and resolver caches in lockstep, so a reload
   * re-resolves + re-transforms cleanly. No `id` wipes everything (the
   * `load-fixture` hot path uses this so loader + resolver survive editor saves);
   * an absolute `id` removes only that entry — the hook for HMR / per-file
   * updates. See {@link ModuleRegistry.invalidate} for the
   * single-entry-vs-dependency-graph contract (HMR callers MUST call THIS, not
   * `registry.invalidate`).
   */
  invalidate(id?: string): void;
  /**
   * WARNING: do NOT call `registry.invalidate(id)` for HMR — it drops only the
   * execution record, leaving import-job/transform/AST/resolver caches stale.
   * Use {@link ModuleLoader.invalidate} instead. Exposed for read access (e.g.
   * tests inspecting cached records).
   */
  readonly registry: ModuleRegistry;
  readonly resolver: Resolver;
}

const STUB_FROM_FILE_DEFAULT = '/__entry__';
// biome-ignore lint/security/noGlobalEval: exact unwrapped Node CLI eval seam.
const indirectEvalPrimordial = globalThis.eval;
const objectDefinePropertyPrimordial = Object.defineProperty;
const reflectApplyPrimordial = Reflect.apply;
const stringEndsWithPrimordial = String.prototype.endsWith;

function stringEndsWith(value: string, suffix: string): boolean {
  return reflectApplyPrimordial(stringEndsWithPrimordial, value, [suffix]) as boolean;
}

export interface NodeEvalScriptRunner {
  readonly registry: ModuleRegistry;
  run(source: string): unknown;
}

interface ModuleLoaderCore {
  readonly loader: ModuleLoader;
  runNodeEvalScript(source: string, explicitCommonJs: boolean): unknown;
}

interface AcornSyntaxFailure extends Error {
  readonly loc?: {
    readonly line: number;
    readonly column: number;
  };
  readonly pos?: number;
  readonly raisedAt?: number;
}

setSameRealmWorkerModuleImporter(async (vfs, script, cwd) => {
  const loader = createModuleLoader(vfs, { cwd });
  return loader.import(script, script);
});

/**
 * Load a `node:`-prefixed builtin or throw `MODULE_NOT_FOUND`. Shared by sync
 * and async paths; deliberately returns raw CJS-shaped exports — the async path
 * materialises the record-owned namespace at the call site.
 */
function loadBuiltinOrThrow(
  id: string,
  overrides?: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, unknown> {
  const builtin = overrides?.get(id) ?? loadBuiltin(id);
  if (!builtin) throw new ModuleLoadError('MODULE_NOT_FOUND', id, `Built-in '${id}' not found`);
  return builtin;
}

function parsesAsJavaScriptScript(source: string): boolean {
  try {
    acornParse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: false,
      allowReturnOutsideFunction: false,
      allowHashBang: true,
    });
    return true;
  } catch {
    return false;
  }
}

const TYPESCRIPT_ONLY_MODIFIERS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.DeclareKeyword,
  ts.SyntaxKind.AbstractKeyword,
  ts.SyntaxKind.ReadonlyKeyword,
  ts.SyntaxKind.PublicKeyword,
  ts.SyntaxKind.PrivateKeyword,
  ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.OverrideKeyword,
]);

function hasTypeScriptOnlySyntax(node: ts.Node): boolean {
  if (
    ts.isTypeNode(node) ||
    ts.isTypeParameterDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isImportEqualsDeclaration(node) ||
    ts.isNamespaceExportDeclaration(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeOnlyImportOrExportDeclaration(node) ||
    (ts.isExportAssignment(node) && node.isExportEquals) ||
    (ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ImplementsKeyword) ||
    (ts.isFunctionLike(node) && (!('body' in node) || node.body === undefined)) ||
    (ts.isVariableDeclaration(node) && node.exclamationToken !== undefined) ||
    (ts.isParameter(node) &&
      (node.questionToken !== undefined ||
        (ts.isIdentifier(node.name) && node.name.text === 'this'))) ||
    (ts.isPropertyDeclaration(node) &&
      (node.questionToken !== undefined || node.exclamationToken !== undefined)) ||
    (ts.isMethodDeclaration(node) && node.questionToken !== undefined)
  ) {
    return true;
  }
  if (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => TYPESCRIPT_ONLY_MODIFIERS.has(modifier.kind))
  ) {
    return true;
  }
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && hasTypeScriptOnlySyntax(child)) found = true;
  });
  return found;
}

function isAcornNode(value: unknown): value is AcornNode {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.type === 'string' &&
    typeof record.start === 'number' &&
    typeof record.end === 'number'
  );
}

function sourceOffset(source: string, line: number, column: number): number | null {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const newline = source.indexOf('\n', offset);
    if (newline === -1) return null;
    offset = newline + 1;
  }
  return offset + column;
}

function nodeEvalThrowLocation(
  source: string,
  frameLine: number,
  frameColumn: number,
): { readonly line: number; readonly column: number } | null {
  const position = sourceOffset(source, frameLine, frameColumn);
  if (position === null) return null;
  let root: AcornNode;
  try {
    root = acornParse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: false,
      allowReturnOutsideFunction: false,
      allowHashBang: true,
      locations: true,
    });
  } catch {
    return null;
  }
  let best: AcornNode | null = null;
  const pending: AcornNode[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) break;
    if (
      node.type === 'ThrowStatement' &&
      node.start <= position &&
      position < node.end &&
      (best === null || node.start > best.start)
    ) {
      best = node;
    }
    for (const value of Object.values(node as unknown as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isAcornNode(child)) pending.push(child);
        }
      } else if (isAcornNode(value)) {
        pending.push(value);
      }
    }
  }
  const start = best?.loc?.start;
  return start === undefined || start === null ? null : { line: start.line, column: start.column };
}

function nodeEvalConstBindingMarker(
  source: string,
  position: number,
): { readonly line: number; readonly column: number; readonly width: number } | null {
  const syntax = ts.createSourceFile(
    '[eval].ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const bindings: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.type !== undefined &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
      node.name.getEnd() <= position &&
      position <= node.type.getEnd()
    ) {
      bindings.push(node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  let binding = bindings[0];
  if (binding === undefined) return null;
  for (const candidate of bindings.slice(1)) {
    if (candidate.getStart(syntax) > binding.getStart(syntax)) binding = candidate;
  }
  const start = binding.getStart(syntax);
  const location = syntax.getLineAndCharacterOfPosition(start);
  return {
    line: location.line + 1,
    column: location.character,
    width: Math.max(1, binding.getEnd() - start),
  };
}

function nodeEvalSyntaxPrelude(source: string, error: SyntaxError): string | null {
  let parsed: AcornSyntaxFailure | null = null;
  try {
    acornParse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: false,
      allowReturnOutsideFunction: false,
      allowHashBang: true,
    });
  } catch (failure) {
    parsed = failure as AcornSyntaxFailure;
  }
  if (parsed === null) return null;
  let line = parsed?.loc?.line ?? 1;
  let column = parsed?.loc?.column ?? 0;
  let width = Math.max(1, (parsed?.raisedAt ?? column + 1) - (parsed?.pos ?? column));
  if (
    error.message === 'Missing initializer in const declaration' &&
    typeof parsed.pos === 'number'
  ) {
    const marker = nodeEvalConstBindingMarker(source, parsed.pos);
    if (marker !== null) {
      line = marker.line;
      column = marker.column;
      width = marker.width;
    }
  }
  const lineText = source.split('\n')[line - 1] ?? '';
  const explanation =
    error.message === 'Illegal return statement'
      ? 'Return statement is not allowed here\n'
      : error.message.startsWith('Unexpected token') && lineText[column] === ';'
        ? 'Expression expected\n'
        : '';
  return `[eval]:${line}\n${lineText}\n${' '.repeat(column)}${'^'.repeat(width)}\n${explanation}\n`;
}

function nodeEvalStackThroughUserFrame(stack: string): string | null {
  const lines = stack.split('\n');
  const frameIndex = lines.findIndex((line) =>
    /^\s+at (?:eval \()?\[eval\]:\d+:\d+\)?$/u.test(line),
  );
  if (frameIndex === -1) return null;
  const frame = /(?:eval \()?\[eval\]:(\d+):(\d+)\)?/u.exec(lines[frameIndex] ?? '');
  if (frame === null) return null;
  lines[frameIndex] = `    at [eval]:${frame[1]}:${frame[2]}`;
  return lines.slice(0, frameIndex + 1).join('\n');
}

function nodeEvalFirstCallbackFrame(stack: string): string | null {
  return (
    stack
      .split('\n')
      .find((line) => /^\s+at (?:[A-Za-z0-9_$.[\]<> ]+ \()?\[eval\]:\d+:\d+\)?$/u.test(line)) ??
    null
  );
}

function nodeEvalHasTimerWrapperFrame(stack: string): boolean {
  return stack
    .split('\n')
    .some(
      (line) =>
        /^\s+at Timeout\._onTimeout \(/u.test(line) ||
        /\/builtins\/timers\.[cm]?[jt]s:\d+:\d+\)?$/u.test(line),
    );
}

/** Project the host eval frame to Node's sole claimed `[eval]` user frame. */
export function projectNodeEvalError(
  error: unknown,
  source: string,
  origin: 'sync' | 'unhandled' | 'uncaught' = 'sync',
): unknown {
  if (!(error instanceof Error)) return error;
  const firstLine =
    (error.stack ?? `${error.name}: ${error.message}`).split('\n')[0] ?? error.message;
  if (error instanceof SyntaxError) {
    const prelude = nodeEvalSyntaxPrelude(source, error);
    if (prelude !== null) {
      error.stack = `${prelude}${firstLine}`;
      return error;
    }
  }
  const stack = error.stack ?? firstLine;
  const frame = /(?:eval \()?\[eval\]:(\d+):(\d+)\)?/u.exec(stack);
  if (frame === null) return error;
  const frameLine = Number(frame[1]);
  const frameColumn = Number(frame[2]);
  const thrown = nodeEvalThrowLocation(source, frameLine, Math.max(0, frameColumn - 1));
  if (origin === 'sync' && thrown === null) {
    error.stack = nodeEvalStackThroughUserFrame(stack) ?? stack;
    return error;
  }
  const useThrowLocation =
    thrown !== null &&
    (origin === 'sync' || (origin === 'uncaught' && nodeEvalHasTimerWrapperFrame(stack)));
  const preludeLine = useThrowLocation ? thrown.line : frameLine;
  const lineText = source.split('\n')[preludeLine - 1] ?? '';
  const caretColumn = useThrowLocation ? thrown.column : Math.max(0, frameColumn - 1);
  const callbackFrame = origin === 'uncaught' ? nodeEvalFirstCallbackFrame(stack) : null;
  error.stack =
    `[eval]:${String(preludeLine)}\n${lineText}\n${' '.repeat(caretColumn)}^\n\n` +
    `${firstLine}${
      callbackFrame === null
        ? `\n    at [eval]:${String(frameLine)}:${String(frameColumn)}`
        : `\n${callbackFrame}`
    }`;
  return error;
}

function requiresTypeScriptEvalContext(source: string): boolean {
  if (parsesAsJavaScriptScript(source)) return false;
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ESNext,
    },
    fileName: '[eval].ts',
    reportDiagnostics: true,
  });
  if (
    transpiled.diagnostics?.some(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    )
  ) {
    return false;
  }
  const syntax = ts.createSourceFile(
    '[eval].ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return hasTypeScriptOnlySyntax(syntax) && parsesAsJavaScriptScript(transpiled.outputText);
}

function installNodeEvalCjsBindings(moduleObject: CjsModule, require: CjsRequire): void {
  for (const [key, value] of [
    ['require', require],
    ['module', moduleObject],
    ['exports', moduleObject.exports],
    ['__filename', '[eval]'],
    ['__dirname', '.'],
  ] as const) {
    objectDefinePropertyPrimordial(globalThis, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
}

function createModuleLoaderCore(
  vfs: FsSync,
  opts: ModuleLoaderOptions = {},
  builtinOverrides?: ReadonlyMap<string, Record<string, unknown>>,
): ModuleLoaderCore {
  const registry = new ModuleRegistry();
  // Node's replaceable `.js` translator publishes a CJS `require.cache`
  // projection even when the same file already has an independent ESM job.
  // Keeping that projection separate prevents import-first ESM records from
  // bypassing a later custom hook while preserving normal CJS cache identity.
  const customJsRegistry = new ModuleRegistry();
  const defaultRequiredEsm = new Set<string>();
  const resolver = createResolver(vfs, {
    paths: opts.paths,
    autoDiscoverTsconfigPaths: opts.autoDiscoverTsconfigPaths,
  });
  const loadBuiltinForLoader = (id: string): Record<string, unknown> =>
    loadBuiltinOrThrow(id, builtinOverrides);
  const cjsInterop = createCjsInteropAuthority({
    registry,
    resolver,
    loadBuiltin: loadBuiltinForLoader,
  });
  const cjsExtensions = Object.create(null) as CjsExtensions;
  const loadDefaultEsm = (resolved: ResolvedModule): unknown => {
    const value = requireEsm(resolved, { ...deps });
    if (stringEndsWith(resolved.id, '.js')) defaultRequiredEsm.add(resolved.id);
    return value;
  };
  const defaultJsExtension: CjsExtensionHook = (module, filename) => {
    const resolved = readResolvedById(filename);
    if (resolved.kind === 'esm') {
      // A replaced `.js` hook may delegate to the captured Node default. The
      // hook's CJS projection stays cached independently while the default
      // translator enters the primary ESM job.
      module.exports = requireEsm(resolved, { ...deps }) as Record<string, unknown>;
      return;
    }
    module._compile(resolved.source, filename);
  };
  cjsExtensions['.js'] = defaultJsExtension;
  cjsExtensions['.json'] = (module, filename) => {
    module.exports = JSON.parse(readResolvedById(filename).source) as Record<string, unknown>;
  };
  cjsExtensions['.node'] = (_module, filename) => {
    throw new NotImplementedError(
      'module-loader.native-addon',
      `cannot load native addon ${filename} in the browser runtime`,
    );
  };
  const cwd = opts.cwd ?? STUB_FROM_FILE_DEFAULT;
  const workspace = opts.workspace ?? opts.cwd ?? STUB_FROM_FILE_DEFAULT;
  // Strip cache: real transform providers can be expensive, so re-stripping
  // byte-identical `.ts` across repeated loads is wasted work. Keep the cache
  // under the absolute id but validate against the current source text so an
  // in-place edit at the same path cannot serve a stale transform.
  const transformCache = new Map<string, { readonly source: string; readonly code: string }>();
  const sourceMaps = new SourceMapRegistry();
  const cachedTransform: TransformSourceHook | undefined =
    opts.transformSource &&
    (async (req) => {
      const hit = transformCache.get(req.id);
      if (hit?.source === req.source) return hit.code;
      const out = await opts.transformSource!(req);
      const extracted = extractInlineSourceMap(out);
      if (extracted.map) sourceMaps.set(req.id, extracted.map);
      else sourceMaps.delete(req.id);
      transformCache.set(req.id, { source: req.source, code: extracted.code });
      return extracted.code;
    });

  // ESM AST cache: `transformEsm` (acorn parse + walk) is the heaviest
  // per-module CPU step. Cache by id but validate the transformed JS text, so a
  // changed TS source at the same path cannot reuse a stale AST.
  const esmAstCache = new Map<
    string,
    { readonly source: string; readonly result: TransformResult }
  >();
  const cachedTransformEsm = (source: string, id: string): TransformResult => {
    const hit = esmAstCache.get(id);
    if (hit?.source === source) return hit.result;
    const out = transformEsm(source, id);
    esmAstCache.set(id, { source, result: out });
    return out;
  };

  const deps = {
    registry,
    resolver,
    extensions: cjsExtensions,
    defaultJsExtension,
    makeRequire,
    workspace,
    sourceMaps,
    transformSource: cachedTransform,
    transformEsm: cachedTransformEsm,
    WebAssembly: sandboxToolchainWebAssembly(),
    staticImportNames: cjsInterop.staticImportNames,
    resolve(specifier: string, fromFile: string, esm: boolean): ResolvedModule {
      return resolver.resolve(specifier, { fromFile, esm });
    },
    loadSync(resolved: ResolvedModule, parent?: CjsModule): unknown {
      if (resolved.kind === 'builtin') {
        return loadBuiltinForLoader(resolved.id);
      }
      // Node's replaceable `.js` extension owns dispatch before package-type or
      // syntax detection. Only the loader's default `.js` hook enters ESM; a
      // caller replacement receives even `type:module` / ESM-syntax `.js`.
      if (
        resolved.kind === 'esm' &&
        stringEndsWith(resolved.id, '.js') &&
        (customJsRegistry.has(resolved.id) ||
          (!defaultRequiredEsm.has(resolved.id) && cjsExtensions['.js'] !== defaultJsExtension))
      ) {
        return executeCjs(
          { ...resolved, kind: 'cjs' },
          { ...deps, registry: customJsRegistry },
          parent,
        );
      }
      if (resolved.kind === 'esm') {
        return loadDefaultEsm(resolved);
      }
      return executeCjs(
        resolved,
        {
          ...deps,
        },
        parent,
      );
    },
    loadSyncForImport(resolved: ResolvedModule): Record<string, unknown> {
      return cjsInterop.loadSyncForImport(resolved, () => executeCjs(resolved, { ...deps }));
    },
    primeSyncImport(resolved: ResolvedModule): Record<string, unknown> {
      return cjsInterop.primeSyncImport(resolved);
    },
    async loadAsync(id: string): Promise<Record<string, unknown>> {
      if (id.startsWith('node:')) {
        return cjsInterop.importBuiltin(id);
      }
      const job = cjsInterop.importJob(id);
      if (job) return job;
      // Drop the SECOND resolve+read+scope-walk: carry the already-resolved
      // module (perf #14). The id-only path stays for direct id callers
      // (cjs/interop), which never hold a ResolvedModule.
      return deps.loadAsyncResolved(readResolvedById(id));
    },
    // Async load of an ALREADY-RESOLVED module — skips re-resolving (perf #14).
    // ESM job ownership below supplies deduplication and cycle handling.
    async loadAsyncResolved(resolved: ResolvedModule): Promise<Record<string, unknown>> {
      // A `node:` builtin reaches here when an ESM module statically imports it
      // (the preload carries the resolved `{kind:'builtin'}` record). Mirror the
      // id-path's `node:` short-circuit — builtins have no source to execute.
      if (resolved.kind === 'builtin') {
        return cjsInterop.importBuiltin(resolved.id);
      }
      if (resolved.kind === 'esm') {
        return executeEsm(resolved, { ...deps });
      }
      return cjsInterop.importCjs(resolved, () => executeCjs(resolved, { ...deps }));
    },
  };

  function readResolvedById(id: string): ResolvedModule {
    if (id.startsWith('node:')) {
      return { id, kind: 'builtin', source: '', packageRoot: null };
    }
    // Re-resolve via the id itself as both specifier and fromFile so the
    // absolute path matches.
    return resolver.resolve(id, { fromFile: id, esm: false });
  }

  function makeRequire(from: string, parent?: CjsModule): CjsRequire {
    const req = ((specifier: string): unknown => {
      const resolved = resolver.resolve(specifier, { fromFile: from, esm: false });
      return deps.loadSync(resolved, parent);
    }) as CjsRequire;
    req.resolve = (specifier: string): string =>
      resolver.resolve(specifier, { fromFile: from, esm: false }).id;
    // TODO(backlog: runtime-js/require-cache-module-record-surface): this is
    // intentionally not claimed as Node-compatible until backed by registry.
    req.cache = Object.create(null) as Record<string, unknown>;
    req.extensions = cjsExtensions;
    req.main = undefined;
    return req;
  }

  __setCreateRequireImpl(makeRequire);

  const loader: ModuleLoader = {
    require(specifier, from = cwd) {
      const resolved = resolver.resolve(specifier, { fromFile: from, esm: false });
      if (resolved.kind === 'builtin') {
        return loadBuiltinForLoader(resolved.id);
      }
      return deps.loadSync(resolved);
    },
    async import(specifier, from = cwd) {
      keepaliveRef();
      try {
        const resolved = resolver.resolve(specifier, { fromFile: from, esm: true });
        return await deps.loadAsyncResolved(resolved);
      } finally {
        keepaliveUnref();
      }
    },
    loadById(id, esm = false) {
      const resolved = resolver.resolve(id, { fromFile: id, esm });
      return deps.loadAsyncResolved(resolved);
    },
    invalidate(id) {
      registry.invalidate(id);
      customJsRegistry.invalidate(id);
      // Keep derived caches + future import-job lookup coherent with records.
      // Already-returned job promises retain their captured generation.
      if (id === undefined) {
        transformCache.clear();
        esmAstCache.clear();
        sourceMaps.clear();
        defaultRequiredEsm.clear();
      } else {
        transformCache.delete(id);
        esmAstCache.delete(id);
        sourceMaps.delete(id);
        defaultRequiredEsm.delete(id);
      }
      cjsInterop.invalidate(id);
      // Resolver caches (package.json parses #5 + resolution memo #15) are
      // input-keyed and cannot be pruned by module id, so ANY invalidate —
      // full OR targeted — clears them whole. A stale package.json (load-fixture
      // reload) or a stale resolution would silently mis-classify / mis-route a
      // module.
      resolver.clearCaches();
    },
    registry,
    resolver,
  };

  return {
    loader,
    runNodeEvalScript(source, explicitCommonJs) {
      if (!explicitCommonJs && requiresTypeScriptEvalContext(source)) {
        // TODO(backlog: runtime-js/node-cli-typescript-eval-context)
        throw new NotImplementedError('runtime-js.node-eval-typescript-context');
      }
      const filename = joinPath(cwd, '[eval]');
      const record = createModuleRecord('[eval]', 'cjs');
      const moduleObject = initialiseDetachedCjsRecord(record, deps, filename);
      const require = makeRequire(filename, moduleObject);
      installNodeEvalCjsBindings(moduleObject, require);
      return reflectApplyPrimordial(indirectEvalPrimordial, globalThis, [
        `${source}\n//# sourceURL=[eval]`,
      ]);
    },
  };
}

export function createModuleLoader(vfs: FsSync, opts: ModuleLoaderOptions = {}): ModuleLoader {
  return createModuleLoaderCore(vfs, opts).loader;
}

/** Internal toolchain seam: bind selected builtin facades to one loader generation. */
export function createModuleLoaderWithBuiltinOverrides(
  vfs: FsSync,
  opts: ModuleLoaderOptions,
  builtinOverrides: ReadonlyMap<string, Record<string, unknown>>,
): ModuleLoader {
  return createModuleLoaderCore(vfs, opts, builtinOverrides).loader;
}

/** Package-internal Node CLI eval seam; intentionally absent from `module-loader/index.ts`. */
export function createNodeEvalScriptRunner(opts: {
  readonly vfs: FsSync;
  readonly cwd: string;
  readonly explicitCommonJs: boolean;
}): NodeEvalScriptRunner {
  const core = createModuleLoaderCore(opts.vfs, { cwd: opts.cwd });
  return {
    registry: core.loader.registry,
    run: (source) => core.runNodeEvalScript(source, opts.explicitCommonJs),
  };
}
