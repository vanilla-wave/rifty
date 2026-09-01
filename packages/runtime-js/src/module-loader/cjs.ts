import { NotImplementedError } from '@riftydev/io';
import { basename, dirname, joinPath } from '@riftydev/vfs';
import type { ImportExpression, Program } from 'acorn';
import { parse as acornParse } from 'acorn';
import { ref as keepaliveRef, unref as keepaliveUnref } from '../internal/event-loop-keepalive.ts';
import { type Edit, applyEdits, uniqueHelperName } from './cjs-source-rewrite.ts';
import { ModuleLoadError } from './errors.ts';
import { createFunctionImportRouting } from './function-import-routing.ts';
import type { CjsModule, ModuleRecord, ModuleRegistry } from './registry.ts';
import type { ResolvedModule } from './resolver.ts';
import type { Resolver } from './resolver.ts';

const jsonStringifyPrimordial = JSON.stringify;
const objectDefinePropertyPrimordial = Object.defineProperty;
const reflectApplyPrimordial = Reflect.apply;
const stringEndsWithPrimordial = String.prototype.endsWith;
const stringIndexOfPrimordial = String.prototype.indexOf;
const stringLastIndexOfPrimordial = String.prototype.lastIndexOf;
const stringSlicePrimordial = String.prototype.slice;
const TypeErrorConstructor = TypeError;

function stringEndsWith(value: string, suffix: string): boolean {
  return reflectApplyPrimordial(stringEndsWithPrimordial, value, [suffix]) as boolean;
}

function stringIndexOf(value: string, search: string, fromIndex: number): number {
  return reflectApplyPrimordial(stringIndexOfPrimordial, value, [search, fromIndex]) as number;
}

function stringLastIndexOf(value: string, search: string): number {
  return reflectApplyPrimordial(stringLastIndexOfPrimordial, value, [search]) as number;
}

function stringSlice(value: string, start: number): string {
  return reflectApplyPrimordial(stringSlicePrimordial, value, [start]) as string;
}

/**
 * Reject a `.ts`/`.tsx`/`.jsx` that reached the CJS path with a directed
 * {@link NotImplementedError}, instead of feeding raw TS to `new Function`
 * (opaque `SyntaxError: Unexpected token`).
 *
 * The caller-injected TS/JSX transform hook is async (ADR-0052 D1 alt-C);
 * synchronous `require()` cannot await it, so a `.ts`/`.tsx`/`.jsx` in a
 * non-`type:module` scope is unsupported. In a `type:module` scope it loads as
 * ESM via `import()` where the async transform runs. Registered in
 * `docs/public/compat/modules.md` as not-supported.
 */
function assertNotTsCjs(id: string): void {
  if (stringEndsWith(id, '.ts') || stringEndsWith(id, '.tsx') || stringEndsWith(id, '.jsx')) {
    throw new NotImplementedError(
      'module-loader.ts-via-require',
      `require() of ${id} (TypeScript/JSX) is not supported: source transforms are async, so a synchronous require() cannot invoke one. A .ts/.tsx/.jsx is only loadable when its package scope is type:module (loads as ESM via import()).`,
    );
  }
}

export interface CjsLoaderDeps {
  readonly registry: ModuleRegistry;
  readonly resolver: Resolver;
  /** Loader-owned mutable table shared by local require and createRequire. */
  readonly extensions: CjsExtensions;
  /** Loader-owned `.js` identity; replacements own unregistered suffixes. */
  readonly defaultJsExtension: CjsExtensionHook;
  readonly WebAssembly: typeof WebAssembly;
  /** Create a require bound to `fromFile`, including the shared extensions table. */
  makeRequire(fromFile: string, parent?: CjsModule): CjsRequire;
  /**
   * Load any module synchronously by resolved id. ESM may return a namespace,
   * a synthetic default facade, or the exact `"module.exports"` binding.
   */
  loadSync(resolved: ResolvedModule, parent?: CjsModule): unknown;
  loadAsync(id: string): Promise<Record<string, unknown>>;
  resolve(specifier: string, fromFile: string, esm: boolean): ResolvedModule;
}

export type CjsExtensionHook = (this: CjsExtensions, module: CjsModule, filename: string) => void;
export type CjsExtensions = Record<string, CjsExtensionHook>;

export type CjsRequire = ((specifier: string) => unknown) & {
  resolve(specifier: string): string;
  cache: Record<string, unknown>;
  extensions: CjsExtensions;
  main: undefined;
};

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

interface AnyNodeShape {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

interface Scope {
  readonly bindings: Set<string>;
  readonly globalAliases: Set<string>;
  readonly maybeFunctionAliases: Set<string>;
  readonly maybeDerivedFunctionAliases: Set<string>;
  readonly maybeEvalAliases: Set<string>;
}

interface FunctionRewriteCtx {
  readonly edits: Edit[];
  readonly scopes: Scope[];
  readonly functionHelperName: string;
  readonly webAssemblyHelperName: string;
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
  /\bFunction\b|\bWebAssembly\b|\bconstructor\b|\bglobalThis\b|\bglobal\b|\bObject\b|\bReflect\b|__define(?:Getter|Setter)__|\beval\b|\bwith\b/;

function rewriteDynamicImports(source: string, id: string, helperName: string): string {
  if (!/\bimport\b/.test(source)) return source;
  let program: Program;
  try {
    program = acornParse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      allowHashBang: true,
      locations: false,
    }) as Program;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    throw new ModuleLoadError(
      'SYNTAX_ERROR',
      id,
      `Failed to parse CJS source for ${id}: ${msg}`,
      id,
    );
  }

  const edits: Edit[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as AnyNodeShape;
    if (typeof n.type !== 'string') return;
    if (n.type === 'ImportExpression') {
      const ie = n as unknown as ImportExpression;
      edits.push({
        start: ie.start,
        end: ie.start + 'import'.length,
        text: helperName,
      });
      walk(ie.source);
      if (ie.options) walk(ie.options);
      return;
    }
    for (const key of Object.keys(n)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
        continue;
      }
      const value = n[key];
      if (!value) continue;
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
      } else if (typeof value === 'object') {
        walk(value);
      }
    }
  };

  walk(program);
  if (edits.length === 0) return source;
  return applyEdits(source, edits);
}

function rewriteCjsFunctionConstructorReferences(
  source: string,
  id: string,
  functionHelperName: string,
  webAssemblyHelperName: string,
): string {
  if (!functionRoutingAnalysisToken.test(source)) return source;
  let program: Program;
  try {
    program = acornParse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      allowHashBang: true,
      locations: false,
    }) as Program;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    throw new ModuleLoadError(
      'SYNTAX_ERROR',
      id,
      `Failed to parse CJS source for ${id}: ${msg}`,
      id,
    );
  }

  const rootScope = createScope();
  predeclareFunctionScope(program.body as unknown as AnyNodeShape[], rootScope);
  predeclareLexicalScope(program.body as unknown as AnyNodeShape[], rootScope);
  const ctx: FunctionRewriteCtx = {
    edits: [],
    scopes: [rootScope],
    functionHelperName,
    webAssemblyHelperName,
    hasGlobalFunctionWrite: false,
    hasDynamicFunctionScope: false,
    hasWithDynamicFunctionScope: false,
    hasDerivedHostFunctionConstructor: false,
    hasRoutedFunctionReference: false,
    hasFunctionEvalText: false,
  };
  walkFunctionReferences(program as unknown as AnyNodeShape, ctx);
  if (ctx.hasDerivedHostFunctionConstructor) {
    throw new NotImplementedError(
      'module-loader.function-constructor-derived-host',
      `CJS module ${id} compiles import()-bearing source through a derived host Function constructor; rifty cannot route that constructor without mutating the host Function prototype, so this module is an explicit ceiling`,
    );
  }
  if (
    ctx.hasFunctionEvalText ||
    (ctx.hasWithDynamicFunctionScope && ctx.hasRoutedFunctionReference)
  ) {
    throw new NotImplementedError(
      'module-loader.cjs-dynamic-function-scope',
      `CJS module ${id} contains literal eval Function/import text or combines routed Function with with dynamic scope; rifty cannot statically preserve Node's dynamic binding semantics, so this module is an explicit ceiling`,
    );
  }
  if (ctx.hasGlobalFunctionWrite) {
    throw new NotImplementedError(
      'module-loader.cjs-global-function-assignment',
      `CJS module ${id} assigns the global Function binding; rifty cannot emulate that without mutating the host constructor, so this module is an explicit ceiling`,
    );
  }
  if (ctx.edits.length === 0) return source;
  return applyEdits(source, ctx.edits);
}

function createScope(): Scope {
  return {
    bindings: new Set(),
    globalAliases: new Set(),
    maybeFunctionAliases: new Set(),
    maybeDerivedFunctionAliases: new Set(),
    maybeEvalAliases: new Set(),
  };
}

function pushScope(ctx: FunctionRewriteCtx, scope: Scope = createScope()): void {
  ctx.scopes.push(scope);
}

function popScope(ctx: FunctionRewriteCtx): void {
  ctx.scopes.pop();
}

function addBinding(scope: Scope, name: string | undefined): void {
  if (!name) return;
  scope.bindings.add(name);
  scope.globalAliases.delete(name);
  scope.maybeFunctionAliases.delete(name);
  scope.maybeDerivedFunctionAliases.delete(name);
  scope.maybeEvalAliases.delete(name);
}

function isShadowed(ctx: FunctionRewriteCtx, name: string): boolean {
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    if (ctx.scopes[i]?.bindings.has(name)) return true;
  }
  return false;
}

function topScope(ctx: FunctionRewriteCtx): Scope {
  const scope = ctx.scopes[ctx.scopes.length - 1];
  if (!scope) throw new Error('internal: missing CJS rewrite scope');
  return scope;
}

function markGlobalAlias(ctx: FunctionRewriteCtx, name: string | undefined): void {
  if (!name) return;
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.globalAliases.add(name);
    return;
  }
  ctx.scopes[0]?.globalAliases.add(name);
}

function unmarkGlobalAlias(ctx: FunctionRewriteCtx, name: string | undefined): void {
  if (!name) return;
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.globalAliases.delete(name);
    return;
  }
  ctx.scopes[0]?.globalAliases.delete(name);
}

function isGlobalAlias(ctx: FunctionRewriteCtx, name: string): boolean {
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    return scope.globalAliases.has(name);
  }
  return Boolean(ctx.scopes[0]?.globalAliases.has(name));
}

function markMaybeFunctionAlias(ctx: FunctionRewriteCtx, name: string | undefined): void {
  if (!name) return;
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.maybeFunctionAliases.add(name);
    return;
  }
  ctx.scopes[0]?.maybeFunctionAliases.add(name);
}

function unmarkMaybeFunctionAlias(ctx: FunctionRewriteCtx, name: string | undefined): void {
  if (!name) return;
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.maybeFunctionAliases.delete(name);
    return;
  }
  ctx.scopes[0]?.maybeFunctionAliases.delete(name);
}

function isMaybeFunctionAlias(ctx: FunctionRewriteCtx, name: string): boolean {
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    return scope.maybeFunctionAliases.has(name);
  }
  return Boolean(ctx.scopes[0]?.maybeFunctionAliases.has(name));
}

function markMaybeDerivedFunctionAlias(ctx: FunctionRewriteCtx, name: string | undefined): void {
  if (!name) return;
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.maybeDerivedFunctionAliases.add(name);
    return;
  }
  ctx.scopes[0]?.maybeDerivedFunctionAliases.add(name);
}

function unmarkMaybeDerivedFunctionAlias(ctx: FunctionRewriteCtx, name: string | undefined): void {
  if (!name) return;
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.maybeDerivedFunctionAliases.delete(name);
    return;
  }
  ctx.scopes[0]?.maybeDerivedFunctionAliases.delete(name);
}

function isMaybeDerivedFunctionAlias(ctx: FunctionRewriteCtx, name: string): boolean {
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    return scope.maybeDerivedFunctionAliases.has(name);
  }
  return Boolean(ctx.scopes[0]?.maybeDerivedFunctionAliases.has(name));
}

function markMaybeEvalAlias(ctx: FunctionRewriteCtx, name: string | undefined): void {
  if (!name) return;
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.maybeEvalAliases.add(name);
    return;
  }
  ctx.scopes[0]?.maybeEvalAliases.add(name);
}

function unmarkMaybeEvalAlias(ctx: FunctionRewriteCtx, name: string | undefined): void {
  if (!name) return;
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.maybeEvalAliases.delete(name);
    return;
  }
  ctx.scopes[0]?.maybeEvalAliases.delete(name);
}

function isMaybeEvalAlias(ctx: FunctionRewriteCtx, name: string): boolean {
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const scope = ctx.scopes[i];
    if (!scope?.bindings.has(name)) continue;
    return scope.maybeEvalAliases.has(name);
  }
  return Boolean(ctx.scopes[0]?.maybeEvalAliases.has(name));
}

function declarePattern(scope: Scope, pattern: unknown): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  switch (pat.type) {
    case 'Identifier':
      addBinding(scope, (pat as unknown as { name?: string }).name);
      return;
    case 'ObjectPattern': {
      const props = (pat as unknown as { properties?: unknown[] }).properties ?? [];
      for (const prop of props) {
        const p = prop as AnyNodeShape;
        if (p.type === 'RestElement') declarePattern(scope, p.argument);
        else declarePattern(scope, p.value);
      }
      return;
    }
    case 'ArrayPattern': {
      const elements = (pat as unknown as { elements?: unknown[] }).elements ?? [];
      for (const element of elements) declarePattern(scope, element);
      return;
    }
    case 'RestElement':
      declarePattern(scope, pat.argument);
      return;
    case 'AssignmentPattern':
      declarePattern(scope, pat.left);
      return;
    default:
      return;
  }
}

function declareVariable(scope: Scope, node: AnyNodeShape): void {
  const declarations = (node as unknown as { declarations?: unknown[] }).declarations ?? [];
  for (const decl of declarations) {
    declarePattern(scope, (decl as AnyNodeShape).id);
  }
}

function predeclareFunctionScope(body: readonly AnyNodeShape[], scope: Scope): void {
  for (const node of body) collectFunctionScopeBindings(node, scope);
}

function collectFunctionScopeBindings(node: unknown, scope: Scope): void {
  if (!node || typeof node !== 'object') return;
  const n = node as AnyNodeShape;
  if (typeof n.type !== 'string') return;

  switch (n.type) {
    case 'FunctionDeclaration':
      addBinding(scope, (n.id as { name?: string } | undefined)?.name);
      return;
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ClassExpression':
      return;
    case 'ClassDeclaration':
      return;
    case 'VariableDeclaration':
      if ((n as unknown as { kind?: string }).kind === 'var') declareVariable(scope, n);
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
          for (const item of value) collectFunctionScopeBindings(item, scope);
        } else if (typeof value === 'object') {
          collectFunctionScopeBindings(value, scope);
        }
      }
  }
}

function predeclareLexicalScope(body: readonly AnyNodeShape[], scope: Scope): void {
  for (const node of body) {
    if (
      node.type === 'VariableDeclaration' &&
      (node as unknown as { kind?: string }).kind !== 'var'
    ) {
      declareVariable(scope, node);
    } else if (node.type === 'ClassDeclaration' || node.type === 'FunctionDeclaration') {
      addBinding(scope, (node.id as { name?: string } | undefined)?.name);
    }
  }
}

function walkFunctionReferences(node: unknown, ctx: FunctionRewriteCtx): void {
  if (!node || typeof node !== 'object') return;
  const n = node as AnyNodeShape;
  if (typeof n.type !== 'string') return;

  switch (n.type) {
    case 'Program':
      for (const child of (n as unknown as { body: AnyNodeShape[] }).body) {
        walkFunctionReferences(child, ctx);
      }
      return;

    case 'Identifier': {
      const name = (n as unknown as { name?: string }).name;
      if (name === 'eval' && !isShadowed(ctx, name)) {
        ctx.hasDynamicFunctionScope = true;
      }
      if (name === 'Function' && !isShadowed(ctx, name)) {
        ctx.hasRoutedFunctionReference = true;
        ctx.edits.push({ start: n.start, end: n.end, text: ctx.functionHelperName });
      }
      if (name === 'WebAssembly' && !isShadowed(ctx, name)) {
        ctx.edits.push({ start: n.start, end: n.end, text: ctx.webAssemblyHelperName });
      }
      return;
    }

    case 'VariableDeclaration': {
      const declarations = (n as unknown as { declarations?: AnyNodeShape[] }).declarations ?? [];
      for (const decl of declarations) {
        const declId = decl.id as AnyNodeShape | undefined;
        walkPatternExpressions(declId, ctx);
        if (decl.init) walkFunctionReferences(decl.init, ctx);
        if (decl.init) {
          updateGlobalAliasesFromPatternValue(declId, decl.init, ctx);
          updateMaybeFunctionAliasesFromPatternValue(declId, decl.init, ctx);
          updateMaybeDerivedFunctionAliasesFromPatternValue(declId, decl.init, ctx);
          updateMaybeEvalAliasesFromPatternValue(declId, decl.init, ctx);
        }
      }
      return;
    }

    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      walkFunctionNode(n, ctx);
      return;

    case 'BlockStatement':
      walkBlock(n as unknown as { body: AnyNodeShape[] }, ctx);
      return;

    case 'SwitchStatement':
      walkSwitch(n, ctx);
      return;

    case 'ForStatement':
      walkFor(n, ctx);
      return;

    case 'ForInStatement':
    case 'ForOfStatement':
      walkForInOf(n, ctx);
      return;

    case 'CatchClause': {
      pushScope(ctx);
      const param = (n as unknown as { param?: unknown }).param;
      declarePattern(topScope(ctx), param);
      walkPatternExpressions(param, ctx);
      walkFunctionReferences(n.body, ctx);
      popScope(ctx);
      return;
    }

    case 'ClassDeclaration':
    case 'ClassExpression': {
      pushScope(ctx);
      addBinding(topScope(ctx), (n.id as { name?: string } | undefined)?.name);
      if (n.superClass) walkFunctionReferences(n.superClass, ctx);
      walkFunctionReferences(n.body, ctx);
      popScope(ctx);
      return;
    }

    case 'MemberExpression': {
      if (isGlobalFunctionReadMember(n, ctx)) {
        ctx.hasGlobalFunctionWrite = true;
      }
      if (isGlobalEvalReadMember(n, ctx)) {
        ctx.hasDynamicFunctionScope = true;
      }
      walkFunctionReferences(n.object, ctx);
      if ((n as unknown as { computed?: boolean }).computed)
        walkFunctionReferences(n.property, ctx);
      return;
    }

    case 'Property': {
      const p = n as unknown as {
        computed?: boolean;
        key?: unknown;
        shorthand?: boolean;
        value?: AnyNodeShape;
      };
      if (p.computed) walkFunctionReferences(p.key, ctx);
      if (p.shorthand && p.value?.type === 'Identifier') {
        const name = (p.value as unknown as { name?: string }).name;
        if (name === 'Function' && !isShadowed(ctx, name)) {
          ctx.hasRoutedFunctionReference = true;
          ctx.edits.push({ start: p.value.start, end: p.value.start, text: 'Function: ' });
        }
        if (name === 'WebAssembly' && !isShadowed(ctx, name)) {
          ctx.edits.push({
            start: p.value.start,
            end: p.value.start,
            text: 'WebAssembly: ',
          });
        }
      }
      walkFunctionReferences(p.value, ctx);
      return;
    }

    case 'MethodDefinition':
    case 'PropertyDefinition': {
      const d = n as unknown as { computed?: boolean; key?: unknown; value?: unknown };
      if (d.computed) walkFunctionReferences(d.key, ctx);
      walkFunctionReferences(d.value, ctx);
      return;
    }

    case 'StaticBlock':
      walkStaticBlock(n as unknown as { body: AnyNodeShape[] }, ctx);
      return;

    case 'AssignmentExpression': {
      walkAssignmentTarget(n.left, ctx);
      walkFunctionReferences(n.right, ctx);
      updateGlobalAliasesFromPatternValue(n.left, n.right, ctx);
      updateMaybeFunctionAliasesFromPatternValue(n.left, n.right, ctx);
      updateMaybeDerivedFunctionAliasesFromPatternValue(n.left, n.right, ctx);
      updateMaybeEvalAliasesFromPatternValue(n.left, n.right, ctx);
      return;
    }

    case 'WithStatement':
      ctx.hasDynamicFunctionScope = true;
      ctx.hasWithDynamicFunctionScope = true;
      walkFunctionReferences(n.object, ctx);
      walkFunctionReferences(n.body, ctx);
      return;

    case 'CallExpression': {
      const callee = n.callee as AnyNodeShape | undefined;
      const args = (n as unknown as { arguments?: unknown[] }).arguments ?? [];
      if (isGlobalFunctionMutationCall(n, ctx)) {
        ctx.hasGlobalFunctionWrite = true;
      }
      if (calleeMayBeHostFunction(callee, ctx)) {
        ctx.hasGlobalFunctionWrite = true;
      }
      if (isReflectDerivedFunctionConstructorCall(n, ctx)) {
        ctx.hasDerivedHostFunctionConstructor = true;
      }
      if (calleeMayBeDerivedHostFunction(callee, ctx) && constructorArgsMayImport(args)) {
        ctx.hasDerivedHostFunctionConstructor = true;
      }
      if (calleeMayBeEval(callee, ctx)) {
        ctx.hasDynamicFunctionScope = true;
        ctx.hasFunctionEvalText = ctx.hasFunctionEvalText || evalArgumentMayTouchFunction(args[0]);
      }
      if (
        callee?.type === 'Identifier' &&
        (callee as unknown as { name?: string }).name === 'eval' &&
        !isShadowed(ctx, 'eval')
      ) {
        ctx.hasDynamicFunctionScope = true;
        ctx.hasFunctionEvalText = ctx.hasFunctionEvalText || evalArgumentMayTouchFunction(args[0]);
      }
      if (callee?.type === 'MemberExpression' && isGlobalEvalCallMember(callee, ctx)) {
        ctx.hasDynamicFunctionScope = true;
        ctx.hasFunctionEvalText = ctx.hasFunctionEvalText || evalArgumentMayTouchFunction(args[0]);
      }
      walkFunctionReferences(callee, ctx);
      for (const arg of args) walkFunctionReferences(arg, ctx);
      return;
    }

    case 'NewExpression': {
      const callee = n.callee as AnyNodeShape | undefined;
      const args = (n as unknown as { arguments?: unknown[] }).arguments ?? [];
      if (calleeMayBeHostFunction(callee, ctx)) {
        ctx.hasGlobalFunctionWrite = true;
      }
      if (calleeMayBeDerivedHostFunction(callee, ctx) && constructorArgsMayImport(args)) {
        ctx.hasDerivedHostFunctionConstructor = true;
      }
      walkFunctionReferences(callee, ctx);
      for (const arg of args) walkFunctionReferences(arg, ctx);
      return;
    }

    case 'UpdateExpression':
      walkAssignmentTarget(n.argument, ctx);
      return;

    case 'UnaryExpression':
      if ((n as unknown as { operator?: string }).operator === 'delete') {
        walkAssignmentTarget(n.argument, ctx);
        return;
      }
      walkDefaultForFunctionReferences(n, ctx);
      return;

    case 'LabeledStatement':
      walkFunctionReferences(n.body, ctx);
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
      walkDefaultForFunctionReferences(n, ctx);
      return;
  }
}

function walkBlock(block: { body: AnyNodeShape[] }, ctx: FunctionRewriteCtx): void {
  pushScope(ctx);
  predeclareLexicalScope(block.body, topScope(ctx));
  for (const child of block.body) walkFunctionReferences(child, ctx);
  popScope(ctx);
}

function walkSwitch(node: AnyNodeShape, ctx: FunctionRewriteCtx): void {
  walkFunctionReferences(node.discriminant, ctx);
  pushScope(ctx);
  const cases = (node as unknown as { cases?: AnyNodeShape[] }).cases ?? [];
  const consequentBody: AnyNodeShape[] = [];
  for (const switchCase of cases) {
    const consequent = (switchCase as unknown as { consequent?: AnyNodeShape[] }).consequent ?? [];
    consequentBody.push(...consequent);
  }
  predeclareLexicalScope(consequentBody, topScope(ctx));
  for (const switchCase of cases) {
    walkFunctionReferences(switchCase.test, ctx);
    const consequent = (switchCase as unknown as { consequent?: AnyNodeShape[] }).consequent ?? [];
    for (const child of consequent) walkFunctionReferences(child, ctx);
  }
  popScope(ctx);
}

function walkStaticBlock(block: { body: AnyNodeShape[] }, ctx: FunctionRewriteCtx): void {
  pushScope(ctx);
  predeclareFunctionScope(block.body, topScope(ctx));
  predeclareLexicalScope(block.body, topScope(ctx));
  for (const child of block.body) walkFunctionReferences(child, ctx);
  popScope(ctx);
}

function walkFor(node: AnyNodeShape, ctx: FunctionRewriteCtx): void {
  pushScope(ctx);
  const init = node.init as AnyNodeShape | null | undefined;
  if (
    init?.type === 'VariableDeclaration' &&
    (init as unknown as { kind?: string }).kind !== 'var'
  ) {
    declareVariable(topScope(ctx), init);
  }
  walkFunctionReferences(init, ctx);
  walkFunctionReferences(node.test, ctx);
  walkFunctionReferences(node.update, ctx);
  walkFunctionReferences(node.body, ctx);
  popScope(ctx);
}

function walkForInOf(node: AnyNodeShape, ctx: FunctionRewriteCtx): void {
  pushScope(ctx);
  const left = node.left as AnyNodeShape | undefined;
  if (
    left?.type === 'VariableDeclaration' &&
    (left as unknown as { kind?: string }).kind !== 'var'
  ) {
    declareVariable(topScope(ctx), left);
  }
  if (left?.type === 'VariableDeclaration') walkFunctionReferences(left, ctx);
  else walkAssignmentTarget(left, ctx);
  walkFunctionReferences(node.right, ctx);
  walkFunctionReferences(node.body, ctx);
  popScope(ctx);
}

function walkFunctionNode(fn: AnyNodeShape, ctx: FunctionRewriteCtx): void {
  const scope = createScope();
  addBinding(scope, (fn.id as { name?: string } | undefined)?.name);
  const params = (fn as unknown as { params?: unknown[] }).params ?? [];
  for (const param of params) declarePattern(scope, param);
  const body = fn.body as AnyNodeShape | undefined;
  if (body?.type === 'BlockStatement') {
    predeclareFunctionScope((body as unknown as { body: AnyNodeShape[] }).body, scope);
  }
  pushScope(ctx, scope);
  for (const param of params) walkPatternExpressions(param, ctx);
  walkFunctionReferences(body, ctx);
  popScope(ctx);
}

function walkPatternExpressions(pattern: unknown, ctx: FunctionRewriteCtx): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  switch (pat.type) {
    case 'ObjectPattern': {
      const props = (pat as unknown as { properties?: unknown[] }).properties ?? [];
      for (const prop of props) {
        const p = prop as AnyNodeShape;
        if (p.type === 'RestElement') {
          walkPatternExpressions(p.argument, ctx);
        } else {
          if ((p as unknown as { computed?: boolean }).computed) walkFunctionReferences(p.key, ctx);
          walkPatternExpressions(p.value, ctx);
        }
      }
      return;
    }
    case 'ArrayPattern': {
      const elements = (pat as unknown as { elements?: unknown[] }).elements ?? [];
      for (const element of elements) walkPatternExpressions(element, ctx);
      return;
    }
    case 'RestElement':
      walkPatternExpressions(pat.argument, ctx);
      return;
    case 'AssignmentPattern':
      markGlobalAliasesFromPatternDefault(pat.left, pat.right, ctx);
      walkPatternExpressions(pat.left, ctx);
      walkFunctionReferences(pat.right, ctx);
      return;
    default:
      return;
  }
}

function walkAssignmentTarget(target: unknown, ctx: FunctionRewriteCtx): void {
  if (!target || typeof target !== 'object') return;
  const t = target as AnyNodeShape;
  if (t.type === 'Identifier') {
    markGlobalFunctionWrite(t, ctx);
    return;
  }
  if (t.type === 'MemberExpression') {
    if (isGlobalFunctionWriteMember(t, ctx)) {
      ctx.hasGlobalFunctionWrite = true;
    }
    walkFunctionReferences(t.object, ctx);
    if ((t as unknown as { computed?: boolean }).computed) walkFunctionReferences(t.property, ctx);
    return;
  }
  walkAssignmentPatternTarget(t, ctx);
}

function walkAssignmentPatternTarget(pattern: unknown, ctx: FunctionRewriteCtx): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  switch (pat.type) {
    case 'Identifier':
      markGlobalFunctionWrite(pat, ctx);
      return;
    case 'ObjectPattern': {
      const props = (pat as unknown as { properties?: unknown[] }).properties ?? [];
      for (const prop of props) {
        const p = prop as AnyNodeShape;
        if (p.type === 'RestElement') walkAssignmentPatternTarget(p.argument, ctx);
        else {
          if ((p as unknown as { computed?: boolean }).computed) walkFunctionReferences(p.key, ctx);
          walkAssignmentPatternTarget(p.value, ctx);
        }
      }
      return;
    }
    case 'ArrayPattern': {
      const elements = (pat as unknown as { elements?: unknown[] }).elements ?? [];
      for (const element of elements) walkAssignmentPatternTarget(element, ctx);
      return;
    }
    case 'RestElement':
      walkAssignmentPatternTarget(pat.argument, ctx);
      return;
    case 'AssignmentPattern':
      walkAssignmentPatternTarget(pat.left, ctx);
      walkFunctionReferences(pat.right, ctx);
      return;
    case 'MemberExpression':
      walkAssignmentTarget(pat, ctx);
      return;
    default:
      walkPatternExpressions(pat, ctx);
      return;
  }
}

function markGlobalFunctionWrite(target: AnyNodeShape, ctx: FunctionRewriteCtx): void {
  const name = (target as unknown as { name?: string }).name;
  if (name === 'Function' && !isShadowed(ctx, name)) {
    ctx.hasGlobalFunctionWrite = true;
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

function updateGlobalAliasesFromPatternValue(
  pattern: unknown,
  value: unknown,
  ctx: FunctionRewriteCtx,
): void {
  const targetNames = new Set<string>();
  collectPatternBindingNames(pattern, targetNames);
  if (targetNames.size === 0) return;

  const aliasNames = new Set<string>();
  collectGlobalAliasNamesFromPatternValue(pattern, value, ctx, aliasNames);
  for (const name of targetNames) {
    if (aliasNames.has(name)) markGlobalAlias(ctx, name);
    else unmarkGlobalAlias(ctx, name);
  }
}

function updateMaybeFunctionAliasesFromPatternValue(
  pattern: unknown,
  value: unknown,
  ctx: FunctionRewriteCtx,
): void {
  const targetNames = new Set<string>();
  collectPatternBindingNames(pattern, targetNames);
  if (targetNames.size === 0) return;

  const aliasNames = new Set<string>();
  collectMaybeFunctionAliasNamesFromPatternValue(pattern, value, ctx, aliasNames);
  for (const name of targetNames) {
    if (aliasNames.has(name)) markMaybeFunctionAlias(ctx, name);
    else unmarkMaybeFunctionAlias(ctx, name);
  }
}

function updateMaybeDerivedFunctionAliasesFromPatternValue(
  pattern: unknown,
  value: unknown,
  ctx: FunctionRewriteCtx,
): void {
  const targetNames = new Set<string>();
  collectPatternBindingNames(pattern, targetNames);
  if (targetNames.size === 0) return;

  const aliasNames = new Set<string>();
  collectMaybeDerivedFunctionAliasNamesFromPatternValue(pattern, value, ctx, aliasNames);
  for (const name of targetNames) {
    if (aliasNames.has(name)) markMaybeDerivedFunctionAlias(ctx, name);
    else unmarkMaybeDerivedFunctionAlias(ctx, name);
  }
}

function updateMaybeEvalAliasesFromPatternValue(
  pattern: unknown,
  value: unknown,
  ctx: FunctionRewriteCtx,
): void {
  const targetNames = new Set<string>();
  collectPatternBindingNames(pattern, targetNames);
  if (targetNames.size === 0) return;

  const aliasNames = new Set<string>();
  collectMaybeEvalAliasNamesFromPatternValue(pattern, value, ctx, aliasNames);
  for (const name of targetNames) {
    if (aliasNames.has(name)) markMaybeEvalAlias(ctx, name);
    else unmarkMaybeEvalAlias(ctx, name);
  }
}

function collectMaybeDerivedFunctionAliasNamesFromPatternValue(
  pattern: unknown,
  value: unknown,
  ctx: FunctionRewriteCtx,
  out: Set<string>,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    if (name && expressionMayBeDerivedHostFunction(value, ctx)) out.add(name);
    return;
  }
  if (pat.type === 'AssignmentPattern') {
    collectMaybeDerivedFunctionAliasNamesFromPatternValue(
      pat.left,
      value === undefined ? pat.right : value,
      ctx,
      out,
    );
    return;
  }
  if (pat.type === 'ObjectPattern') {
    const props = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ObjectExpression'
    ) {
      const objectProperties =
        (unwrapChain(value) as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === undefined) continue;
        const sourceProp = objectProperties.find(
          (candidate) =>
            candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
        );
        collectMaybeDerivedFunctionAliasNamesFromPatternValue(
          prop.value,
          sourceProp?.value,
          ctx,
          out,
        );
      }
      return;
    }
    if (expressionMayHaveHostFunctionConstructor(value)) {
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === 'constructor' || key === undefined) collectPatternBindingNames(prop.value, out);
      }
    } else {
      collectMaybeDerivedFunctionAliasNamesFromDefaults(pat, ctx, out);
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ArrayExpression'
    ) {
      const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
      const values = (unwrapChain(value) as unknown as { elements?: unknown[] }).elements ?? [];
      for (let i = 0; i < patterns.length; i++) {
        collectMaybeDerivedFunctionAliasNamesFromPatternValue(patterns[i], values[i], ctx, out);
      }
      return;
    }
    if (!isKnownObjectOrArrayLiteral(value)) {
      collectPatternBindingNames(pat, out);
      collectMaybeDerivedFunctionAliasNamesFromDefaults(pat, ctx, out);
    }
  }
}

function collectMaybeEvalAliasNamesFromPatternValue(
  pattern: unknown,
  value: unknown,
  ctx: FunctionRewriteCtx,
  out: Set<string>,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    if (name && expressionMayBeGlobalEval(value, ctx)) out.add(name);
    return;
  }
  if (pat.type === 'AssignmentPattern') {
    collectMaybeEvalAliasNamesFromPatternValue(
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
      (unwrapChain(value) as AnyNodeShape).type === 'ObjectExpression'
    ) {
      const props = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
      const objectProperties =
        (unwrapChain(value) as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === undefined) {
          collectPatternBindingNames(prop.value, out);
          continue;
        }
        const sourceProp = objectProperties.find(
          (candidate) =>
            candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
        );
        collectMaybeEvalAliasNamesFromPatternValue(prop.value, sourceProp?.value, ctx, out);
      }
      return;
    }
    if (isGlobalObjectExpression(value, ctx)) {
      const props = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === 'eval' || key === undefined) collectPatternBindingNames(prop.value, out);
      }
      return;
    }
    if (!isKnownObjectOrArrayLiteral(value)) {
      collectMaybeEvalAliasNamesFromDefaults(pat, ctx, out);
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ArrayExpression'
    ) {
      const values = (unwrapChain(value) as unknown as { elements?: unknown[] }).elements ?? [];
      for (let i = 0; i < patterns.length; i++) {
        collectMaybeEvalAliasNamesFromPatternValue(patterns[i], values[i], ctx, out);
      }
      return;
    }
    if (!isKnownObjectOrArrayLiteral(value)) {
      collectPatternBindingNames(pat, out);
      collectMaybeEvalAliasNamesFromDefaults(pat, ctx, out);
    }
  }
}

function collectMaybeFunctionAliasNamesFromPatternValue(
  pattern: unknown,
  value: unknown,
  ctx: FunctionRewriteCtx,
  out: Set<string>,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    if (name && expressionMayBeHostFunction(value, ctx)) out.add(name);
    return;
  }
  if (pat.type === 'AssignmentPattern') {
    collectMaybeFunctionAliasNamesFromPatternValue(
      pat.left,
      value === undefined ? pat.right : value,
      ctx,
      out,
    );
    return;
  }
  if (pat.type === 'ObjectPattern') {
    if (isGlobalObjectExpression(value, ctx)) {
      const props = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === 'Function' || key === undefined) {
          collectPatternBindingNames(prop.value, out);
        }
      }
      return;
    }
    if (!value || typeof value !== 'object') return;
    const object = value as AnyNodeShape;
    if (object.type !== 'ObjectExpression') {
      collectMaybeFunctionAliasNamesFromDefaults(pat, ctx, out);
      return;
    }
    const objectProperties =
      (object as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
    const patternProperties = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
    for (const prop of patternProperties) {
      if (prop.type === 'RestElement') continue;
      const key = staticPropertyKeyName(prop);
      if (key === undefined) continue;
      const sourceProp = objectProperties.find(
        (candidate) =>
          candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
      );
      if (sourceProp) {
        collectMaybeFunctionAliasNamesFromPatternValue(prop.value, sourceProp.value, ctx, out);
      } else if ((prop.value as AnyNodeShape | undefined)?.type === 'AssignmentPattern') {
        collectMaybeFunctionAliasNamesFromPatternValue(prop.value, undefined, ctx, out);
      }
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    if (!value || typeof value !== 'object') return;
    const array = value as AnyNodeShape;
    if (array.type !== 'ArrayExpression') {
      collectMaybeFunctionAliasNamesFromDefaults(pat, ctx, out);
      return;
    }
    const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    const values = (array as unknown as { elements?: unknown[] }).elements ?? [];
    for (let i = 0; i < patterns.length; i++) {
      collectMaybeFunctionAliasNamesFromPatternValue(patterns[i], values[i], ctx, out);
    }
  }
}

function markGlobalAliasesFromPatternDefault(
  pattern: unknown,
  value: unknown,
  ctx: FunctionRewriteCtx,
): void {
  if (!isGlobalObjectExpression(value, ctx)) return;
  const targetNames = new Set<string>();
  collectPatternBindingNames(pattern, targetNames);
  for (const name of targetNames) markGlobalAlias(ctx, name);
}

function collectGlobalAliasNamesFromPatternValue(
  pattern: unknown,
  value: unknown,
  ctx: FunctionRewriteCtx,
  out: Set<string>,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  if (pat.type === 'Identifier') {
    if (isGlobalObjectExpression(value, ctx)) {
      const name = (pat as unknown as { name?: string }).name;
      if (name) out.add(name);
    }
    return;
  }
  if (pat.type === 'AssignmentPattern') {
    collectGlobalAliasNamesFromPatternValue(
      pat.left,
      value === undefined ? pat.right : value,
      ctx,
      out,
    );
    return;
  }
  if (pat.type === 'ObjectPattern') {
    if (!value || typeof value !== 'object') return;
    const object = value as AnyNodeShape;
    if (object.type !== 'ObjectExpression') {
      collectGlobalAliasNamesFromDefaults(pat, ctx, out);
      return;
    }
    const objectProperties =
      (object as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
    const patternProperties = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
    for (const prop of patternProperties) {
      if (prop.type === 'RestElement') continue;
      const key = staticPropertyKeyName(prop);
      if (key === undefined) continue;
      const sourceProp = objectProperties.find(
        (candidate) =>
          candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
      );
      if (sourceProp) {
        collectGlobalAliasNamesFromPatternValue(prop.value, sourceProp.value, ctx, out);
      } else if ((prop.value as AnyNodeShape | undefined)?.type === 'AssignmentPattern') {
        collectGlobalAliasNamesFromPatternValue(prop.value, undefined, ctx, out);
      }
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    if (!value || typeof value !== 'object') return;
    const array = value as AnyNodeShape;
    if (array.type !== 'ArrayExpression') {
      collectGlobalAliasNamesFromDefaults(pat, ctx, out);
      return;
    }
    const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    const values = (array as unknown as { elements?: unknown[] }).elements ?? [];
    for (let i = 0; i < patterns.length; i++) {
      collectGlobalAliasNamesFromPatternValue(patterns[i], values[i], ctx, out);
    }
  }
}

function isKnownObjectOrArrayLiteral(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as AnyNodeShape;
  return n.type === 'ObjectExpression' || n.type === 'ArrayExpression';
}

function collectGlobalAliasNamesFromDefaults(
  pattern: unknown,
  ctx: FunctionRewriteCtx,
  out: Set<string>,
): void {
  collectAliasNamesFromDefaults(pattern, ctx, out, isGlobalObjectExpression);
}

function collectMaybeFunctionAliasNamesFromDefaults(
  pattern: unknown,
  ctx: FunctionRewriteCtx,
  out: Set<string>,
): void {
  collectAliasNamesFromDefaults(pattern, ctx, out, expressionMayBeHostFunction);
}

function collectMaybeDerivedFunctionAliasNamesFromDefaults(
  pattern: unknown,
  ctx: FunctionRewriteCtx,
  out: Set<string>,
): void {
  collectAliasNamesFromDefaults(pattern, ctx, out, expressionMayBeDerivedHostFunction);
}

function collectMaybeEvalAliasNamesFromDefaults(
  pattern: unknown,
  ctx: FunctionRewriteCtx,
  out: Set<string>,
): void {
  collectAliasNamesFromDefaults(pattern, ctx, out, expressionMayBeGlobalEval);
}

function collectAliasNamesFromDefaults(
  pattern: unknown,
  ctx: FunctionRewriteCtx,
  out: Set<string>,
  predicate: (node: unknown, ctx: FunctionRewriteCtx) => boolean,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  if (pat.type === 'AssignmentPattern') {
    if (predicate(pat.right, ctx)) collectPatternBindingNames(pat.left, out);
    collectAliasNamesFromDefaults(pat.left, ctx, out, predicate);
    return;
  }
  if (pat.type === 'ObjectPattern') {
    const props = (pat as unknown as { properties?: unknown[] }).properties ?? [];
    for (const prop of props) {
      const p = prop as AnyNodeShape;
      collectAliasNamesFromDefaults(
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
    for (const element of elements) collectAliasNamesFromDefaults(element, ctx, out, predicate);
    return;
  }
  if (pat.type === 'RestElement') {
    collectAliasNamesFromDefaults(pat.argument, ctx, out, predicate);
  }
}

function collectPatternBindingNames(pattern: unknown, out: Set<string>): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  switch (pat.type) {
    case 'Identifier': {
      const name = (pat as unknown as { name?: string }).name;
      if (name) out.add(name);
      return;
    }
    case 'ObjectPattern': {
      const props = (pat as unknown as { properties?: unknown[] }).properties ?? [];
      for (const prop of props) {
        const p = prop as AnyNodeShape;
        collectPatternBindingNames(p.type === 'RestElement' ? p.argument : p.value, out);
      }
      return;
    }
    case 'ArrayPattern': {
      const elements = (pat as unknown as { elements?: unknown[] }).elements ?? [];
      for (const element of elements) collectPatternBindingNames(element, out);
      return;
    }
    case 'RestElement':
      collectPatternBindingNames(pat.argument, out);
      return;
    case 'AssignmentPattern':
      collectPatternBindingNames(pat.left, out);
      return;
    default:
      return;
  }
}

function isGlobalFunctionReadMember(node: AnyNodeShape, ctx: FunctionRewriteCtx): boolean {
  return isGlobalObjectExpression(node.object, ctx) && staticPropertyName(node) === 'Function';
}

function isGlobalFunctionWriteMember(node: AnyNodeShape, ctx: FunctionRewriteCtx): boolean {
  if (!isGlobalObjectExpression(node.object, ctx)) return false;
  const propertyName = staticPropertyName(node);
  return propertyName === 'Function' || (propertyName === undefined && isComputedMember(node));
}

function expressionMayBeHostFunction(node: unknown, ctx: FunctionRewriteCtx): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as AnyNodeShape;
  if (n.type === 'Identifier') {
    const name = (n as unknown as { name?: string }).name;
    return typeof name === 'string' && isMaybeFunctionAlias(ctx, name);
  }
  if (n.type === 'CallExpression' && isReflectGetFunctionCall(n, ctx)) return true;
  return n.type === 'MemberExpression' && isGlobalFunctionUnknownReadMember(n, ctx);
}

function expressionMayBeDerivedHostFunction(node: unknown, ctx: FunctionRewriteCtx): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type === 'Identifier') {
    const name = (n as unknown as { name?: string }).name;
    return typeof name === 'string' && isMaybeDerivedFunctionAlias(ctx, name);
  }
  if (n.type === 'CallExpression' && isReflectGetDerivedFunctionConstructorCall(n, ctx)) {
    return true;
  }
  return n.type === 'MemberExpression' && staticPropertyName(n) === 'constructor';
}

function expressionMayHaveHostFunctionConstructor(node: unknown): boolean {
  if (!node || typeof node !== 'object') return true;
  const n = unwrapChain(node) as AnyNodeShape;
  return (
    n.type !== 'Literal' &&
    n.type !== 'TemplateLiteral' &&
    n.type !== 'ObjectExpression' &&
    n.type !== 'ArrayExpression'
  );
}

function isReflectGetFunctionCall(node: AnyNodeShape, ctx: FunctionRewriteCtx): boolean {
  const call = node as unknown as { callee?: AnyNodeShape; arguments?: unknown[] };
  const callee = call.callee;
  const args = call.arguments ?? [];
  if (!callee || callee.type !== 'MemberExpression') return false;
  const calleeMember = callee as unknown as { object?: AnyNodeShape };
  const object = calleeMember.object;
  const objectName =
    object?.type === 'Identifier' ? (object as unknown as { name?: string }).name : undefined;
  if (
    objectName !== 'Reflect' ||
    isShadowed(ctx, 'Reflect') ||
    staticPropertyName(callee) !== 'get'
  ) {
    return false;
  }
  if (!isGlobalObjectExpression(args[0], ctx)) return false;
  return propertyMayBeFunction(args[1]);
}

function isReflectGetDerivedFunctionConstructorCall(
  node: AnyNodeShape,
  ctx: FunctionRewriteCtx,
): boolean {
  const call = node as unknown as { callee?: AnyNodeShape; arguments?: unknown[] };
  const callee = unwrapChain(call.callee) as AnyNodeShape | undefined;
  const args = call.arguments ?? [];
  if (!callee || callee.type !== 'MemberExpression') return false;
  const calleeMember = callee as unknown as { object?: AnyNodeShape };
  const object = unwrapChain(calleeMember.object) as AnyNodeShape | undefined;
  const objectName =
    object?.type === 'Identifier' ? (object as unknown as { name?: string }).name : undefined;
  if (
    objectName !== 'Reflect' ||
    isShadowed(ctx, 'Reflect') ||
    staticPropertyName(callee) !== 'get'
  ) {
    return false;
  }
  return propertyMayBeConstructor(args[1]) && expressionMayHaveHostFunctionConstructor(args[0]);
}

function isReflectDerivedFunctionConstructorCall(
  node: AnyNodeShape,
  ctx: FunctionRewriteCtx,
): boolean {
  const call = node as unknown as { callee?: AnyNodeShape; arguments?: unknown[] };
  const callee = unwrapChain(call.callee) as AnyNodeShape | undefined;
  const args = call.arguments ?? [];
  if (!callee || callee.type !== 'MemberExpression') return false;
  const calleeMember = callee as unknown as { object?: AnyNodeShape };
  const object = unwrapChain(calleeMember.object) as AnyNodeShape | undefined;
  const objectName =
    object?.type === 'Identifier' ? (object as unknown as { name?: string }).name : undefined;
  if (objectName !== 'Reflect' || isShadowed(ctx, 'Reflect')) return false;
  const propertyName = staticPropertyName(callee);
  if (propertyName === 'apply') {
    return (
      expressionMayBeDerivedHostFunction(args[0], ctx) && constructorArgArrayMayImport(args[2])
    );
  }
  if (propertyName === 'construct') {
    return (
      expressionMayBeDerivedHostFunction(args[0], ctx) && constructorArgArrayMayImport(args[1])
    );
  }
  return false;
}

function calleeMayBeHostFunction(node: unknown, ctx: FunctionRewriteCtx): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as AnyNodeShape;
  if (expressionMayBeHostFunction(n, ctx)) return true;
  if (n.type !== 'MemberExpression') return false;
  const member = n as unknown as { object?: unknown; property?: AnyNodeShape };
  if (!member.object || !expressionMayBeHostFunction(member.object, ctx)) return false;
  const propertyName = staticPropertyName(n);
  return propertyName === 'call' || propertyName === 'apply' || propertyName === 'bind';
}

function calleeMayBeDerivedHostFunction(node: unknown, ctx: FunctionRewriteCtx): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapChain(node) as AnyNodeShape;
  if (expressionMayBeDerivedHostFunction(n, ctx)) return true;
  if (n.type !== 'MemberExpression') return false;
  const member = n as unknown as { object?: unknown };
  if (!member.object || !expressionMayBeDerivedHostFunction(member.object, ctx)) return false;
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
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type !== 'ArrayExpression') return false;
  const elements = (n as unknown as { elements?: unknown[] }).elements ?? [];
  return constructorArgsMayImport(elements);
}

function expressionMayBeGlobalEval(node: unknown, ctx: FunctionRewriteCtx): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type === 'Identifier') {
    const name = (n as unknown as { name?: string }).name;
    return name === 'eval' || (typeof name === 'string' && isMaybeEvalAlias(ctx, name));
  }
  return n.type === 'MemberExpression' && isGlobalEvalCallMember(n, ctx);
}

function calleeMayBeEval(node: unknown, ctx: FunctionRewriteCtx): boolean {
  return expressionMayBeGlobalEval(node, ctx);
}

function isGlobalFunctionUnknownReadMember(node: AnyNodeShape, ctx: FunctionRewriteCtx): boolean {
  return (
    isGlobalObjectExpression(node.object, ctx) &&
    staticPropertyName(node) === undefined &&
    isComputedMember(node)
  );
}

function isGlobalEvalReadMember(node: AnyNodeShape, ctx: FunctionRewriteCtx): boolean {
  return isGlobalObjectExpression(node.object, ctx) && staticPropertyName(node) === 'eval';
}

function isGlobalEvalCallMember(node: AnyNodeShape, ctx: FunctionRewriteCtx): boolean {
  if (!isGlobalObjectExpression(node.object, ctx)) return false;
  const propertyName = staticPropertyName(node);
  return propertyName === 'eval' || (propertyName === undefined && isComputedMember(node));
}

function isGlobalObjectExpression(node: unknown, ctx: FunctionRewriteCtx): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as AnyNodeShape;
  if (n.type !== 'Identifier') return false;
  const name = (n as unknown as { name?: string }).name;
  if ((name === 'globalThis' || name === 'global') && !isShadowed(ctx, name)) return true;
  return typeof name === 'string' && isGlobalAlias(ctx, name);
}

function isGlobalFunctionMutationCall(node: AnyNodeShape, ctx: FunctionRewriteCtx): boolean {
  const call = node as unknown as { callee?: AnyNodeShape; arguments?: unknown[] };
  const callee = call.callee;
  const args = call.arguments ?? [];
  if (!callee || callee.type !== 'MemberExpression') return false;
  const calleeMember = callee as unknown as { object?: AnyNodeShape };
  const object = calleeMember.object;
  const objectName =
    object?.type === 'Identifier' ? (object as unknown as { name?: string }).name : undefined;
  const propertyName = staticPropertyName(callee);

  const isBuiltinObject = objectName === 'Object' && !isShadowed(ctx, 'Object');
  const isBuiltinReflect = objectName === 'Reflect' && !isShadowed(ctx, 'Reflect');

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
  const object = node as AnyNodeShape;
  if (object.type !== 'ObjectExpression') return true;
  const properties = (object as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
  return properties.some((property) => {
    if (property.type === 'SpreadElement') return true;
    const key = staticPropertyKeyName(property);
    return key === 'Function' || key === undefined;
  });
}

function staticPropertyName(node: AnyNodeShape): string | undefined {
  const n = unwrapChain(node) as AnyNodeShape;
  const member = n as unknown as { computed?: boolean; property?: AnyNodeShape };
  const property = member.property;
  if (!property) return undefined;
  if (!member.computed && property.type === 'Identifier') {
    return (property as unknown as { name?: string }).name;
  }
  return member.computed ? literalString(property) : undefined;
}

function isComputedMember(node: AnyNodeShape): boolean {
  return Boolean((unwrapChain(node) as unknown as { computed?: boolean }).computed);
}

function staticPropertyKeyName(node: AnyNodeShape): string | undefined {
  const property = node as unknown as { computed?: boolean; key?: AnyNodeShape };
  const key = property.key;
  if (!key) return undefined;
  if (!property.computed && key.type === 'Identifier') {
    return (key as unknown as { name?: string }).name;
  }
  return literalString(key);
}

function literalString(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = unwrapChain(node) as AnyNodeShape;
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
    const quasis = (n as unknown as { quasis?: AnyNodeShape[] }).quasis ?? [];
    return quasis
      .map((quasi) => {
        const value = quasi.value as { cooked?: unknown } | undefined;
        return typeof value?.cooked === 'string' ? value.cooked : '';
      })
      .join('');
  }
  return undefined;
}

function unwrapChain(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  const n = node as AnyNodeShape;
  if (n.type === 'ChainExpression') return unwrapChain(n.expression);
  if (n.type === 'SequenceExpression') {
    const expressions = (n as unknown as { expressions?: unknown[] }).expressions ?? [];
    return unwrapChain(expressions[expressions.length - 1]);
  }
  return node;
}

function walkDefaultForFunctionReferences(n: AnyNodeShape, ctx: FunctionRewriteCtx): void {
  for (const key of Object.keys(n)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
      continue;
    }
    const value = n[key];
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const item of value) walkFunctionReferences(item, ctx);
    } else if (typeof value === 'object') {
      walkFunctionReferences(value, ctx);
    }
  }
}

function compileCjsSource(
  moduleObject: CjsModule,
  sourceText: string,
  filename: string,
  deps: CjsLoaderDeps,
): void {
  const require = deps.makeRequire(filename, moduleObject);
  const dynamicImport = async (specifier: unknown): Promise<Record<string, unknown>> => {
    keepaliveRef();
    try {
      const dep = deps.resolve(toDynamicImportSpecifier(specifier), filename, true);
      return await deps.loadAsync(dep.id);
    } finally {
      keepaliveUnref();
    }
  };

  type CjsFactory = (
    module: CjsModule,
    exports: Record<string, unknown>,
    require: CjsRequire,
    __filename: string,
    __dirname: string,
    __riftyDynamicImport: (specifier: unknown) => Promise<Record<string, unknown>>,
    __riftyFunction: FunctionConstructor,
    __riftyWebAssembly: typeof WebAssembly,
  ) => void;

  const routedConstructors = createFunctionImportRouting(dynamicImport, filename);
  const dynamicImportHelperName = uniqueHelperName(sourceText, '__riftyDynamicImport');
  const functionHelperName = uniqueHelperName(
    sourceText,
    '__riftyFunction',
    new Set([dynamicImportHelperName]),
  );
  const webAssemblyHelperName = uniqueHelperName(
    sourceText,
    '__riftyWebAssembly',
    new Set([dynamicImportHelperName, functionHelperName]),
  );
  const source = rewriteCjsFunctionConstructorReferences(
    rewriteDynamicImports(sourceText, filename, dynamicImportHelperName),
    filename,
    functionHelperName,
    webAssemblyHelperName,
  );
  let fn: CjsFactory;
  try {
    fn = new Function(
      'module',
      'exports',
      'require',
      '__filename',
      '__dirname',
      dynamicImportHelperName,
      functionHelperName,
      webAssemblyHelperName,
      `${source}\n//# sourceURL=${filename}`,
    ) as CjsFactory;
  } catch (error) {
    // `new Function` SyntaxError has no file context — surface a directed
    // error naming the module (mirrors the ESM path in esm.ts).
    const message = (error as Error).message ?? String(error);
    throw new ModuleLoadError(
      'SYNTAX_ERROR',
      filename,
      `Failed to compile CJS module ${filename}: ${message}${snippetForSource(sourceText, (error as Error).stack ?? '')}`,
      filename,
    );
  }

  fn.call(
    moduleObject.exports,
    moduleObject,
    moduleObject.exports,
    require,
    filename,
    dirname(filename),
    dynamicImport,
    routedConstructors.Function,
    deps.WebAssembly,
  );
}

function moduleLookupPaths(filename: string): string[] {
  const paths: string[] = [];
  let current = dirname(filename);
  for (;;) {
    const candidate =
      basename(current) === 'node_modules' ? current : joinPath(current, 'node_modules');
    if (paths.at(-1) !== candidate) paths.push(candidate);
    if (current === '/') return paths;
    current = dirname(current);
  }
}

function initialiseCjsRecord(
  record: ModuleRecord,
  deps: CjsLoaderDeps,
  parent: CjsModule | undefined,
  identity: {
    readonly filename: string;
    readonly path: string;
  } = {
    filename: record.id,
    path: dirname(record.id),
  },
): CjsModule {
  record.filename = identity.filename;
  record.path = identity.path;
  record.paths = moduleLookupPaths(identity.filename);
  // Node reaches `module.parent` through a deprecated accessor on
  // `Module.prototype`, so it is readable (nodemon walks it) but never an own
  // enumerable key.
  objectDefinePropertyPrimordial(record, 'parent', {
    value: parent,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  record.children = [];
  record.loaded = false;
  record.exports = {};
  objectDefinePropertyPrimordial(record, '_compile', {
    configurable: true,
    writable: true,
    value(source: string, filename: string): void {
      compileCjsSource(record as CjsModule, source, filename, deps);
    },
  });
  return record as CjsModule;
}

/** Initialise Node's synthetic eval module without inserting it into `require.cache`. */
export function initialiseDetachedCjsRecord(
  record: ModuleRecord,
  deps: CjsLoaderDeps,
  filename: string,
): CjsModule {
  return initialiseCjsRecord(record, deps, undefined, { filename, path: '.' });
}

function attachCjsChild(parent: CjsModule | undefined, child: CjsModule): void {
  if (parent !== undefined && !parent.children.includes(child)) parent.children.push(child);
}

function detachFailedCjsChild(parent: CjsModule | undefined, child: CjsModule): void {
  if (parent === undefined) return;
  const index = parent.children.indexOf(child);
  if (index !== -1) parent.children.splice(index, 1);
}

function findRegisteredExtension(filename: string, extensions: CjsExtensions): string | undefined {
  const name = stringSlice(filename, stringLastIndexOf(filename, '/') + 1);
  let startIndex = 0;
  while (startIndex < name.length) {
    const index = stringIndexOf(name, '.', startIndex);
    if (index === -1) break;
    startIndex = index + 1;
    if (index === 0) continue;
    const extension = stringSlice(name, index);
    if ((extensions as Record<string, unknown>)[extension]) return extension;
  }
  return undefined;
}

interface CjsExtensionSelection {
  readonly key: string;
  readonly hook: unknown;
  readonly usesLoaderDefaultJs: boolean;
}

function selectCjsExtension(filename: string, deps: CjsLoaderDeps): CjsExtensionSelection {
  const registeredExtension = findRegisteredExtension(filename, deps.extensions);
  const key = registeredExtension ?? '.js';
  const hook: unknown = deps.extensions[key];
  return {
    key,
    hook,
    usesLoaderDefaultJs: registeredExtension === undefined && hook === deps.defaultJsExtension,
  };
}

function assertCjsExtensionHook(hook: unknown, key: string): asserts hook is CjsExtensionHook {
  if (typeof hook !== 'function') {
    throw new TypeErrorConstructor(
      `require.extensions[${jsonStringifyPrimordial(key)}] is not a function`,
    );
  }
}

export function executeCjs(
  resolved: ResolvedModule,
  deps: CjsLoaderDeps,
  parent?: CjsModule,
): Record<string, unknown> {
  const { registry } = deps;
  let existing = registry.get(resolved.id);
  if (existing && (existing.state === 'loaded' || existing.state === 'loading')) {
    const cached = existing as CjsModule;
    // Cached loads and cycles link each requesting parent once without
    // replacing the child's first parent.
    attachCjsChild(parent, cached);
    return cached.exports;
  }
  // Node removes a failed CJS evaluation from require.cache. Import jobs may
  // still retain their own rejected outcome, but a later require gets a fresh
  // execution record.
  if (existing?.state === 'errored') {
    registry.invalidate(resolved.id);
    existing = undefined;
  }

  const record = existing ?? registry.getOrCreate(resolved.id, resolved.kind);
  const moduleObject = initialiseCjsRecord(record, deps, parent);
  record.state = 'loading';
  attachCjsChild(parent, moduleObject);

  try {
    const selection = selectCjsExtension(resolved.id, deps);

    if (selection.usesLoaderDefaultJs) assertNotTsCjs(resolved.id);

    if (resolved.kind === 'text' && selection.usesLoaderDefaultJs) {
      // Text-asset import (ADR-0067): the module value IS the raw file contents.
      // A replaced `.js` owns Node's otherwise-unregistered suffix fallback.
      moduleObject.exports = resolved.source as unknown as Record<string, unknown>;
      record.exports = moduleObject.exports;
      record.loaded = true;
      record.state = 'loaded';
      return record.exports;
    }

    assertCjsExtensionHook(selection.hook, selection.key);
    reflectApplyPrimordial(selection.hook, deps.extensions, [moduleObject, resolved.id]);
  } catch (error) {
    failCjsRecord(registry, record, error);
  }

  // Exports may have been reassigned (`module.exports = ...`); re-point.
  record.exports = moduleObject.exports;
  record.loaded = true;
  record.state = 'loaded';
  return moduleObject.exports;
}

function failCjsRecord(registry: ModuleRegistry, record: ModuleRecord, error: unknown): never {
  record.state = 'errored';
  // Same rule as the other loader-private fields: recorded, never enumerated.
  Object.defineProperty(record, 'error', {
    value: error,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  detachFailedCjsChild(record.parent ?? undefined, record as CjsModule);
  if (registry.get(record.id) === record) registry.invalidate(record.id);
  throw error;
}

function toDynamicImportSpecifier(specifier: unknown): string {
  if (typeof specifier === 'symbol') {
    throw new TypeError('Cannot convert a Symbol value to a string');
  }
  return String(specifier);
}
