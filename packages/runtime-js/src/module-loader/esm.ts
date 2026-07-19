import { NotImplementedError } from '@riftydev/io';
import { dirname } from '@riftydev/vfs';
import type { Program } from 'acorn';
import { parse as acornParse } from 'acorn';
import { ref as keepaliveRef, unref as keepaliveUnref } from '../internal/event-loop-keepalive.ts';
import { fileURLFromResolvedPath } from '../internal/posix-file-url.ts';
import { hasURLScheme } from '../internal/url-scheme.ts';
import { publishRuntimeGlobal, readRuntimeGlobal } from '../internal/worker-globals.ts';
import { ModuleLoadError } from './errors.ts';
import { type TransformResult, transformEsm } from './esm-ast.ts';
import { createFunctionImportRouting } from './function-import-routing.ts';
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
   * (perf #16). Pure: same id+source -> same output.
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

interface GuardNodeShape {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

interface GuardScope {
  readonly bindings: Set<string>;
  readonly globalAliases: Set<string>;
  readonly maybeFunctionAliases: Set<string>;
  readonly maybeDerivedFunctionAliases: Set<string>;
  readonly maybeEvalAliases: Set<string>;
}

interface EsmFunctionGuardCtx {
  readonly scopes: GuardScope[];
  hasGlobalFunctionWrite: boolean;
  hasDynamicFunctionScope: boolean;
  hasWithDynamicFunctionScope: boolean;
  hasDerivedHostFunctionConstructor: boolean;
  hasRoutedFunctionReference: boolean;
  hasFunctionEvalText: boolean;
}

// TODO(backlog: runtime-js/function-constructor-exhaustive-metaprogramming-ceiling):
// finite guard for known Function/eval import escapes, not proof-complete JS alias analysis.
const functionRoutingAnalysisToken =
  /\bFunction\b|\bconstructor\b|\bglobalThis\b|\bglobal\b|\bObject\b|\bReflect\b|__define(?:Getter|Setter)__|\beval\b|\bwith\b/;

function assertNoEsmFunctionRoutingCeiling(source: string, id: string): void {
  if (!functionRoutingAnalysisToken.test(source)) return;
  let program: Program;
  try {
    program = acornParse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowHashBang: true,
      locations: false,
    }) as Program;
  } catch {
    return;
  }

  const rootScope = createGuardScope();
  const body = program.body as unknown as GuardNodeShape[];
  predeclareGuardFunctionScope(body, rootScope);
  predeclareGuardLexicalScope(body, rootScope);
  const ctx: EsmFunctionGuardCtx = {
    scopes: [rootScope],
    hasGlobalFunctionWrite: false,
    hasDynamicFunctionScope: false,
    hasWithDynamicFunctionScope: false,
    hasDerivedHostFunctionConstructor: false,
    hasRoutedFunctionReference: false,
    hasFunctionEvalText: false,
  };
  walkEsmFunctionGuard(program as unknown as GuardNodeShape, ctx);

  if (ctx.hasDerivedHostFunctionConstructor) {
    throw new NotImplementedError(
      'module-loader.function-constructor-derived-host',
      `ESM module ${id} compiles import()-bearing source through a derived host Function constructor; rifty cannot route that constructor without mutating the host Function prototype, so this module is an explicit ceiling`,
    );
  }
  if (
    ctx.hasFunctionEvalText ||
    (ctx.hasWithDynamicFunctionScope && ctx.hasRoutedFunctionReference)
  ) {
    throw new NotImplementedError(
      'module-loader.esm-dynamic-function-scope',
      `ESM module ${id} contains literal eval Function/import text or combines routed Function with with dynamic scope; rifty cannot statically preserve Node's dynamic binding semantics, so this module is an explicit ceiling`,
    );
  }
  if (ctx.hasGlobalFunctionWrite) {
    throw new NotImplementedError(
      'module-loader.esm-global-function-assignment',
      `ESM module ${id} writes the Function binding/global property; rifty cannot emulate that without mutating the host constructor, so this module is an explicit ceiling`,
    );
  }
}

function createGuardScope(): GuardScope {
  return {
    bindings: new Set(),
    globalAliases: new Set(),
    maybeFunctionAliases: new Set(),
    maybeDerivedFunctionAliases: new Set(),
    maybeEvalAliases: new Set(),
  };
}

function pushGuardScope(ctx: EsmFunctionGuardCtx, scope: GuardScope = createGuardScope()): void {
  ctx.scopes.push(scope);
}

function popGuardScope(ctx: EsmFunctionGuardCtx): void {
  ctx.scopes.pop();
}

function topGuardScope(ctx: EsmFunctionGuardCtx): GuardScope {
  const scope = ctx.scopes[ctx.scopes.length - 1];
  if (!scope) throw new Error('internal: missing ESM function guard scope');
  return scope;
}

function addGuardBinding(scope: GuardScope, name: string | undefined): void {
  if (!name) return;
  scope.bindings.add(name);
  scope.globalAliases.delete(name);
  scope.maybeFunctionAliases.delete(name);
  scope.maybeDerivedFunctionAliases.delete(name);
  scope.maybeEvalAliases.delete(name);
}

function isGuardShadowed(ctx: EsmFunctionGuardCtx, name: string): boolean {
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    if (ctx.scopes[i]?.bindings.has(name)) return true;
  }
  return false;
}

function markGuardGlobalAlias(ctx: EsmFunctionGuardCtx, name: string | undefined): void {
  if (!name) return;
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.globalAliases.add(name);
    return;
  }
}

function unmarkGuardGlobalAlias(ctx: EsmFunctionGuardCtx, name: string | undefined): void {
  if (!name) return;
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.globalAliases.delete(name);
    return;
  }
}

function isGuardGlobalAlias(ctx: EsmFunctionGuardCtx, name: string): boolean {
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    return scope.globalAliases.has(name);
  }
  return false;
}

function markGuardMaybeFunctionAlias(ctx: EsmFunctionGuardCtx, name: string | undefined): void {
  if (!name) return;
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.maybeFunctionAliases.add(name);
    return;
  }
}

function unmarkGuardMaybeFunctionAlias(ctx: EsmFunctionGuardCtx, name: string | undefined): void {
  if (!name) return;
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.maybeFunctionAliases.delete(name);
    return;
  }
}

function isGuardMaybeFunctionAlias(ctx: EsmFunctionGuardCtx, name: string): boolean {
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    return scope.maybeFunctionAliases.has(name);
  }
  return false;
}

function markGuardMaybeDerivedFunctionAlias(
  ctx: EsmFunctionGuardCtx,
  name: string | undefined,
): void {
  if (!name) return;
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.maybeDerivedFunctionAliases.add(name);
    return;
  }
}

function unmarkGuardMaybeDerivedFunctionAlias(
  ctx: EsmFunctionGuardCtx,
  name: string | undefined,
): void {
  if (!name) return;
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.maybeDerivedFunctionAliases.delete(name);
    return;
  }
}

function isGuardMaybeDerivedFunctionAlias(ctx: EsmFunctionGuardCtx, name: string): boolean {
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    return scope.maybeDerivedFunctionAliases.has(name);
  }
  return false;
}

function markGuardMaybeEvalAlias(ctx: EsmFunctionGuardCtx, name: string | undefined): void {
  if (!name) return;
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.maybeEvalAliases.add(name);
    return;
  }
}

function unmarkGuardMaybeEvalAlias(ctx: EsmFunctionGuardCtx, name: string | undefined): void {
  if (!name) return;
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.maybeEvalAliases.delete(name);
    return;
  }
}

function isGuardMaybeEvalAlias(ctx: EsmFunctionGuardCtx, name: string): boolean {
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    return scope.maybeEvalAliases.has(name);
  }
  return false;
}

function declareGuardPattern(scope: GuardScope, pattern: unknown): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as GuardNodeShape;
  switch (pat.type) {
    case 'Identifier':
      addGuardBinding(scope, (pat as unknown as { name?: string }).name);
      return;
    case 'ObjectPattern': {
      const props = (pat as unknown as { properties?: unknown[] }).properties ?? [];
      for (const prop of props) {
        const p = prop as GuardNodeShape;
        if (p.type === 'RestElement') declareGuardPattern(scope, p.argument);
        else declareGuardPattern(scope, p.value);
      }
      return;
    }
    case 'ArrayPattern': {
      const elements = (pat as unknown as { elements?: unknown[] }).elements ?? [];
      for (const element of elements) declareGuardPattern(scope, element);
      return;
    }
    case 'RestElement':
      declareGuardPattern(scope, pat.argument);
      return;
    case 'AssignmentPattern':
      declareGuardPattern(scope, pat.left);
      return;
    default:
      return;
  }
}

function declareGuardVariable(scope: GuardScope, node: GuardNodeShape): void {
  const declarations = (node as unknown as { declarations?: unknown[] }).declarations ?? [];
  for (const decl of declarations) {
    declareGuardPattern(scope, (decl as GuardNodeShape).id);
  }
}

function declareGuardImport(scope: GuardScope, node: GuardNodeShape): void {
  const specifiers = (node as unknown as { specifiers?: GuardNodeShape[] }).specifiers ?? [];
  for (const specifier of specifiers) {
    addGuardBinding(scope, (specifier.local as { name?: string } | undefined)?.name);
  }
}

function predeclareGuardFunctionScope(body: readonly GuardNodeShape[], scope: GuardScope): void {
  for (const node of body) collectGuardFunctionScopeBindings(node, scope);
}

function collectGuardFunctionScopeBindings(node: unknown, scope: GuardScope): void {
  if (!node || typeof node !== 'object') return;
  const n = node as GuardNodeShape;
  if (typeof n.type !== 'string') return;
  switch (n.type) {
    case 'FunctionDeclaration':
      addGuardBinding(scope, (n.id as { name?: string } | undefined)?.name);
      return;
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ClassExpression':
      return;
    case 'ClassDeclaration':
      return;
    case 'VariableDeclaration':
      if ((n as unknown as { kind?: string }).kind === 'var') declareGuardVariable(scope, n);
      return;
    default:
      for (const key of Object.keys(n)) {
        if (
          key === 'type' ||
          key === 'start' ||
          key === 'end' ||
          key === 'loc' ||
          key === 'range'
        ) {
          continue;
        }
        const value = n[key];
        if (!value) continue;
        if (Array.isArray(value)) {
          for (const item of value) collectGuardFunctionScopeBindings(item, scope);
        } else if (typeof value === 'object') {
          collectGuardFunctionScopeBindings(value, scope);
        }
      }
  }
}

function predeclareGuardLexicalScope(body: readonly GuardNodeShape[], scope: GuardScope): void {
  for (const node of body) {
    if (node.type === 'ImportDeclaration') {
      declareGuardImport(scope, node);
    } else if (
      node.type === 'VariableDeclaration' &&
      (node as unknown as { kind?: string }).kind !== 'var'
    ) {
      declareGuardVariable(scope, node);
    } else if (node.type === 'ClassDeclaration' || node.type === 'FunctionDeclaration') {
      addGuardBinding(scope, (node.id as { name?: string } | undefined)?.name);
    }
  }
}

function walkEsmFunctionGuard(node: unknown, ctx: EsmFunctionGuardCtx): void {
  if (!node || typeof node !== 'object') return;
  const n = node as GuardNodeShape;
  if (typeof n.type !== 'string') return;
  switch (n.type) {
    case 'Program':
      for (const child of (n as unknown as { body: GuardNodeShape[] }).body) {
        walkEsmFunctionGuard(child, ctx);
      }
      return;
    case 'ImportDeclaration':
      return;
    case 'Identifier':
      if ((n as unknown as { name?: string }).name === 'eval' && !isGuardShadowed(ctx, 'eval')) {
        ctx.hasDynamicFunctionScope = true;
      }
      if (
        (n as unknown as { name?: string }).name === 'Function' &&
        !isGuardShadowed(ctx, 'Function')
      ) {
        ctx.hasRoutedFunctionReference = true;
      }
      return;
    case 'VariableDeclaration': {
      const declarations = (n as unknown as { declarations?: GuardNodeShape[] }).declarations ?? [];
      for (const decl of declarations) {
        const declId = decl.id as GuardNodeShape | undefined;
        walkGuardPatternExpressions(declId, ctx);
        if (decl.init) walkEsmFunctionGuard(decl.init, ctx);
        if (decl.init) {
          updateGuardGlobalAliasesFromPatternValue(declId, decl.init, ctx);
          updateGuardMaybeFunctionAliasesFromPatternValue(declId, decl.init, ctx);
          updateGuardMaybeDerivedFunctionAliasesFromPatternValue(declId, decl.init, ctx);
          updateGuardMaybeEvalAliasesFromPatternValue(declId, decl.init, ctx);
        }
      }
      return;
    }
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      walkGuardFunctionNode(n, ctx);
      return;
    case 'BlockStatement':
      walkGuardBlock(n as unknown as { body: GuardNodeShape[] }, ctx);
      return;
    case 'SwitchStatement':
      walkGuardSwitch(n, ctx);
      return;
    case 'ForStatement':
      walkGuardFor(n, ctx);
      return;
    case 'ForInStatement':
    case 'ForOfStatement':
      walkGuardForInOf(n, ctx);
      return;
    case 'CatchClause': {
      pushGuardScope(ctx);
      const param = (n as unknown as { param?: unknown }).param;
      declareGuardPattern(topGuardScope(ctx), param);
      walkGuardPatternExpressions(param, ctx);
      walkEsmFunctionGuard(n.body, ctx);
      popGuardScope(ctx);
      return;
    }
    case 'ClassDeclaration':
    case 'ClassExpression': {
      pushGuardScope(ctx);
      addGuardBinding(topGuardScope(ctx), (n.id as { name?: string } | undefined)?.name);
      if (n.superClass) walkEsmFunctionGuard(n.superClass, ctx);
      walkEsmFunctionGuard(n.body, ctx);
      popGuardScope(ctx);
      return;
    }
    case 'WithStatement':
      ctx.hasDynamicFunctionScope = true;
      ctx.hasWithDynamicFunctionScope = true;
      walkEsmFunctionGuard(n.object, ctx);
      walkEsmFunctionGuard(n.body, ctx);
      return;
    case 'MemberExpression':
      if (isGlobalFunctionReadMember(n, ctx)) {
        ctx.hasGlobalFunctionWrite = true;
      }
      if (isGlobalEvalReadMember(n, ctx)) {
        ctx.hasDynamicFunctionScope = true;
      }
      walkEsmFunctionGuard(n.object, ctx);
      if ((n as unknown as { computed?: boolean }).computed) walkEsmFunctionGuard(n.property, ctx);
      return;
    case 'CallExpression': {
      const callee = n.callee as GuardNodeShape | undefined;
      const args = (n as unknown as { arguments?: unknown[] }).arguments ?? [];
      if (isGlobalFunctionMutationCall(n, ctx)) {
        ctx.hasGlobalFunctionWrite = true;
      }
      if (guardCalleeMayBeHostFunction(callee, ctx)) {
        ctx.hasGlobalFunctionWrite = true;
      }
      if (isReflectDerivedFunctionConstructorCall(n, ctx)) {
        ctx.hasDerivedHostFunctionConstructor = true;
      }
      if (guardCalleeMayBeDerivedHostFunction(callee, ctx) && constructorArgsMayImport(args)) {
        ctx.hasDerivedHostFunctionConstructor = true;
      }
      if (guardCalleeMayBeEval(callee, ctx)) {
        ctx.hasDynamicFunctionScope = true;
        ctx.hasFunctionEvalText = ctx.hasFunctionEvalText || evalArgumentMayTouchFunction(args[0]);
      }
      if (
        callee?.type === 'Identifier' &&
        (callee as unknown as { name?: string }).name === 'eval' &&
        !isGuardShadowed(ctx, 'eval')
      ) {
        ctx.hasDynamicFunctionScope = true;
        ctx.hasFunctionEvalText = ctx.hasFunctionEvalText || evalArgumentMayTouchFunction(args[0]);
      }
      if (callee?.type === 'MemberExpression' && isGlobalEvalCallMember(callee, ctx)) {
        ctx.hasDynamicFunctionScope = true;
        ctx.hasFunctionEvalText = ctx.hasFunctionEvalText || evalArgumentMayTouchFunction(args[0]);
      }
      walkEsmFunctionGuard(callee, ctx);
      for (const arg of args) walkEsmFunctionGuard(arg, ctx);
      return;
    }
    case 'NewExpression': {
      const callee = n.callee as GuardNodeShape | undefined;
      const args = (n as unknown as { arguments?: unknown[] }).arguments ?? [];
      if (guardCalleeMayBeHostFunction(callee, ctx)) {
        ctx.hasGlobalFunctionWrite = true;
      }
      if (guardCalleeMayBeDerivedHostFunction(callee, ctx) && constructorArgsMayImport(args)) {
        ctx.hasDerivedHostFunctionConstructor = true;
      }
      walkEsmFunctionGuard(callee, ctx);
      for (const arg of args) walkEsmFunctionGuard(arg, ctx);
      return;
    }
    case 'AssignmentExpression': {
      walkGuardAssignmentTarget(n.left, ctx);
      walkEsmFunctionGuard(n.right, ctx);
      updateGuardGlobalAliasesFromPatternValue(n.left, n.right, ctx);
      updateGuardMaybeFunctionAliasesFromPatternValue(n.left, n.right, ctx);
      updateGuardMaybeDerivedFunctionAliasesFromPatternValue(n.left, n.right, ctx);
      updateGuardMaybeEvalAliasesFromPatternValue(n.left, n.right, ctx);
      return;
    }
    case 'UpdateExpression':
      walkGuardAssignmentTarget(n.argument, ctx);
      return;
    case 'UnaryExpression':
      if ((n as unknown as { operator?: string }).operator === 'delete') {
        walkGuardAssignmentTarget(n.argument, ctx);
        return;
      }
      walkGuardDefault(n, ctx);
      return;
    case 'Property': {
      const p = n as unknown as {
        computed?: boolean;
        key?: unknown;
        shorthand?: boolean;
        value?: unknown;
      };
      if (p.computed) walkEsmFunctionGuard(p.key, ctx);
      walkEsmFunctionGuard(p.value, ctx);
      return;
    }
    case 'MethodDefinition':
    case 'PropertyDefinition': {
      const d = n as unknown as { computed?: boolean; key?: unknown; value?: unknown };
      if (d.computed) walkEsmFunctionGuard(d.key, ctx);
      walkEsmFunctionGuard(d.value, ctx);
      return;
    }
    case 'StaticBlock':
      walkGuardStaticBlock(n as unknown as { body: GuardNodeShape[] }, ctx);
      return;
    case 'LabeledStatement':
      walkEsmFunctionGuard(n.body, ctx);
      return;
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'PrivateIdentifier':
    case 'Literal':
    case 'TemplateElement':
    case 'ThisExpression':
    case 'Super':
    case 'DebuggerStatement':
    case 'EmptyStatement':
      return;
    default:
      walkGuardDefault(n, ctx);
      return;
  }
}

function walkGuardBlock(block: { body: GuardNodeShape[] }, ctx: EsmFunctionGuardCtx): void {
  pushGuardScope(ctx);
  predeclareGuardLexicalScope(block.body, topGuardScope(ctx));
  for (const child of block.body) walkEsmFunctionGuard(child, ctx);
  popGuardScope(ctx);
}

function walkGuardSwitch(node: GuardNodeShape, ctx: EsmFunctionGuardCtx): void {
  walkEsmFunctionGuard(node.discriminant, ctx);
  pushGuardScope(ctx);
  const cases = (node as unknown as { cases?: GuardNodeShape[] }).cases ?? [];
  const consequentBody: GuardNodeShape[] = [];
  for (const switchCase of cases) {
    const consequent =
      (switchCase as unknown as { consequent?: GuardNodeShape[] }).consequent ?? [];
    consequentBody.push(...consequent);
  }
  predeclareGuardLexicalScope(consequentBody, topGuardScope(ctx));
  for (const switchCase of cases) {
    walkEsmFunctionGuard(switchCase.test, ctx);
    const consequent =
      (switchCase as unknown as { consequent?: GuardNodeShape[] }).consequent ?? [];
    for (const child of consequent) walkEsmFunctionGuard(child, ctx);
  }
  popGuardScope(ctx);
}

function walkGuardStaticBlock(block: { body: GuardNodeShape[] }, ctx: EsmFunctionGuardCtx): void {
  pushGuardScope(ctx);
  predeclareGuardFunctionScope(block.body, topGuardScope(ctx));
  predeclareGuardLexicalScope(block.body, topGuardScope(ctx));
  for (const child of block.body) walkEsmFunctionGuard(child, ctx);
  popGuardScope(ctx);
}

function walkGuardFor(node: GuardNodeShape, ctx: EsmFunctionGuardCtx): void {
  pushGuardScope(ctx);
  const init = node.init as GuardNodeShape | null | undefined;
  if (
    init?.type === 'VariableDeclaration' &&
    (init as unknown as { kind?: string }).kind !== 'var'
  ) {
    declareGuardVariable(topGuardScope(ctx), init);
  }
  walkEsmFunctionGuard(init, ctx);
  walkEsmFunctionGuard(node.test, ctx);
  walkEsmFunctionGuard(node.update, ctx);
  walkEsmFunctionGuard(node.body, ctx);
  popGuardScope(ctx);
}

function walkGuardForInOf(node: GuardNodeShape, ctx: EsmFunctionGuardCtx): void {
  pushGuardScope(ctx);
  const left = node.left as GuardNodeShape | undefined;
  if (
    left?.type === 'VariableDeclaration' &&
    (left as unknown as { kind?: string }).kind !== 'var'
  ) {
    declareGuardVariable(topGuardScope(ctx), left);
  }
  if (left?.type === 'VariableDeclaration') walkEsmFunctionGuard(left, ctx);
  else walkGuardAssignmentTarget(left, ctx);
  walkEsmFunctionGuard(node.right, ctx);
  walkEsmFunctionGuard(node.body, ctx);
  popGuardScope(ctx);
}

function walkGuardFunctionNode(fn: GuardNodeShape, ctx: EsmFunctionGuardCtx): void {
  const scope = createGuardScope();
  addGuardBinding(scope, (fn.id as { name?: string } | undefined)?.name);
  const params = (fn as unknown as { params?: unknown[] }).params ?? [];
  for (const param of params) declareGuardPattern(scope, param);
  const body = fn.body as GuardNodeShape | undefined;
  if (body?.type === 'BlockStatement') {
    predeclareGuardFunctionScope((body as unknown as { body: GuardNodeShape[] }).body, scope);
  }
  pushGuardScope(ctx, scope);
  for (const param of params) walkGuardPatternExpressions(param, ctx);
  walkEsmFunctionGuard(body, ctx);
  popGuardScope(ctx);
}

function walkGuardPatternExpressions(pattern: unknown, ctx: EsmFunctionGuardCtx): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as GuardNodeShape;
  switch (pat.type) {
    case 'ObjectPattern': {
      const props = (pat as unknown as { properties?: unknown[] }).properties ?? [];
      for (const prop of props) {
        const p = prop as GuardNodeShape;
        if (p.type === 'RestElement') {
          walkGuardPatternExpressions(p.argument, ctx);
        } else {
          if ((p as unknown as { computed?: boolean }).computed) walkEsmFunctionGuard(p.key, ctx);
          walkGuardPatternExpressions(p.value, ctx);
        }
      }
      return;
    }
    case 'ArrayPattern': {
      const elements = (pat as unknown as { elements?: unknown[] }).elements ?? [];
      for (const element of elements) walkGuardPatternExpressions(element, ctx);
      return;
    }
    case 'RestElement':
      walkGuardPatternExpressions(pat.argument, ctx);
      return;
    case 'AssignmentPattern':
      markGuardGlobalAliasesFromPatternDefault(pat.left, pat.right, ctx);
      walkGuardPatternExpressions(pat.left, ctx);
      walkEsmFunctionGuard(pat.right, ctx);
      return;
    default:
      return;
  }
}

function walkGuardAssignmentTarget(target: unknown, ctx: EsmFunctionGuardCtx): void {
  if (!target || typeof target !== 'object') return;
  const t = target as GuardNodeShape;
  if (t.type === 'Identifier') {
    const name = (t as unknown as { name?: string }).name;
    if (name === 'Function' && !isGuardShadowed(ctx, name)) {
      ctx.hasGlobalFunctionWrite = true;
    }
    return;
  }
  if (t.type === 'MemberExpression') {
    if (isGlobalFunctionWriteMember(t, ctx)) {
      ctx.hasGlobalFunctionWrite = true;
    }
    walkEsmFunctionGuard(t.object, ctx);
    if ((t as unknown as { computed?: boolean }).computed) walkEsmFunctionGuard(t.property, ctx);
    return;
  }
  walkGuardAssignmentPatternTarget(t, ctx);
}

function walkGuardAssignmentPatternTarget(pattern: unknown, ctx: EsmFunctionGuardCtx): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as GuardNodeShape;
  switch (pat.type) {
    case 'Identifier': {
      const name = (pat as unknown as { name?: string }).name;
      if (name === 'Function' && !isGuardShadowed(ctx, name)) {
        ctx.hasGlobalFunctionWrite = true;
      }
      return;
    }
    case 'ObjectPattern': {
      const props = (pat as unknown as { properties?: unknown[] }).properties ?? [];
      for (const prop of props) {
        const p = prop as GuardNodeShape;
        if (p.type === 'RestElement') walkGuardAssignmentPatternTarget(p.argument, ctx);
        else {
          if ((p as unknown as { computed?: boolean }).computed) walkEsmFunctionGuard(p.key, ctx);
          walkGuardAssignmentPatternTarget(p.value, ctx);
        }
      }
      return;
    }
    case 'ArrayPattern': {
      const elements = (pat as unknown as { elements?: unknown[] }).elements ?? [];
      for (const element of elements) walkGuardAssignmentPatternTarget(element, ctx);
      return;
    }
    case 'RestElement':
      walkGuardAssignmentPatternTarget(pat.argument, ctx);
      return;
    case 'AssignmentPattern':
      walkGuardAssignmentPatternTarget(pat.left, ctx);
      walkEsmFunctionGuard(pat.right, ctx);
      return;
    case 'MemberExpression':
      walkGuardAssignmentTarget(pat, ctx);
      return;
    default:
      walkGuardPatternExpressions(pat, ctx);
      return;
  }
}

function walkGuardDefault(n: GuardNodeShape, ctx: EsmFunctionGuardCtx): void {
  for (const key of Object.keys(n)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
      continue;
    }
    const value = n[key];
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const item of value) walkEsmFunctionGuard(item, ctx);
    } else if (typeof value === 'object') {
      walkEsmFunctionGuard(value, ctx);
    }
  }
}

function evalArgumentMayTouchFunction(node: unknown): boolean {
  const source = literalString(node);
  if (source === undefined) return false;
  return (
    /\bimport\b/.test(source) ||
    source.includes('Function') ||
    (source.includes('Fun') && source.includes('ction'))
  );
}

function updateGuardGlobalAliasesFromPatternValue(
  pattern: unknown,
  value: unknown,
  ctx: EsmFunctionGuardCtx,
): void {
  const targetNames = new Set<string>();
  collectGuardPatternBindingNames(pattern, targetNames);
  if (targetNames.size === 0) return;

  const aliasNames = new Set<string>();
  collectGuardGlobalAliasNamesFromPatternValue(pattern, value, ctx, aliasNames);
  for (const name of targetNames) {
    if (aliasNames.has(name)) markGuardGlobalAlias(ctx, name);
    else unmarkGuardGlobalAlias(ctx, name);
  }
}

function updateGuardMaybeFunctionAliasesFromPatternValue(
  pattern: unknown,
  value: unknown,
  ctx: EsmFunctionGuardCtx,
): void {
  const targetNames = new Set<string>();
  collectGuardPatternBindingNames(pattern, targetNames);
  if (targetNames.size === 0) return;

  const aliasNames = new Set<string>();
  collectGuardMaybeFunctionAliasNamesFromPatternValue(pattern, value, ctx, aliasNames);
  for (const name of targetNames) {
    if (aliasNames.has(name)) markGuardMaybeFunctionAlias(ctx, name);
    else unmarkGuardMaybeFunctionAlias(ctx, name);
  }
}

function updateGuardMaybeDerivedFunctionAliasesFromPatternValue(
  pattern: unknown,
  value: unknown,
  ctx: EsmFunctionGuardCtx,
): void {
  const targetNames = new Set<string>();
  collectGuardPatternBindingNames(pattern, targetNames);
  if (targetNames.size === 0) return;

  const aliasNames = new Set<string>();
  collectGuardMaybeDerivedFunctionAliasNamesFromPatternValue(pattern, value, ctx, aliasNames);
  for (const name of targetNames) {
    if (aliasNames.has(name)) markGuardMaybeDerivedFunctionAlias(ctx, name);
    else unmarkGuardMaybeDerivedFunctionAlias(ctx, name);
  }
}

function updateGuardMaybeEvalAliasesFromPatternValue(
  pattern: unknown,
  value: unknown,
  ctx: EsmFunctionGuardCtx,
): void {
  const targetNames = new Set<string>();
  collectGuardPatternBindingNames(pattern, targetNames);
  if (targetNames.size === 0) return;

  const aliasNames = new Set<string>();
  collectGuardMaybeEvalAliasNamesFromPatternValue(pattern, value, ctx, aliasNames);
  for (const name of targetNames) {
    if (aliasNames.has(name)) markGuardMaybeEvalAlias(ctx, name);
    else unmarkGuardMaybeEvalAlias(ctx, name);
  }
}

function collectGuardMaybeDerivedFunctionAliasNamesFromPatternValue(
  pattern: unknown,
  value: unknown,
  ctx: EsmFunctionGuardCtx,
  out: Set<string>,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as GuardNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    if (name && guardExpressionMayBeDerivedHostFunction(value, ctx)) out.add(name);
    return;
  }
  if (pat.type === 'AssignmentPattern') {
    collectGuardMaybeDerivedFunctionAliasNamesFromPatternValue(
      pat.left,
      value === undefined ? pat.right : value,
      ctx,
      out,
    );
    return;
  }
  if (pat.type === 'ObjectPattern') {
    const props = (pat as unknown as { properties?: GuardNodeShape[] }).properties ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapGuardChain(value) as GuardNodeShape).type === 'ObjectExpression'
    ) {
      const objectProperties =
        (unwrapGuardChain(value) as unknown as { properties?: GuardNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === undefined) continue;
        const sourceProp = objectProperties.find(
          (candidate) =>
            candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
        );
        collectGuardMaybeDerivedFunctionAliasNamesFromPatternValue(
          prop.value,
          sourceProp?.value,
          ctx,
          out,
        );
      }
      return;
    }
    if (guardExpressionMayHaveHostFunctionConstructor(value)) {
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === 'constructor' || key === undefined) {
          collectGuardPatternBindingNames(prop.value, out);
        }
      }
    } else {
      collectGuardMaybeDerivedFunctionAliasNamesFromDefaults(pat, ctx, out);
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    if (
      value &&
      typeof value === 'object' &&
      (unwrapGuardChain(value) as GuardNodeShape).type === 'ArrayExpression'
    ) {
      const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
      const values =
        (unwrapGuardChain(value) as unknown as { elements?: unknown[] }).elements ?? [];
      for (let i = 0; i < patterns.length; i++) {
        collectGuardMaybeDerivedFunctionAliasNamesFromPatternValue(
          patterns[i],
          values[i],
          ctx,
          out,
        );
      }
      return;
    }
    if (!isKnownObjectOrArrayLiteral(value)) {
      collectGuardPatternBindingNames(pat, out);
      collectGuardMaybeDerivedFunctionAliasNamesFromDefaults(pat, ctx, out);
    }
  }
}

function collectGuardMaybeEvalAliasNamesFromPatternValue(
  pattern: unknown,
  value: unknown,
  ctx: EsmFunctionGuardCtx,
  out: Set<string>,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as GuardNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    if (name && guardExpressionMayBeGlobalEval(value, ctx)) out.add(name);
    return;
  }
  if (pat.type === 'AssignmentPattern') {
    collectGuardMaybeEvalAliasNamesFromPatternValue(
      pat.left,
      value === undefined ? pat.right : value,
      ctx,
      out,
    );
    return;
  }
  if (pat.type === 'ObjectPattern') {
    if (
      value &&
      typeof value === 'object' &&
      (unwrapGuardChain(value) as GuardNodeShape).type === 'ObjectExpression'
    ) {
      const props = (pat as unknown as { properties?: GuardNodeShape[] }).properties ?? [];
      const objectProperties =
        (unwrapGuardChain(value) as unknown as { properties?: GuardNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === undefined) {
          collectGuardPatternBindingNames(prop.value, out);
          continue;
        }
        const sourceProp = objectProperties.find(
          (candidate) =>
            candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
        );
        collectGuardMaybeEvalAliasNamesFromPatternValue(prop.value, sourceProp?.value, ctx, out);
      }
      return;
    }
    if (isGlobalObjectExpression(value, ctx)) {
      const props = (pat as unknown as { properties?: GuardNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === 'eval' || key === undefined) collectGuardPatternBindingNames(prop.value, out);
      }
    } else if (!isKnownObjectOrArrayLiteral(value)) {
      collectGuardMaybeEvalAliasNamesFromDefaults(pat, ctx, out);
    }
  } else if (pat.type === 'ArrayPattern') {
    const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapGuardChain(value) as GuardNodeShape).type === 'ArrayExpression'
    ) {
      const values =
        (unwrapGuardChain(value) as unknown as { elements?: unknown[] }).elements ?? [];
      for (let i = 0; i < patterns.length; i++) {
        collectGuardMaybeEvalAliasNamesFromPatternValue(patterns[i], values[i], ctx, out);
      }
    } else if (!isKnownObjectOrArrayLiteral(value)) {
      collectGuardPatternBindingNames(pat, out);
      collectGuardMaybeEvalAliasNamesFromDefaults(pat, ctx, out);
    }
  }
}

function collectGuardMaybeFunctionAliasNamesFromPatternValue(
  pattern: unknown,
  value: unknown,
  ctx: EsmFunctionGuardCtx,
  out: Set<string>,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as GuardNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    if (name && guardExpressionMayBeHostFunction(value, ctx)) out.add(name);
    return;
  }
  if (pat.type === 'AssignmentPattern') {
    collectGuardMaybeFunctionAliasNamesFromPatternValue(
      pat.left,
      value === undefined ? pat.right : value,
      ctx,
      out,
    );
    return;
  }
  if (pat.type === 'ObjectPattern') {
    if (isGlobalObjectExpression(value, ctx)) {
      const props = (pat as unknown as { properties?: GuardNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === 'Function' || key === undefined) {
          collectGuardPatternBindingNames(prop.value, out);
        }
      }
      return;
    }
    if (!value || typeof value !== 'object') return;
    const object = value as GuardNodeShape;
    if (object.type !== 'ObjectExpression') {
      collectGuardMaybeFunctionAliasNamesFromDefaults(pat, ctx, out);
      return;
    }
    const objectProperties =
      (object as unknown as { properties?: GuardNodeShape[] }).properties ?? [];
    const patternProperties =
      (pat as unknown as { properties?: GuardNodeShape[] }).properties ?? [];
    for (const prop of patternProperties) {
      if (prop.type === 'RestElement') continue;
      const key = staticPropertyKeyName(prop);
      if (key === undefined) continue;
      const sourceProp = objectProperties.find(
        (candidate) =>
          candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
      );
      if (sourceProp) {
        collectGuardMaybeFunctionAliasNamesFromPatternValue(prop.value, sourceProp.value, ctx, out);
      } else if ((prop.value as GuardNodeShape | undefined)?.type === 'AssignmentPattern') {
        collectGuardMaybeFunctionAliasNamesFromPatternValue(prop.value, undefined, ctx, out);
      }
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    if (!value || typeof value !== 'object') return;
    const array = value as GuardNodeShape;
    if (array.type !== 'ArrayExpression') {
      collectGuardMaybeFunctionAliasNamesFromDefaults(pat, ctx, out);
      return;
    }
    const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    const values = (array as unknown as { elements?: unknown[] }).elements ?? [];
    for (let i = 0; i < patterns.length; i++) {
      collectGuardMaybeFunctionAliasNamesFromPatternValue(patterns[i], values[i], ctx, out);
    }
  }
}

function markGuardGlobalAliasesFromPatternDefault(
  pattern: unknown,
  value: unknown,
  ctx: EsmFunctionGuardCtx,
): void {
  if (!isGlobalObjectExpression(value, ctx)) return;
  const targetNames = new Set<string>();
  collectGuardPatternBindingNames(pattern, targetNames);
  for (const name of targetNames) markGuardGlobalAlias(ctx, name);
}

function collectGuardGlobalAliasNamesFromPatternValue(
  pattern: unknown,
  value: unknown,
  ctx: EsmFunctionGuardCtx,
  out: Set<string>,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as GuardNodeShape;
  if (pat.type === 'Identifier') {
    if (isGlobalObjectExpression(value, ctx)) {
      const name = (pat as unknown as { name?: string }).name;
      if (name) out.add(name);
    }
    return;
  }
  if (pat.type === 'AssignmentPattern') {
    collectGuardGlobalAliasNamesFromPatternValue(
      pat.left,
      value === undefined ? pat.right : value,
      ctx,
      out,
    );
    return;
  }
  if (pat.type === 'ObjectPattern') {
    if (!value || typeof value !== 'object') return;
    const object = value as GuardNodeShape;
    if (object.type !== 'ObjectExpression') {
      collectGuardGlobalAliasNamesFromDefaults(pat, ctx, out);
      return;
    }
    const objectProperties =
      (object as unknown as { properties?: GuardNodeShape[] }).properties ?? [];
    const patternProperties =
      (pat as unknown as { properties?: GuardNodeShape[] }).properties ?? [];
    for (const prop of patternProperties) {
      if (prop.type === 'RestElement') continue;
      const key = staticPropertyKeyName(prop);
      if (key === undefined) continue;
      const sourceProp = objectProperties.find(
        (candidate) =>
          candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
      );
      if (sourceProp) {
        collectGuardGlobalAliasNamesFromPatternValue(prop.value, sourceProp.value, ctx, out);
      } else if ((prop.value as GuardNodeShape | undefined)?.type === 'AssignmentPattern') {
        collectGuardGlobalAliasNamesFromPatternValue(prop.value, undefined, ctx, out);
      }
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    if (!value || typeof value !== 'object') return;
    const array = value as GuardNodeShape;
    if (array.type !== 'ArrayExpression') {
      collectGuardGlobalAliasNamesFromDefaults(pat, ctx, out);
      return;
    }
    const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    const values = (array as unknown as { elements?: unknown[] }).elements ?? [];
    for (let i = 0; i < patterns.length; i++) {
      collectGuardGlobalAliasNamesFromPatternValue(patterns[i], values[i], ctx, out);
    }
  }
}

function isKnownObjectOrArrayLiteral(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as GuardNodeShape;
  return n.type === 'ObjectExpression' || n.type === 'ArrayExpression';
}

function collectGuardGlobalAliasNamesFromDefaults(
  pattern: unknown,
  ctx: EsmFunctionGuardCtx,
  out: Set<string>,
): void {
  collectGuardAliasNamesFromDefaults(pattern, ctx, out, isGlobalObjectExpression);
}

function collectGuardMaybeFunctionAliasNamesFromDefaults(
  pattern: unknown,
  ctx: EsmFunctionGuardCtx,
  out: Set<string>,
): void {
  collectGuardAliasNamesFromDefaults(pattern, ctx, out, guardExpressionMayBeHostFunction);
}

function collectGuardMaybeDerivedFunctionAliasNamesFromDefaults(
  pattern: unknown,
  ctx: EsmFunctionGuardCtx,
  out: Set<string>,
): void {
  collectGuardAliasNamesFromDefaults(pattern, ctx, out, guardExpressionMayBeDerivedHostFunction);
}

function collectGuardMaybeEvalAliasNamesFromDefaults(
  pattern: unknown,
  ctx: EsmFunctionGuardCtx,
  out: Set<string>,
): void {
  collectGuardAliasNamesFromDefaults(pattern, ctx, out, guardExpressionMayBeGlobalEval);
}

function collectGuardAliasNamesFromDefaults(
  pattern: unknown,
  ctx: EsmFunctionGuardCtx,
  out: Set<string>,
  predicate: (node: unknown, ctx: EsmFunctionGuardCtx) => boolean,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as GuardNodeShape;
  if (pat.type === 'AssignmentPattern') {
    if (predicate(pat.right, ctx)) collectGuardPatternBindingNames(pat.left, out);
    collectGuardAliasNamesFromDefaults(pat.left, ctx, out, predicate);
    return;
  }
  if (pat.type === 'ObjectPattern') {
    const props = (pat as unknown as { properties?: unknown[] }).properties ?? [];
    for (const prop of props) {
      const p = prop as GuardNodeShape;
      collectGuardAliasNamesFromDefaults(
        p.type === 'RestElement' ? p.argument : p.value,
        ctx,
        out,
        predicate,
      );
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    const elements = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    for (const element of elements)
      collectGuardAliasNamesFromDefaults(element, ctx, out, predicate);
    return;
  }
  if (pat.type === 'RestElement') {
    collectGuardAliasNamesFromDefaults(pat.argument, ctx, out, predicate);
  }
}

function collectGuardPatternBindingNames(pattern: unknown, out: Set<string>): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as GuardNodeShape;
  switch (pat.type) {
    case 'Identifier': {
      const name = (pat as unknown as { name?: string }).name;
      if (name) out.add(name);
      return;
    }
    case 'ObjectPattern': {
      const props = (pat as unknown as { properties?: unknown[] }).properties ?? [];
      for (const prop of props) {
        const p = prop as GuardNodeShape;
        collectGuardPatternBindingNames(p.type === 'RestElement' ? p.argument : p.value, out);
      }
      return;
    }
    case 'ArrayPattern': {
      const elements = (pat as unknown as { elements?: unknown[] }).elements ?? [];
      for (const element of elements) collectGuardPatternBindingNames(element, out);
      return;
    }
    case 'RestElement':
      collectGuardPatternBindingNames(pat.argument, out);
      return;
    case 'AssignmentPattern':
      collectGuardPatternBindingNames(pat.left, out);
      return;
    default:
      return;
  }
}

function isGlobalObjectExpression(node: unknown, ctx: EsmFunctionGuardCtx): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as GuardNodeShape;
  if (n.type !== 'Identifier') return false;
  const name = (n as unknown as { name?: string }).name;
  if ((name === 'globalThis' || name === 'global') && !isGuardShadowed(ctx, name)) return true;
  return typeof name === 'string' && isGuardGlobalAlias(ctx, name);
}

function isGlobalFunctionReadMember(node: GuardNodeShape, ctx: EsmFunctionGuardCtx): boolean {
  return isGlobalObjectExpression(node.object, ctx) && staticPropertyName(node) === 'Function';
}

function isGlobalFunctionWriteMember(node: GuardNodeShape, ctx: EsmFunctionGuardCtx): boolean {
  if (!isGlobalObjectExpression(node.object, ctx)) return false;
  const propertyName = staticPropertyName(node);
  return propertyName === 'Function' || (propertyName === undefined && isComputedMember(node));
}

function guardExpressionMayBeHostFunction(node: unknown, ctx: EsmFunctionGuardCtx): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as GuardNodeShape;
  if (n.type === 'Identifier') {
    const name = (n as unknown as { name?: string }).name;
    return typeof name === 'string' && isGuardMaybeFunctionAlias(ctx, name);
  }
  if (n.type === 'CallExpression' && isReflectGetFunctionCall(n, ctx)) return true;
  return n.type === 'MemberExpression' && isGlobalFunctionUnknownReadMember(n, ctx);
}

function guardExpressionMayBeDerivedHostFunction(node: unknown, ctx: EsmFunctionGuardCtx): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapGuardChain(node) as GuardNodeShape;
  if (n.type === 'Identifier') {
    const name = (n as unknown as { name?: string }).name;
    return typeof name === 'string' && isGuardMaybeDerivedFunctionAlias(ctx, name);
  }
  if (n.type === 'CallExpression' && isReflectGetDerivedFunctionConstructorCall(n, ctx)) {
    return true;
  }
  return n.type === 'MemberExpression' && staticPropertyName(n) === 'constructor';
}

function guardExpressionMayHaveHostFunctionConstructor(node: unknown): boolean {
  if (!node || typeof node !== 'object') return true;
  const n = unwrapGuardChain(node) as GuardNodeShape;
  return (
    n.type !== 'Literal' &&
    n.type !== 'TemplateLiteral' &&
    n.type !== 'ObjectExpression' &&
    n.type !== 'ArrayExpression'
  );
}

function isReflectGetFunctionCall(node: GuardNodeShape, ctx: EsmFunctionGuardCtx): boolean {
  const call = node as unknown as { callee?: GuardNodeShape; arguments?: unknown[] };
  const callee = call.callee;
  const args = call.arguments ?? [];
  if (!callee || callee.type !== 'MemberExpression') return false;
  const calleeMember = callee as unknown as { object?: GuardNodeShape };
  const object = calleeMember.object;
  const objectName =
    object?.type === 'Identifier' ? (object as unknown as { name?: string }).name : undefined;
  if (
    objectName !== 'Reflect' ||
    isGuardShadowed(ctx, 'Reflect') ||
    staticPropertyName(callee) !== 'get'
  ) {
    return false;
  }
  if (!isGlobalObjectExpression(args[0], ctx)) return false;
  return propertyMayBeFunction(args[1]);
}

function isReflectGetDerivedFunctionConstructorCall(
  node: GuardNodeShape,
  ctx: EsmFunctionGuardCtx,
): boolean {
  const call = node as unknown as { callee?: GuardNodeShape; arguments?: unknown[] };
  const callee = unwrapGuardChain(call.callee) as GuardNodeShape | undefined;
  const args = call.arguments ?? [];
  if (!callee || callee.type !== 'MemberExpression') return false;
  const calleeMember = callee as unknown as { object?: GuardNodeShape };
  const object = unwrapGuardChain(calleeMember.object) as GuardNodeShape | undefined;
  const objectName =
    object?.type === 'Identifier' ? (object as unknown as { name?: string }).name : undefined;
  if (
    objectName !== 'Reflect' ||
    isGuardShadowed(ctx, 'Reflect') ||
    staticPropertyName(callee) !== 'get'
  ) {
    return false;
  }
  return (
    propertyMayBeConstructor(args[1]) && guardExpressionMayHaveHostFunctionConstructor(args[0])
  );
}

function isReflectDerivedFunctionConstructorCall(
  node: GuardNodeShape,
  ctx: EsmFunctionGuardCtx,
): boolean {
  const call = node as unknown as { callee?: GuardNodeShape; arguments?: unknown[] };
  const callee = unwrapGuardChain(call.callee) as GuardNodeShape | undefined;
  const args = call.arguments ?? [];
  if (!callee || callee.type !== 'MemberExpression') return false;
  const calleeMember = callee as unknown as { object?: GuardNodeShape };
  const object = unwrapGuardChain(calleeMember.object) as GuardNodeShape | undefined;
  const objectName =
    object?.type === 'Identifier' ? (object as unknown as { name?: string }).name : undefined;
  if (objectName !== 'Reflect' || isGuardShadowed(ctx, 'Reflect')) return false;
  const propertyName = staticPropertyName(callee);
  if (propertyName === 'apply') {
    return (
      guardExpressionMayBeDerivedHostFunction(args[0], ctx) && constructorArgArrayMayImport(args[2])
    );
  }
  if (propertyName === 'construct') {
    return (
      guardExpressionMayBeDerivedHostFunction(args[0], ctx) && constructorArgArrayMayImport(args[1])
    );
  }
  return false;
}

function guardCalleeMayBeHostFunction(node: unknown, ctx: EsmFunctionGuardCtx): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as GuardNodeShape;
  if (guardExpressionMayBeHostFunction(n, ctx)) return true;
  if (n.type !== 'MemberExpression') return false;
  const member = n as unknown as { object?: unknown };
  if (!member.object || !guardExpressionMayBeHostFunction(member.object, ctx)) return false;
  const propertyName = staticPropertyName(n);
  return propertyName === 'call' || propertyName === 'apply' || propertyName === 'bind';
}

function guardCalleeMayBeDerivedHostFunction(node: unknown, ctx: EsmFunctionGuardCtx): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapGuardChain(node) as GuardNodeShape;
  if (guardExpressionMayBeDerivedHostFunction(n, ctx)) return true;
  if (n.type !== 'MemberExpression') return false;
  const member = n as unknown as { object?: unknown };
  if (!member.object || !guardExpressionMayBeDerivedHostFunction(member.object, ctx)) return false;
  const propertyName = staticPropertyName(n);
  return propertyName === 'call' || propertyName === 'apply' || propertyName === 'bind';
}

function constructorArgsMayImport(args: readonly unknown[]): boolean {
  return args.some((arg) => {
    const source = literalString(arg);
    return source !== undefined && /\bimport\b/.test(source);
  });
}

function constructorArgArrayMayImport(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapGuardChain(node) as GuardNodeShape;
  if (n.type !== 'ArrayExpression') return false;
  const elements = (n as unknown as { elements?: unknown[] }).elements ?? [];
  return constructorArgsMayImport(elements);
}

function guardExpressionMayBeGlobalEval(node: unknown, ctx: EsmFunctionGuardCtx): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapGuardChain(node) as GuardNodeShape;
  if (n.type === 'Identifier') {
    const name = (n as unknown as { name?: string }).name;
    return name === 'eval' || (typeof name === 'string' && isGuardMaybeEvalAlias(ctx, name));
  }
  return n.type === 'MemberExpression' && isGlobalEvalCallMember(n, ctx);
}

function guardCalleeMayBeEval(node: unknown, ctx: EsmFunctionGuardCtx): boolean {
  return guardExpressionMayBeGlobalEval(node, ctx);
}

function isGlobalFunctionUnknownReadMember(
  node: GuardNodeShape,
  ctx: EsmFunctionGuardCtx,
): boolean {
  return (
    isGlobalObjectExpression(node.object, ctx) &&
    staticPropertyName(node) === undefined &&
    isComputedMember(node)
  );
}

function isGlobalEvalReadMember(node: GuardNodeShape, ctx: EsmFunctionGuardCtx): boolean {
  return isGlobalObjectExpression(node.object, ctx) && staticPropertyName(node) === 'eval';
}

function isGlobalEvalCallMember(node: GuardNodeShape, ctx: EsmFunctionGuardCtx): boolean {
  if (!isGlobalObjectExpression(node.object, ctx)) return false;
  const propertyName = staticPropertyName(node);
  return propertyName === 'eval' || (propertyName === undefined && isComputedMember(node));
}

function isGlobalFunctionMutationCall(node: GuardNodeShape, ctx: EsmFunctionGuardCtx): boolean {
  const call = node as unknown as { callee?: GuardNodeShape; arguments?: unknown[] };
  const callee = call.callee;
  const args = call.arguments ?? [];
  if (!callee || callee.type !== 'MemberExpression') return false;
  const calleeMember = callee as unknown as { object?: GuardNodeShape };
  const object = calleeMember.object;
  const objectName =
    object?.type === 'Identifier' ? (object as unknown as { name?: string }).name : undefined;
  const propertyName = staticPropertyName(callee);
  const isBuiltinObject = objectName === 'Object' && !isGuardShadowed(ctx, 'Object');
  const isBuiltinReflect = objectName === 'Reflect' && !isGuardShadowed(ctx, 'Reflect');

  if (isBuiltinObject && propertyName === 'assign' && isGlobalObjectExpression(args[0], ctx)) {
    return args.slice(1).some((arg) => objectMayContainFunctionKey(arg));
  }

  const isObjectDefine =
    isBuiltinObject && (propertyName === 'defineProperty' || propertyName === 'defineProperties');
  const isReflectMutation =
    isBuiltinReflect &&
    (propertyName === 'defineProperty' ||
      propertyName === 'set' ||
      propertyName === 'deleteProperty');
  if ((isObjectDefine || isReflectMutation) && isGlobalObjectExpression(args[0], ctx)) {
    if (propertyName === 'defineProperties') {
      return objectMayContainFunctionKey(args[1]);
    }
    return propertyMayBeFunction(args[1]);
  }

  if (
    isGlobalObjectExpression(object, ctx) &&
    (propertyName === '__defineGetter__' || propertyName === '__defineSetter__')
  ) {
    return propertyMayBeFunction(args[0]);
  }

  return false;
}

function propertyMayBeFunction(node: unknown): boolean {
  const value = literalString(node);
  return value === 'Function' || value === undefined;
}

function propertyMayBeConstructor(node: unknown): boolean {
  const value = literalString(node);
  return value === 'constructor' || value === undefined;
}

function objectMayContainFunctionKey(node: unknown): boolean {
  if (!node || typeof node !== 'object') return true;
  const object = node as GuardNodeShape;
  if (object.type !== 'ObjectExpression') return true;
  const properties = (object as unknown as { properties?: GuardNodeShape[] }).properties ?? [];
  return properties.some((property) => {
    if (property.type === 'SpreadElement') return true;
    const key = staticPropertyKeyName(property);
    return key === 'Function' || key === undefined;
  });
}

function staticPropertyName(node: GuardNodeShape): string | undefined {
  const n = unwrapGuardChain(node) as GuardNodeShape;
  const member = n as unknown as { computed?: boolean; property?: GuardNodeShape };
  const property = member.property;
  if (!property) return undefined;
  if (!member.computed && property.type === 'Identifier') {
    return (property as unknown as { name?: string }).name;
  }
  return member.computed ? literalString(property) : undefined;
}

function isComputedMember(node: GuardNodeShape): boolean {
  return Boolean((unwrapGuardChain(node) as unknown as { computed?: boolean }).computed);
}

function staticPropertyKeyName(node: GuardNodeShape): string | undefined {
  const property = node as unknown as { computed?: boolean; key?: GuardNodeShape };
  const key = property.key;
  if (!key) return undefined;
  if (!property.computed && key.type === 'Identifier') {
    return (key as unknown as { name?: string }).name;
  }
  return literalString(key);
}

function literalString(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = unwrapGuardChain(node) as GuardNodeShape;
  if (n.type === 'Literal') {
    const value = (n as unknown as { value?: unknown }).value;
    return typeof value === 'string' ? value : undefined;
  }
  if (n.type === 'BinaryExpression' && (n as unknown as { operator?: string }).operator === '+') {
    const left = literalString(n.left);
    const right = literalString(n.right);
    return left !== undefined && right !== undefined ? left + right : undefined;
  }
  if (n.type === 'TemplateLiteral') {
    const expressions = (n as unknown as { expressions?: unknown[] }).expressions ?? [];
    if (expressions.length > 0) return undefined;
    const quasis = (n as unknown as { quasis?: GuardNodeShape[] }).quasis ?? [];
    return quasis
      .map((quasi) => {
        const value = quasi.value as { cooked?: unknown } | undefined;
        return typeof value?.cooked === 'string' ? value.cooked : '';
      })
      .join('');
  }
  return undefined;
}

function unwrapGuardChain(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  const n = node as GuardNodeShape;
  if (n.type === 'ChainExpression') return unwrapGuardChain(n.expression);
  if (n.type === 'SequenceExpression') {
    const expressions = (n as unknown as { expressions?: unknown[] }).expressions ?? [];
    return unwrapGuardChain(expressions[expressions.length - 1]);
  }
  return node;
}

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
  assertNoEsmFunctionRoutingCeiling(source, resolved.id);

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
  const __importMetaUrl = fileURLFromResolvedPath(resolved.id).href;

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
    Function: FunctionConstructor,
  ) => Promise<void>;
  try {
    const helper = transformed.helpers;
    factory = new Function(
      helper.dynamicImport,
      helper.importStatic,
      helper.slots,
      '__resolveStatic',
      helper.rebuildExports,
      helper.importMetaUrl,
      helper.metaDirname,
      helper.metaFilename,
      helper.assetPath,
      helper.metaResolve,
      'Function',
      // Bind the genuine global `Object` to a mangled name at FUNCTION scope
      // (`new Function` body runs in global scope), outside the user-body arrow.
      // The generated body reaches its export `Object.defineProperty`/`Object.keys`
      // machinery through this binding (esm-ast.ts RUNTIME_OBJECT_BINDING), so a
      // module shadowing the global with `export const Object = …` (opencode's
      // config/permission.ts) can't break codegen. ESM is always strict: the
      // directive keeps top-level `this` and bare-call receivers faithful. Kept
      // on the `return` line so body line numbering (snippetForBody) is unchanged.
      `"use strict"; const ${helper.runtimeObject} = Object; return (async () => {\nconst ${helper.importMeta} = { url: ${helper.importMetaUrl}, dirname: ${helper.metaDirname}, filename: ${helper.metaFilename}, resolve: ${helper.metaResolve} };\n${transformed.body}\n})();\n//# sourceURL=${resolved.id}`,
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
  // (ADR-0152; review M2). `keepaliveRef()` runs synchronously
  // at call time (before the first await), so the ref is held the instant user
  // code invokes `import()`. finally unrefs on both resolve and reject.
  const dynamicImport = async (spec: unknown): Promise<Record<string, unknown>> => {
    keepaliveRef();
    try {
      const dep = deps.resolve(toDynamicImportSpecifier(spec), resolved.id, true);
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
    if (hasURLScheme(spec, 'node')) return spec;
    const dep = deps.resolve(spec, resolved.id, true);
    return dep.kind === 'builtin' ? dep.id : fileURLFromResolvedPath(dep.id).href;
  };
  const routedConstructors = createFunctionImportRouting(dynamicImport, resolved.id);

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
        routedConstructors.Function,
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

function toDynamicImportSpecifier(specifier: unknown): string {
  if (typeof specifier === 'symbol') {
    throw new TypeError('Cannot convert a Symbol value to a string');
  }
  return String(specifier);
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
