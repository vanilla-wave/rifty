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
  SwitchStatement,
  UnaryExpression,
  UpdateExpression,
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
  // mutable: a sub-walk swaps in a temp list to render a node to string
  // (rewriteFunctionToString) without polluting the main edit stream.
  edits: SourceEdit[];
  readonly scopes: Array<Set<string>>;
  readonly contextVarNames: Set<string>;
  readonly helperName: string;
  // block-scoped temp for completion-neutralising wrappers (`{ let T = (…); }`).
  readonly tempName: string;
  readonly source: string;
  functionDepth: number;
}

interface ContextRewrite {
  readonly source: string;
  readonly contextVarNames: readonly string[];
  readonly helperName: string;
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

// Direct `eval(...)` in vm code evaluates UNREWRITTEN source, so writes to
// undeclared names inside it leak to the host realm. Faithful interception needs
// realm-level support this host-realm `with(proxy)+eval` design cannot provide —
// a permanent divergence recorded in ADR-0138. `eval` is a helper binding so the
// `with` proxy never shadows the host `eval` the rewritten code calls.
const HELPER_BINDINGS = new Set<PropertyKey>(['__riftyVmContext', '__riftyVmSource', 'eval']);
const activeHelperBindings = new Map<PropertyKey, number>();
const activeContextVarBindings = new WeakMap<ContextObject, Set<PropertyKey>>();

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
        !isHelperBinding(prop) &&
        (prop === 'globalThis' ||
          Reflect.has(context, prop) ||
          isActiveContextVarBinding(context, prop) ||
          INTRINSIC_GLOBALS.has(prop))
      );
    },
    get(target, prop, receiver) {
      if (prop === Symbol.unscopables) return undefined;
      if (prop === 'globalThis') return proxy;
      if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver) as unknown;
      if (isActiveContextVarBinding(target, prop)) return undefined;
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

function isHelperBinding(prop: PropertyKey): boolean {
  return HELPER_BINDINGS.has(prop) || activeHelperBindings.has(prop);
}

function pushActiveHelperBinding(prop: PropertyKey): void {
  activeHelperBindings.set(prop, (activeHelperBindings.get(prop) ?? 0) + 1);
}

function popActiveHelperBinding(prop: PropertyKey): void {
  const count = activeHelperBindings.get(prop) ?? 0;
  if (count <= 1) activeHelperBindings.delete(prop);
  else activeHelperBindings.set(prop, count - 1);
}

function isActiveContextVarBinding(context: ContextObject, prop: PropertyKey): boolean {
  return activeContextVarBindings.get(context)?.has(prop) ?? false;
}

// Once a `var` / top-level-function name is declared in a context it stays a known
// global of that context for its lifetime (Node parity): reads after the run — and
// in later runs of the same context — resolve to `undefined` instead of falling
// through to the host realm. The name is NOT an own property until something
// assigns it, so `name in rawContext` stays false like Node's `var x;`.
function registerContextVarBindings(context: ContextObject, names: readonly string[]): void {
  if (names.length === 0) return;
  let bindings = activeContextVarBindings.get(context);
  if (!bindings) {
    bindings = new Set();
    activeContextVarBindings.set(context, bindings);
  }
  for (const name of names) bindings.add(name);
}

function runContextScript(context: ContextProxy, source: string, helperName: string): unknown {
  const runner = new Function(
    '__riftyVmContext',
    '__riftyVmSource',
    helperName,
    'with (__riftyVmContext) { return eval(__riftyVmSource); }',
  ) as (context: ContextProxy, source: string, global: ContextProxy) => unknown;
  pushActiveHelperBinding(helperName);
  try {
    return runner.call(context, context, source, context);
  } finally {
    popActiveHelperBinding(helperName);
  }
}

// Edits must not overlap. At a shared start a zero-width insert sorts before a
// replacement (ascending end) so a prelude/`{ let T = (` opener emits before the
// `var ` text it precedes; a stable sort keeps the push order of coincident inserts.
function sortEdits(edits: SourceEdit[]): SourceEdit[] {
  return edits.sort((a, b) => a.start - b.start || a.end - b.end);
}

function applySourceEdits(source: string, edits: SourceEdit[]): string {
  if (edits.length === 0) return source;
  let out = '';
  let cursor = 0;
  for (const edit of sortEdits(edits)) {
    out += source.slice(cursor, edit.start);
    out += edit.text;
    cursor = edit.end;
  }
  out += source.slice(cursor);
  return out;
}

// Render `source[start, end)` with `edits` (absolute coords inside the slice)
// applied. Used to hoist a top-level function declaration into a prelude with its
// nested writes already rewritten, without those edits hitting the main stream.
function applyEditsToSlice(
  source: string,
  start: number,
  end: number,
  edits: SourceEdit[],
): string {
  let out = '';
  let cursor = start;
  for (const edit of sortEdits(edits)) {
    out += source.slice(cursor, edit.start);
    out += edit.text;
    cursor = edit.end;
  }
  out += source.slice(cursor, end);
  return out;
}

function identifierName(node: unknown): string | null {
  return (node as { type?: string; name?: string }).type === 'Identifier'
    ? ((node as Identifier).name ?? null)
    : null;
}

function makeContextHelperName(source: string): string {
  let suffix = 0;
  let candidate = '__riftyVmGlobal';
  while (source.includes(candidate)) {
    suffix += 1;
    candidate = `__riftyVmGlobal${suffix}`;
  }
  return candidate;
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

// Register every name a `var` declarator binds (incl. destructuring patterns) as a
// context var, so reads before assignment — and after the run — resolve to
// `undefined` on the context instead of the host realm.
function registerContextVarNames(ctx: RewriteContext, pat: Pattern): void {
  switch (pat.type) {
    case 'Identifier':
      ctx.contextVarNames.add(pat.name);
      return;
    case 'ObjectPattern':
      for (const property of pat.properties) {
        if (property.type === 'RestElement') registerContextVarNames(ctx, property.argument);
        else registerContextVarNames(ctx, property.value);
      }
      return;
    case 'ArrayPattern':
      for (const element of pat.elements) {
        if (element) registerContextVarNames(ctx, element);
      }
      return;
    case 'RestElement':
      registerContextVarNames(ctx, pat.argument);
      return;
    case 'AssignmentPattern':
      registerContextVarNames(ctx, (pat as AssignmentPattern).left);
      return;
    default:
      return;
  }
}

// Redirect one top-level `var` declarator's write onto the context, leaving the
// initializer in source so nested writes are still walked (a raw-slice rebuild
// would leak `var a = function () { x = 1 }` to the host). `helper.x` for a simple
// id (a harmless read when there is no initializer); a destructuring-assignment
// target for a pattern (`{ a } → ({ a: helper.a } = init)`).
function emitContextVarDeclaratorWrite(
  ctx: RewriteContext,
  declarator: VariableDeclaration['declarations'][number],
): void {
  const name = identifierName(declarator.id);
  if (name) {
    ctx.edits.push({
      start: declarator.id.start,
      end: declarator.id.end,
      text: `${ctx.helperName}.${name}`,
    });
    if (declarator.init) walkContextNode(declarator.init, ctx);
    return;
  }
  // Pattern target: wrap in parens so `{…}`/`[…]` parses as a destructuring
  // assignment (not a block / array literal) inside the surrounding sequence.
  // Close at the declarator's end (NOT init.end): acorn strips a parenthesised
  // initializer's outer `)` from the init node, so init.end would land inside the
  // user's parens.
  ctx.edits.push({ start: declarator.id.start, end: declarator.id.start, text: '(' });
  rewriteAssignmentTargetPattern(declarator.id as unknown as Pattern, ctx);
  ctx.edits.push({ start: declarator.end, end: declarator.end, text: ')' });
  if (declarator.init) walkContextNode(declarator.init, ctx);
}

// Top-level `var` as a STATEMENT. Node gives a `var` statement an EMPTY completion
// value (`9; var x = 1` ⇒ 9, not 1), so the writes are wrapped in a
// completion-neutral `{ let T = (…); }` block rather than left as a bare
// assignment-expression statement. Declarators are joined by the source commas
// acting as the sequence operator.
function emitContextVarStatement(ctx: RewriteContext, declaration: VariableDeclaration): void {
  const declarators = declaration.declarations;
  const first = declarators[0];
  if (!first) return;
  for (const declarator of declarators) registerContextVarNames(ctx, declarator.id);
  // Replace the `var ` keyword with the block + let + opening paren.
  ctx.edits.push({
    start: declaration.start,
    end: first.id.start,
    text: `{ let ${ctx.tempName} = (`,
  });
  for (const declarator of declarators) emitContextVarDeclaratorWrite(ctx, declarator);
  // Close at the last declarator's end, which includes any wrapping parens acorn
  // strips from the init node (`var c = (1, 2, 3)` — init.end is before the `)`).
  const last = declarators[declarators.length - 1];
  const closeAt = last?.end ?? declaration.end;
  ctx.edits.push({ start: closeAt, end: closeAt, text: '); }' });
}

// Top-level `var` as a for-loop INIT (expression position: no completion to
// neutralise, no block wrapper). Strip `var ` and redirect each declarator inline.
function emitContextVarForInit(ctx: RewriteContext, declaration: VariableDeclaration): void {
  const declarators = declaration.declarations;
  const first = declarators[0];
  if (!first) return;
  for (const declarator of declarators) registerContextVarNames(ctx, declarator.id);
  ctx.edits.push({ start: declaration.start, end: first.id.start, text: '' });
  for (const declarator of declarators) {
    const name = identifierName(declarator.id);
    if (name && !declarator.init) {
      // `for (var x; …)` — Node leaves x off the context; keep the slot value-less.
      ctx.edits.push({ start: declarator.id.start, end: declarator.id.end, text: 'void 0' });
    } else {
      emitContextVarDeclaratorWrite(ctx, declarator);
    }
  }
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

// Rewrite unbound Identifier targets inside destructuring assignments so the
// writes land on the context (`({ a } = o)` → `({ a: helper.a } = o)`).
function rewriteAssignmentTargetPattern(pattern: Pattern, ctx: RewriteContext): void {
  switch (pattern.type) {
    case 'Identifier':
      if (!isBound(ctx, pattern.name)) {
        ctx.edits.push({
          start: pattern.start,
          end: pattern.end,
          text: `${ctx.helperName}.${pattern.name}`,
        });
      }
      return;
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        if (property.type === 'RestElement') {
          rewriteAssignmentTargetPattern(property.argument, ctx);
          continue;
        }
        if (property.computed) walkContextNode(property.key, ctx);
        if (property.shorthand) {
          const value = property.value;
          const target = value.type === 'AssignmentPattern' ? value.left : value;
          const targetName = identifierName(target);
          if (targetName && !isBound(ctx, targetName)) {
            // Shorthand must expand: `{ a }` → `{ a: helper.a }`.
            ctx.edits.push({
              start: target.start,
              end: target.end,
              text: `${targetName}: ${ctx.helperName}.${targetName}`,
            });
          }
          if (value.type === 'AssignmentPattern') walkContextNode(value.right, ctx);
        } else {
          rewriteAssignmentTargetPattern(property.value as Pattern, ctx);
        }
      }
      return;
    case 'ArrayPattern':
      for (const element of pattern.elements) {
        if (element) rewriteAssignmentTargetPattern(element, ctx);
      }
      return;
    case 'AssignmentPattern':
      rewriteAssignmentTargetPattern(pattern.left, ctx);
      walkContextNode(pattern.right, ctx);
      return;
    case 'RestElement':
      rewriteAssignmentTargetPattern(pattern.argument, ctx);
      return;
    default:
      // MemberExpression and other expression targets only need their reads walked.
      walkContextNode(pattern, ctx);
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

// Render a top-level function declaration as a named function-expression string
// with its nested writes already rewritten, for hoisting into the program prelude.
// Walks into a temp edit list so the body rewrites don't touch the main stream;
// the original declaration site is removed separately by the Program case.
function rewriteFunctionToString(ctx: RewriteContext, fn: AnyNodeShape): string {
  const outer = ctx.edits;
  const inner: SourceEdit[] = [];
  ctx.edits = inner;
  walkFunction(fn as unknown as AcornFunction, ctx);
  ctx.edits = outer;
  return applyEditsToSlice(ctx.source, fn.start, fn.end, inner);
}

function walkForStatement(statement: ForStatement, ctx: RewriteContext): void {
  pushScope(ctx);
  if (statement.init) {
    if ((statement.init as unknown as AnyNodeShape).type === 'VariableDeclaration') {
      const declaration = statement.init as unknown as VariableDeclaration;
      if (declaration.kind === 'var' && ctx.functionDepth === 0) {
        emitContextVarForInit(ctx, declaration);
      } else {
        if (declaration.kind !== 'var') declareVarDecl(ctx, declaration);
        walkContextNode(statement.init, ctx);
      }
    } else {
      walkContextNode(statement.init, ctx);
    }
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
  const left = statement.left as unknown as AnyNodeShape;
  if (left.type === 'VariableDeclaration') {
    const declaration = statement.left as unknown as VariableDeclaration;
    if (declaration.kind === 'var' && ctx.functionDepth === 0) {
      // `for (var k in o)` hoists k onto the context; a member expression (or a
      // parenthesised destructuring assignment) is a valid loop target, so rewrite
      // the whole declaration to `helper.k` / `({ a: helper.a })`.
      const declarator = declaration.declarations[0];
      if (declarator) {
        registerContextVarNames(ctx, declarator.id);
        const name = identifierName(declarator.id);
        if (name) {
          ctx.edits.push({
            start: declaration.start,
            end: declaration.end,
            text: `${ctx.helperName}.${name}`,
          });
        } else {
          // `for (var { a } of o)` → `for ({ a: helper.a } of o)`. A for-of/in
          // target pattern must NOT be parenthesised, so just strip `var ` and
          // redirect the pattern's ids in place (mirrors the no-`var` case below).
          ctx.edits.push({ start: declaration.start, end: declarator.id.start, text: '' });
          rewriteAssignmentTargetPattern(declarator.id as unknown as Pattern, ctx);
        }
      }
    } else {
      if (declaration.kind !== 'var') declareVarDecl(ctx, declaration);
      walkContextNode(statement.left, ctx);
    }
  } else {
    const name = identifierName(statement.left);
    if (name) {
      if (!isBound(ctx, name)) {
        ctx.edits.push({ start: left.start, end: left.end, text: `${ctx.helperName}.${name}` });
      }
    } else if (left.type === 'ObjectPattern' || left.type === 'ArrayPattern') {
      rewriteAssignmentTargetPattern(statement.left as unknown as Pattern, ctx);
    } else {
      walkContextNode(statement.left, ctx);
    }
  }
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
      const body = program.body as unknown as AnyNodeShape[];
      predeclareLexicalBody(ctx, body);

      // Hoist top-level function declarations: copy each onto the context via a
      // prelude that runs before any user statement, then remove the original
      // sites. Unlike a leave-in-place declaration, this makes `f()` callable
      // before its text AND keeps a later `f = …` reassignment visible (no local
      // eval binding to shadow it); the block-let prelude keeps an empty
      // completion (`function f(){}` ⇒ undefined, like Node).
      const fnDecls = body.filter(
        (child) =>
          child.type === 'FunctionDeclaration' && (child as unknown as FunctionDeclaration).id,
      );
      if (fnDecls.length > 0) {
        const assigns = fnDecls
          .map(
            (fn) =>
              `${ctx.helperName}.${(fn as unknown as FunctionDeclaration).id?.name} = ${rewriteFunctionToString(ctx, fn)}`,
          )
          .join(', ');
        for (const fn of fnDecls) {
          ctx.contextVarNames.add((fn as unknown as FunctionDeclaration).id?.name as string);
        }
        // Prelude runs before the first user statement (zero-width insert, ordered
        // ahead of that statement's own edits by sortEdits); each original site
        // becomes an empty statement.
        const at = body[0]?.start ?? program.start;
        ctx.edits.push({ start: at, end: at, text: `{ let ${ctx.tempName} = (${assigns}); } ` });
        for (const fn of fnDecls) ctx.edits.push({ start: fn.start, end: fn.end, text: ';' });
      }

      for (const child of body) {
        if (child.type === 'FunctionDeclaration') continue; // hoisted above
        walkContextNode(child, ctx);
      }
      return;
    }

    case 'BlockStatement':
      walkBlock((n as unknown as { body: AnyNodeShape[] }).body, ctx);
      return;

    case 'FunctionDeclaration': {
      // Program-level declarations are hoisted into the prelude by the Program
      // case and never reach here. This covers block-level (Annex B, depth 0) and
      // nested (depth > 0) declarations: a block-level one copies onto the context
      // in place when its block runs (best-effort; full Annex B hoisting is out of
      // scope), a nested one binds locally.
      const declaration = n as unknown as FunctionDeclaration;
      if (ctx.functionDepth === 0 && declaration.id) {
        ctx.edits.push({
          start: declaration.start,
          end: declaration.start,
          text: `${ctx.helperName}.${declaration.id.name} = `,
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
          emitContextVarStatement(ctx, declaration);
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
      const left = assignment.left;
      const name = identifierName(left);
      if (name && !isBound(ctx, name)) {
        if (assignment.operator === '=') {
          ctx.edits.push({
            start: left.start,
            end: left.end,
            text: `${ctx.helperName}.${name}`,
          });
        } else if (
          assignment.operator === '&&=' ||
          assignment.operator === '||=' ||
          assignment.operator === '??='
        ) {
          // `x &&= v` → `(x && (helper.x = v))`: the read resolves through the
          // normal scope chain (ReferenceError stays loud), only the write is
          // redirected, and short-circuiting skips the write entirely.
          const op = assignment.operator.slice(0, -1);
          ctx.edits.push({ start: assignment.start, end: left.start, text: '(' });
          ctx.edits.push({
            start: left.end,
            end: assignment.right.start,
            text: ` ${op} (${ctx.helperName}.${name} = `,
          });
          ctx.edits.push({ start: assignment.end, end: assignment.end, text: '))' });
        } else {
          // `x += v` → `helper.x = x + (v)`: read through the scope chain,
          // write to the context.
          const op = assignment.operator.slice(0, -1);
          ctx.edits.push({
            start: left.start,
            end: assignment.right.start,
            text: `${ctx.helperName}.${name} = ${name} ${op} (`,
          });
          ctx.edits.push({ start: assignment.end, end: assignment.end, text: ')' });
        }
        walkContextNode(assignment.right, ctx);
        return;
      }
      if (left.type === 'ObjectPattern' || left.type === 'ArrayPattern') {
        rewriteAssignmentTargetPattern(left as unknown as Pattern, ctx);
      } else {
        walkContextNode(left, ctx);
      }
      walkContextNode(assignment.right, ctx);
      return;
    }

    case 'UpdateExpression': {
      const update = n as unknown as UpdateExpression;
      const name = identifierName(update.argument);
      if (name && !isBound(ctx, name)) {
        // Redirect the write while keeping ToNumeric coercion and the
        // prefix/postfix result value; the argument read stays loud.
        const tmp = `${ctx.helperName}Tmp`;
        const step = update.operator === '++' ? `++${tmp}` : `--${tmp}`;
        const undo = update.operator === '++' ? `--${tmp}` : `++${tmp}`;
        const text = update.prefix
          ? `((${tmp}) => (${ctx.helperName}.${name} = ${step}))(${name})`
          : `((${tmp}) => (${step}, ${ctx.helperName}.${name} = ${tmp}, ${undo}))(${name})`;
        ctx.edits.push({ start: update.start, end: update.end, text });
        return;
      }
      walkDefault(n, ctx);
      return;
    }

    case 'UnaryExpression': {
      const unary = n as unknown as UnaryExpression;
      if (unary.operator === 'delete') {
        const name = identifierName(unary.argument);
        if (name && !isBound(ctx, name)) {
          // Unrewritten `delete x` on an unbound name would fall through the
          // `with` scope and delete the HOST global.
          ctx.edits.push({
            start: unary.argument.start,
            end: unary.argument.end,
            text: `${ctx.helperName}.${name}`,
          });
          return;
        }
      }
      walkDefault(n, ctx);
      return;
    }

    case 'SwitchStatement': {
      const switchStatement = n as unknown as SwitchStatement;
      walkContextNode(switchStatement.discriminant, ctx);
      pushScope(ctx);
      const caseBody: AnyNodeShape[] = [];
      for (const switchCase of switchStatement.cases) {
        for (const statement of switchCase.consequent) {
          caseBody.push(statement as unknown as AnyNodeShape);
        }
      }
      predeclareLexicalBody(ctx, caseBody);
      for (const switchCase of switchStatement.cases) {
        if (switchCase.test) walkContextNode(switchCase.test, ctx);
        for (const statement of switchCase.consequent) walkContextNode(statement, ctx);
      }
      popScope(ctx);
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

function rewriteContextSource(source: string): ContextRewrite {
  const program = acornParse(source, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowReturnOutsideFunction: true,
  }) as Program;
  const helperName = makeContextHelperName(source);
  const ctx: RewriteContext = {
    edits: [],
    scopes: [new Set()],
    contextVarNames: new Set(),
    helperName,
    // helperName never appears in source (by construction), so this won't collide;
    // it is block-scoped anyway. Reused across every `{ let T = (…); }` wrapper.
    tempName: `${helperName}T`,
    source,
    functionDepth: 0,
  };

  walkContextNode(program, ctx);
  return {
    source: applySourceEdits(source, ctx.edits),
    contextVarNames: [...ctx.contextVarNames],
    helperName,
  };
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

// Run an already-rewritten script against a contextified object. The rewrite is
// context-independent, so `vm.Script` computes it once and reuses it here.
function runRewrittenInContext(
  rewritten: ContextRewrite,
  contextifiedObject: Record<string, unknown>,
  filename?: string,
): unknown {
  assertObjectContext(contextifiedObject);
  if (!isContext(contextifiedObject)) {
    throw new TypeError('The "contextifiedObject" argument must be a vm.Context.');
  }
  const context = contextifiedObject as ContextObject;
  const proxy = contextProxy(context);
  // Permanent registration (not push/pop): a declared `var` stays a known global
  // of the context — readable as `undefined` after the run and in later runs —
  // instead of falling through to the host realm afterwards.
  registerContextVarBindings(context, rewritten.contextVarNames);
  return runContextScript(proxy, withSourceURL(rewritten.source, filename), rewritten.helperName);
}

export function runInContext(
  code: string,
  contextifiedObject: Record<string, unknown>,
  options?: VmOptions,
): unknown {
  const normalized = normalizeOptions(options);
  assertSupportedScriptOptions(normalized, 'vm.runInContext');
  return runRewrittenInContext(
    rewriteContextSource(asSource(code)),
    contextifiedObject,
    normalized.filename,
  );
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
  // Memoised AST rewrite — parse + rewrite once, reuse across every run of this
  // Script instance (the rewrite does not depend on the target context).
  #rewrite?: ContextRewrite;

  constructor(code: string, options?: VmOptions) {
    const normalized = normalizeOptions(options);
    assertSupportedScriptOptions(normalized, 'vm.Script');
    this.#code = asSource(code);
    this.#filename = normalized.filename;
  }

  #getRewrite(): ContextRewrite {
    if (!this.#rewrite) this.#rewrite = rewriteContextSource(this.#code);
    return this.#rewrite;
  }

  runInThisContext(options?: VmOptions): unknown {
    return runInThisContext(this.#code, { ...normalizeOptions(options), filename: this.#filename });
  }

  runInContext(contextifiedObject: Record<string, unknown>, options?: VmOptions): unknown {
    const normalized = { ...normalizeOptions(options), filename: this.#filename };
    assertSupportedScriptOptions(normalized, 'vm.Script');
    return runRewrittenInContext(this.#getRewrite(), contextifiedObject, normalized.filename);
  }

  runInNewContext(contextObject?: Record<string, unknown>, options?: VmOptions): unknown {
    if (contextObject === null) {
      throw new TypeError('The "object" argument must be of type object. Received null');
    }
    const normalized = { ...normalizeOptions(options), filename: this.#filename };
    assertSupportedScriptOptions(normalized, 'vm.Script');
    const context = createContext(contextObject === undefined ? {} : contextObject);
    return runRewrittenInContext(this.#getRewrite(), context, normalized.filename);
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
