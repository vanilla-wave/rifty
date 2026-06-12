import { NotImplementedError } from '@riftydev/io';
import type {
  Function as AcornFunction,
  AssignmentExpression,
  AssignmentPattern,
  CatchClause,
  ClassDeclaration,
  ClassExpression,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  FunctionDeclaration,
  Identifier,
  Pattern,
  Program,
  VariableDeclaration,
} from 'acorn';
import { parse as acornParse } from 'acorn';

const VM_CONTEXT = Symbol.for('rifty.vm.context');

type ContextObject = Record<string, unknown> & { [VM_CONTEXT]?: true };
type ContextProxy = ContextObject;
interface SourceEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface AnyNodeShape {
  type: string;
  start: number;
  end: number;
  [k: string]: unknown;
}

interface RewriteContext {
  readonly source: string;
  readonly edits: SourceEdit[];
  readonly scopes: Array<Set<string>>;
  functionDepth: number;
}

export interface RunningScriptOptions {
  filename?: string;
  displayErrors?: boolean;
  timeout?: number;
  breakOnSigint?: boolean;
  microtaskMode?: string;
  contextExtensions?: object[];
}

export interface ScriptOptions extends RunningScriptOptions {
  lineOffset?: number;
  columnOffset?: number;
  cachedData?: Uint8Array;
  produceCachedData?: boolean;
  importModuleDynamically?: unknown;
}

export interface CompileFunctionOptions extends ScriptOptions {
  parsingContext?: object;
}

export interface CreateContextOptions {
  name?: string;
  origin?: string;
  codeGeneration?: {
    strings?: boolean;
    wasm?: boolean;
  };
  microtaskMode?: string;
}

type VmOptions = string | ScriptOptions | undefined;

const runGlobalScript = new Function('source', 'return (0, eval)(source);') as (
  source: string,
) => unknown;

const runContextScript = new Function(
  '__riftyVmContext',
  '__riftyVmSource',
  'with (__riftyVmContext) { return eval(__riftyVmSource); }',
) as (context: ContextProxy, source: string) => unknown;

const HELPER_BINDINGS = new Set<PropertyKey>(['__riftyVmContext', '__riftyVmSource', 'eval']);

const INTRINSIC_GLOBALS = new Set<PropertyKey>([
  'AggregateError',
  'Array',
  'ArrayBuffer',
  'Atomics',
  'BigInt',
  'BigInt64Array',
  'BigUint64Array',
  'Boolean',
  'DataView',
  'Date',
  'Error',
  'EvalError',
  'FinalizationRegistry',
  'Float32Array',
  'Float64Array',
  'Function',
  'Infinity',
  'Int16Array',
  'Int32Array',
  'Int8Array',
  'Intl',
  'JSON',
  'Map',
  'Math',
  'NaN',
  'Number',
  'Object',
  'Promise',
  'Proxy',
  'RangeError',
  'ReferenceError',
  'Reflect',
  'RegExp',
  'Set',
  'SharedArrayBuffer',
  'String',
  'Symbol',
  'SyntaxError',
  'TypeError',
  'URIError',
  'Uint16Array',
  'Uint32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'WeakMap',
  'WeakRef',
  'WeakSet',
  'console',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'escape',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'undefined',
  'unescape',
]);

const contextProxies = new WeakMap<ContextObject, ContextProxy>();

function asSource(code: string): string {
  if (typeof code !== 'string') {
    throw new TypeError('The "code" argument must be of type string.');
  }
  return code;
}

function normalizeOptions(options?: VmOptions): ScriptOptions {
  if (options === undefined) return {};
  if (typeof options === 'string') return { filename: options };
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('The "options" argument must be a string or object.');
  }
  return options;
}

function assertSupportedRunOptions(options: RunningScriptOptions, feature: string): void {
  if (options.displayErrors !== undefined) {
    throw new NotImplementedError(`${feature}.displayErrors`);
  }
  if (options.timeout !== undefined) {
    throw new NotImplementedError(`${feature}.timeout`);
  }
  if (options.breakOnSigint) {
    throw new NotImplementedError(`${feature}.breakOnSigint`);
  }
  if (options.microtaskMode !== undefined) {
    throw new NotImplementedError(`${feature}.microtaskMode`);
  }
  if (options.contextExtensions !== undefined && options.contextExtensions.length > 0) {
    throw new NotImplementedError(`${feature}.contextExtensions`);
  }
}

function assertSupportedScriptOptions(options: ScriptOptions, feature: string): void {
  assertSupportedRunOptions(options, feature);
  if (options.lineOffset !== undefined && options.lineOffset !== 0) {
    throw new NotImplementedError(`${feature}.lineOffset`);
  }
  if (options.columnOffset !== undefined && options.columnOffset !== 0) {
    throw new NotImplementedError(`${feature}.columnOffset`);
  }
  if (options.cachedData !== undefined) {
    throw new NotImplementedError(`${feature}.cachedData`);
  }
  if (options.produceCachedData) {
    throw new NotImplementedError(`${feature}.produceCachedData`);
  }
  if (options.importModuleDynamically !== undefined) {
    throw new NotImplementedError(`${feature}.importModuleDynamically`);
  }
}

function assertSupportedCompileOptions(options: CompileFunctionOptions): void {
  assertSupportedScriptOptions(options, 'vm.compileFunction');
  if (options.parsingContext !== undefined) {
    throw new NotImplementedError('vm.compileFunction.parsingContext');
  }
}

function assertSupportedContextOptions(options?: CreateContextOptions): void {
  if (!options) return;
  if (options.name !== undefined) {
    throw new NotImplementedError('vm.createContext.name');
  }
  if (options.origin !== undefined) {
    throw new NotImplementedError('vm.createContext.origin');
  }
  if (options.codeGeneration !== undefined) {
    throw new NotImplementedError('vm.createContext.codeGeneration');
  }
  if (options.microtaskMode !== undefined) {
    throw new NotImplementedError('vm.createContext.microtaskMode');
  }
}

function withSourceURL(code: string, filename?: string): string {
  if (!filename) return code;
  return `${code}\n//# sourceURL=${filename}`;
}

function assertObjectContext(value: unknown): asserts value is ContextObject {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new TypeError('The "contextifiedObject" argument must be an object.');
  }
}

function contextProxy(context: ContextObject): ContextProxy {
  const existing = contextProxies.get(context);
  if (existing) return existing;

  const proxy: ContextProxy = new Proxy(context, {
    has(_target, prop) {
      if (prop === Symbol.unscopables) return false;
      return (
        !HELPER_BINDINGS.has(prop) &&
        (prop === 'globalThis' || Reflect.has(context, prop) || INTRINSIC_GLOBALS.has(prop))
      );
    },
    get(target, prop, receiver) {
      if (prop === Symbol.unscopables) return undefined;
      if (prop === 'globalThis') return proxy;
      if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver) as unknown;
      if (INTRINSIC_GLOBALS.has(prop)) return Reflect.get(globalThis, prop);
      return undefined;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value);
    },
    defineProperty(target, prop, descriptor) {
      return Reflect.defineProperty(target, prop, descriptor);
    },
    deleteProperty(target, prop) {
      return Reflect.deleteProperty(target, prop);
    },
  });

  contextProxies.set(context, proxy);
  return proxy;
}

function applySourceEdits(source: string, edits: SourceEdit[]): string {
  if (edits.length === 0) return source;
  let out = '';
  let cursor = 0;
  for (const edit of edits.sort((a, b) => a.start - b.start || b.end - a.end)) {
    out += source.slice(cursor, edit.start);
    out += edit.text;
    cursor = edit.end;
  }
  out += source.slice(cursor);
  return out;
}

function identifierName(node: unknown): string | null {
  return (node as { type?: string; name?: string }).type === 'Identifier'
    ? ((node as Identifier).name ?? null)
    : null;
}

function pushScope(ctx: RewriteContext): void {
  ctx.scopes.push(new Set());
}

function popScope(ctx: RewriteContext): void {
  ctx.scopes.pop();
}

function addBinding(ctx: RewriteContext, name: string): void {
  ctx.scopes[ctx.scopes.length - 1]?.add(name);
}

function isBound(ctx: RewriteContext, name: string): boolean {
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    if (ctx.scopes[i]?.has(name)) return true;
  }
  return false;
}

function declarePattern(ctx: RewriteContext, pat: Pattern): void {
  switch (pat.type) {
    case 'Identifier':
      addBinding(ctx, pat.name);
      return;
    case 'ObjectPattern':
      for (const property of pat.properties) {
        if (property.type === 'RestElement') declarePattern(ctx, property.argument);
        else declarePattern(ctx, property.value);
      }
      return;
    case 'ArrayPattern':
      for (const element of pat.elements) {
        if (element) declarePattern(ctx, element);
      }
      return;
    case 'RestElement':
      declarePattern(ctx, pat.argument);
      return;
    case 'AssignmentPattern':
      declarePattern(ctx, (pat as AssignmentPattern).left);
      return;
    default:
      return;
  }
}

function declareVarDecl(ctx: RewriteContext, declaration: VariableDeclaration): void {
  for (const declarator of declaration.declarations) declarePattern(ctx, declarator.id);
}

function emitContextVarRewrite(ctx: RewriteContext, declaration: VariableDeclaration): void {
  const assignments: string[] = [];
  for (const declarator of declaration.declarations) {
    const name = identifierName(declarator.id);
    if (!name) {
      throw new NotImplementedError('vm.context.var-pattern');
    }
    const init = declarator.init
      ? ctx.source.slice(declarator.init.start, declarator.init.end)
      : 'undefined';
    assignments.push(`globalThis.${name} = ${init}`);
  }
  ctx.edits.push({ start: declaration.start, end: declaration.end, text: assignments.join('; ') });
}

function predeclareLexicalBody(ctx: RewriteContext, body: readonly AnyNodeShape[]): void {
  for (const child of body) {
    if (child.type === 'VariableDeclaration') {
      const declaration = child as unknown as VariableDeclaration;
      if (declaration.kind !== 'var') declareVarDecl(ctx, declaration);
    } else if (child.type === 'ClassDeclaration') {
      const id = (child as unknown as ClassDeclaration).id;
      if (id) addBinding(ctx, id.name);
    } else if (child.type === 'FunctionDeclaration' && ctx.functionDepth > 0) {
      const id = (child as unknown as FunctionDeclaration).id;
      if (id) addBinding(ctx, id.name);
    }
  }
}

function collectFunctionVarBindings(node: unknown, ctx: RewriteContext): void {
  if (!node || typeof node !== 'object') return;
  const n = node as AnyNodeShape;
  if (typeof n.type !== 'string') return;
  if (
    n.type === 'FunctionDeclaration' ||
    n.type === 'FunctionExpression' ||
    n.type === 'ArrowFunctionExpression'
  ) {
    return;
  }
  if (n.type === 'VariableDeclaration') {
    const declaration = n as unknown as VariableDeclaration;
    if (declaration.kind === 'var') declareVarDecl(ctx, declaration);
  }
  for (const key of Object.keys(n)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
      continue;
    }
    const value = n[key];
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const item of value) collectFunctionVarBindings(item, ctx);
    } else if (typeof value === 'object') {
      collectFunctionVarBindings(value, ctx);
    }
  }
}

function walkPatternExpressions(pattern: Pattern, ctx: RewriteContext): void {
  switch (pattern.type) {
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        if (property.type === 'RestElement') {
          walkPatternExpressions(property.argument, ctx);
        } else {
          if (property.computed) walkContextNode(property.key, ctx);
          walkPatternExpressions(property.value, ctx);
        }
      }
      return;
    case 'ArrayPattern':
      for (const element of pattern.elements) {
        if (element) walkPatternExpressions(element, ctx);
      }
      return;
    case 'RestElement':
      walkPatternExpressions(pattern.argument, ctx);
      return;
    case 'AssignmentPattern':
      walkPatternExpressions(pattern.left, ctx);
      walkContextNode(pattern.right, ctx);
      return;
    default:
      return;
  }
}

function walkFunction(fn: AcornFunction, ctx: RewriteContext): void {
  pushScope(ctx);
  ctx.functionDepth += 1;
  if (fn.id) addBinding(ctx, fn.id.name);
  for (const param of fn.params) {
    declarePattern(ctx, param);
    walkPatternExpressions(param, ctx);
  }
  collectFunctionVarBindings(fn.body, ctx);
  walkContextNode(fn.body, ctx);
  ctx.functionDepth -= 1;
  popScope(ctx);
}

function walkBlock(body: readonly AnyNodeShape[], ctx: RewriteContext): void {
  pushScope(ctx);
  predeclareLexicalBody(ctx, body);
  for (const child of body) walkContextNode(child, ctx);
  popScope(ctx);
}

function walkForStatement(statement: ForStatement, ctx: RewriteContext): void {
  pushScope(ctx);
  if (statement.init) {
    if ((statement.init as unknown as AnyNodeShape).type === 'VariableDeclaration') {
      const declaration = statement.init as unknown as VariableDeclaration;
      if (declaration.kind !== 'var') declareVarDecl(ctx, declaration);
    }
    walkContextNode(statement.init, ctx);
  }
  if (statement.test) walkContextNode(statement.test, ctx);
  if (statement.update) walkContextNode(statement.update, ctx);
  walkContextNode(statement.body, ctx);
  popScope(ctx);
}

function walkForInOfStatement(
  statement: ForInStatement | ForOfStatement,
  ctx: RewriteContext,
): void {
  pushScope(ctx);
  if ((statement.left as unknown as AnyNodeShape).type === 'VariableDeclaration') {
    const declaration = statement.left as unknown as VariableDeclaration;
    if (declaration.kind !== 'var') declareVarDecl(ctx, declaration);
  }
  walkContextNode(statement.left, ctx);
  walkContextNode(statement.right, ctx);
  walkContextNode(statement.body, ctx);
  popScope(ctx);
}

function walkDefault(node: AnyNodeShape, ctx: RewriteContext): void {
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
      continue;
    }
    const value = node[key];
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const item of value) walkContextNode(item, ctx);
    } else if (typeof value === 'object') {
      walkContextNode(value, ctx);
    }
  }
}

function walkContextNode(node: unknown, ctx: RewriteContext): void {
  if (!node || typeof node !== 'object') return;
  const n = node as AnyNodeShape;
  if (typeof n.type !== 'string') return;

  switch (n.type) {
    case 'Program': {
      const program = n as unknown as Program;
      predeclareLexicalBody(ctx, program.body as unknown as AnyNodeShape[]);
      for (const child of program.body) walkContextNode(child, ctx);
      return;
    }

    case 'BlockStatement':
      walkBlock((n as unknown as { body: AnyNodeShape[] }).body, ctx);
      return;

    case 'FunctionDeclaration': {
      const declaration = n as unknown as FunctionDeclaration;
      if (ctx.functionDepth === 0 && declaration.id) {
        ctx.edits.push({
          start: declaration.start,
          end: declaration.start,
          text: `globalThis.${declaration.id.name} = `,
        });
        ctx.edits.push({ start: declaration.end, end: declaration.end, text: ';' });
      }
      walkFunction(declaration as unknown as AcornFunction, ctx);
      return;
    }

    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      walkFunction(n as unknown as AcornFunction, ctx);
      return;

    case 'VariableDeclaration': {
      const declaration = n as unknown as VariableDeclaration;
      if (declaration.kind === 'var') {
        if (ctx.functionDepth === 0) {
          emitContextVarRewrite(ctx, declaration);
          return;
        }
        declareVarDecl(ctx, declaration);
      }
      for (const declarator of declaration.declarations) {
        walkPatternExpressions(declarator.id, ctx);
        if (declarator.init) walkContextNode(declarator.init, ctx);
      }
      return;
    }

    case 'AssignmentExpression': {
      const assignment = n as unknown as AssignmentExpression;
      const name = assignment.operator === '=' ? identifierName(assignment.left) : null;
      if (name && !isBound(ctx, name)) {
        ctx.edits.push({
          start: assignment.left.start,
          end: assignment.left.end,
          text: `globalThis.${name}`,
        });
      } else {
        walkContextNode(assignment.left, ctx);
      }
      walkContextNode(assignment.right, ctx);
      return;
    }

    case 'ForStatement':
      walkForStatement(n as unknown as ForStatement, ctx);
      return;

    case 'ForInStatement':
    case 'ForOfStatement':
      walkForInOfStatement(n as unknown as ForInStatement | ForOfStatement, ctx);
      return;

    case 'CatchClause': {
      const clause = n as unknown as CatchClause;
      pushScope(ctx);
      if (clause.param) declarePattern(ctx, clause.param);
      walkContextNode(clause.body, ctx);
      popScope(ctx);
      return;
    }

    case 'ClassDeclaration':
    case 'ClassExpression': {
      const klass = n as unknown as ClassDeclaration | ClassExpression;
      pushScope(ctx);
      if (klass.id) addBinding(ctx, klass.id.name);
      if (klass.superClass) walkContextNode(klass.superClass, ctx);
      walkContextNode(klass.body, ctx);
      popScope(ctx);
      return;
    }

    default:
      walkDefault(n, ctx);
      return;
  }
}

function rewriteContextSource(source: string): string {
  const program = acornParse(source, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowReturnOutsideFunction: true,
  }) as Program;
  const ctx: RewriteContext = {
    source,
    edits: [],
    scopes: [new Set()],
    functionDepth: 0,
  };

  walkContextNode(program, ctx);
  return applySourceEdits(source, ctx.edits);
}

export function createContext<T extends Record<string, unknown> = Record<string, unknown>>(
  contextObject?: T,
  options?: CreateContextOptions,
): T {
  assertSupportedContextOptions(options);
  if (contextObject === null) {
    throw new TypeError('The "object" argument must be of type object. Received null');
  }
  const context = (contextObject === undefined ? {} : contextObject) as T & ContextObject;
  Object.defineProperty(context, VM_CONTEXT, {
    configurable: false,
    enumerable: false,
    value: true,
  });
  return context;
}

export function isContext(value: unknown): boolean {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    (value as ContextObject)[VM_CONTEXT] === true
  );
}

export function runInThisContext(code: string, options?: VmOptions): unknown {
  const normalized = normalizeOptions(options);
  assertSupportedScriptOptions(normalized, 'vm.runInThisContext');
  return runGlobalScript(withSourceURL(asSource(code), normalized.filename));
}

export function runInContext(
  code: string,
  contextifiedObject: Record<string, unknown>,
  options?: VmOptions,
): unknown {
  const normalized = normalizeOptions(options);
  assertSupportedScriptOptions(normalized, 'vm.runInContext');
  assertObjectContext(contextifiedObject);
  if (!isContext(contextifiedObject)) {
    throw new TypeError('The "contextifiedObject" argument must be a vm.Context.');
  }
  const proxy = contextProxy(contextifiedObject as ContextObject);
  const rewritten = rewriteContextSource(asSource(code));
  return runContextScript.call(proxy, proxy, withSourceURL(rewritten, normalized.filename));
}

export function runInNewContext(
  code: string,
  contextObject?: Record<string, unknown>,
  options?: VmOptions,
): unknown {
  if (contextObject === null) {
    throw new TypeError('The "object" argument must be of type object. Received null');
  }
  const context = createContext(contextObject === undefined ? {} : contextObject);
  return runInContext(code, context, options);
}

export class Script {
  readonly #code: string;
  readonly #filename?: string;

  constructor(code: string, options?: VmOptions) {
    const normalized = normalizeOptions(options);
    assertSupportedScriptOptions(normalized, 'vm.Script');
    this.#code = asSource(code);
    this.#filename = normalized.filename;
  }

  runInThisContext(options?: VmOptions): unknown {
    return runInThisContext(this.#code, { ...normalizeOptions(options), filename: this.#filename });
  }

  runInContext(contextifiedObject: Record<string, unknown>, options?: VmOptions): unknown {
    return runInContext(this.#code, contextifiedObject, {
      ...normalizeOptions(options),
      filename: this.#filename,
    });
  }

  runInNewContext(contextObject?: Record<string, unknown>, options?: VmOptions): unknown {
    return runInNewContext(this.#code, contextObject, {
      ...normalizeOptions(options),
      filename: this.#filename,
    });
  }
}

export function compileFunction(
  code: string,
  params: string[] = [],
  options?: CompileFunctionOptions,
): (...args: unknown[]) => unknown {
  assertSupportedCompileOptions(options ?? {});
  for (const param of params) {
    if (typeof param !== 'string') {
      throw new TypeError('Function parameters must be strings.');
    }
  }
  return new Function(...params, asSource(code)) as (...args: unknown[]) => unknown;
}

const vmModule = {
  Script,
  compileFunction,
  createContext,
  isContext,
  runInContext,
  runInNewContext,
  runInThisContext,
};

export default vmModule;
