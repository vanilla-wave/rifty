/**
 * AST-based ESM → async-function-body transformer.
 *
 * Replaces the earlier regex + zone-scanner approach (ADR 0009). acorn parses
 * the source; the walk tracks lexical scopes so identifier references that look
 * like imports but are shadowed by a parameter or local binding are left alone.
 *
 * The result body, run as the body of an `async () => { ... }`, uses generated
 * helper names chosen per source so user bindings cannot shadow loader plumbing.
 */

import type {
  Function as AcornFunction,
  ArrayPattern,
  AssignmentPattern,
  CatchClause,
  ClassDeclaration,
  ClassExpression,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  Identifier,
  ImportExpression,
  MemberExpression,
  MetaProperty,
  ObjectPattern,
  Pattern,
  Program,
  Property,
  RestElement,
  VariableDeclaration,
} from 'acorn';
import { parse as acornParse } from 'acorn';
import { rewriteDirectEvalImportArgument } from './direct-eval-import.ts';
import { ModuleLoadError } from './errors.ts';
import {
  type EsmAstEdit as Edit,
  type EsmImportBinding as ImportBinding,
  type LinkedExports,
  type TransformHelperNames,
  planEsmDeclarations,
  renderImportBinding,
} from './esm-declaration-plan.ts';

export type {
  LinkedExports,
  LinkedImportBinding,
  LinkedImportRequirement,
  LinkedLocalExport,
  LinkedNamedReexport,
  LinkedNamespaceReexport,
  TransformHelperNames,
} from './esm-declaration-plan.ts';

/**
 * Mangled binding the generated body uses to reach the REAL global `Object`
 * (for `Object.defineProperty`/`Object.keys` in export/re-export codegen). A
 * module may legally `export const Object = …` (opencode's `config/permission.ts`
 * does), shadowing the global and breaking bare `Object.*` in generated code.
 * `esm.ts` binds this name to the real `Object` at FUNCTION scope — outside the
 * user-body arrow, where the module's `const Object` can't reach it. Kept in
 * sync with `esm.ts`, the only consumer.
 */
export const RUNTIME_OBJECT_BINDING = '__riftyObject';

type Scope = Map<string, true>;

interface Ctx {
  readonly source: string;
  readonly imports: Map<string, ImportBinding>;
  readonly edits: Edit[];
  readonly helpers: TransformHelperNames;
  /** Stack of scopes; index 0 is module scope. */
  readonly scopes: Scope[];
  /**
   * Spans we should not emit identifier rewrites into (e.g. inside an
   * already-replaced import declaration). Sorted by start.
   */
  readonly forbiddenSpans: Array<readonly [number, number]>;
}

function pushScope(ctx: Ctx): void {
  ctx.scopes.push(new Map());
}
function popScope(ctx: Ctx): void {
  ctx.scopes.pop();
}
function addBinding(ctx: Ctx, name: string): void {
  const top = ctx.scopes[ctx.scopes.length - 1];
  if (top) top.set(name, true);
}
function isShadowed(ctx: Ctx, name: string): boolean {
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const s = ctx.scopes[i];
    if (s?.has(name)) return true;
  }
  return false;
}

function declarePattern(ctx: Ctx, pat: Pattern): void {
  switch (pat.type) {
    case 'Identifier':
      addBinding(ctx, pat.name);
      return;
    case 'ObjectPattern':
      for (const p of (pat as ObjectPattern).properties) {
        if (p.type === 'RestElement') declarePattern(ctx, p.argument);
        else declarePattern(ctx, p.value);
      }
      return;
    case 'ArrayPattern':
      for (const el of (pat as ArrayPattern).elements) {
        if (el) declarePattern(ctx, el);
      }
      return;
    case 'RestElement':
      declarePattern(ctx, (pat as RestElement).argument);
      return;
    case 'AssignmentPattern':
      declarePattern(ctx, (pat as AssignmentPattern).left);
      return;
    default:
      // MemberExpression in assignment-target patterns: no binding.
      return;
  }
}

function declareVarDecl(ctx: Ctx, decl: VariableDeclaration): void {
  for (const d of decl.declarations) declarePattern(ctx, d.id);
}

function isForbidden(ctx: Ctx, start: number, end: number): boolean {
  // Linear scan is fine (small N — one entry per top-level import/export).
  for (const [s, e] of ctx.forbiddenSpans) {
    if (start >= s && end <= e) return true;
    if (start >= e) continue;
    if (end <= s) break;
  }
  return false;
}

function emitEdit(ctx: Ctx, start: number, end: number, text: string): void {
  if (isForbidden(ctx, start, end)) return;
  ctx.edits.push({ start, end, text });
}

function replacementFor(b: ImportBinding): string {
  return renderImportBinding(b);
}

/**
 * Walks the program with a stack of lexical scopes. For each identifier
 * reference (a use, not a declaration / static property name / object key /
 * label) that matches an imported binding and is not shadowed, emits an edit
 * replacing it with the namespace member access. Also rewrites `import.meta`
 * (MetaProperty) → the wrapper-injected import-meta local and dynamic
 * `import(x)` (ImportExpression) → the wrapper-injected dynamic import helper.
 */
function collectRewrites(
  program: Program,
  source: string,
  imports: Map<string, ImportBinding>,
  edits: Edit[],
  helpers: TransformHelperNames,
): void {
  const forbiddenSpans: Array<readonly [number, number]> = [];
  for (const e of edits) forbiddenSpans.push([e.start, e.end]);
  forbiddenSpans.sort((a, b) => a[0] - b[0]);

  const ctx: Ctx = {
    source,
    imports,
    edits,
    helpers,
    scopes: [new Map()],
    forbiddenSpans,
  };

  // Pre-declare top-level names into module scope before walking, so forward
  // references inside hoisted function bodies see correct shadowing (a top-level
  // `function foo() {}` must shadow a same-named import).
  for (const node of program.body) {
    if (node.type === 'FunctionDeclaration' && node.id) addBinding(ctx, node.id.name);
    else if (node.type === 'ClassDeclaration' && node.id) addBinding(ctx, node.id.name);
    else if (node.type === 'VariableDeclaration') declareVarDecl(ctx, node);
    else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      const decl = node.declaration;
      if (decl.type === 'FunctionDeclaration' && decl.id) addBinding(ctx, decl.id.name);
      else if (decl.type === 'ClassDeclaration' && decl.id) addBinding(ctx, decl.id.name);
      else if (decl.type === 'VariableDeclaration') declareVarDecl(ctx, decl);
    } else if (node.type === 'ExportDefaultDeclaration') {
      const decl = node.declaration;
      if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id) {
        addBinding(ctx, decl.id.name);
      }
    }
  }

  walk(program, ctx);
}

interface AnyNodeShape {
  type: string;
  start: number;
  end: number;
  [k: string]: unknown;
}

function walk(node: unknown, ctx: Ctx): void {
  if (!node || typeof node !== 'object') return;
  const n = node as AnyNodeShape;
  if (typeof n.type !== 'string') return;

  switch (n.type) {
    case 'Program':
      for (const child of (n as unknown as Program).body) walk(child, ctx);
      return;

    case 'ImportDeclaration':
    case 'ExportAllDeclaration':
      // Whole node was rewritten; nothing inside to walk for identifier refs.
      return;

    case 'ExportNamedDeclaration': {
      const en = n as unknown as {
        source?: { value: string } | null;
        declaration?: AnyNodeShape | null;
      };
      // Re-export with source: rewritten whole, skip.
      if (en.source) return;
      // `export { a, b }`: slot-getter edits already emitted; skip the specifier
      // subtree to avoid double-walking the local-name identifiers.
      if (en.declaration) walk(en.declaration, ctx);
      return;
    }

    case 'ExportDefaultDeclaration': {
      const ed = n as unknown as { declaration: AnyNodeShape };
      walk(ed.declaration, ctx);
      return;
    }

    case 'Identifier': {
      const id = n as unknown as Identifier;
      if (id.name === 'WebAssembly' && !isShadowed(ctx, id.name)) {
        emitEdit(ctx, id.start, id.end, ctx.helpers.webAssembly);
        return;
      }
      const binding = ctx.imports.get(id.name);
      if (!binding) return;
      if (isShadowed(ctx, id.name)) return;
      emitEdit(ctx, id.start, id.end, replacementFor(binding));
      return;
    }

    case 'MemberExpression': {
      const me = n as unknown as MemberExpression;
      walk(me.object, ctx);
      // Non-computed property: not a reference.
      if (me.computed) walk(me.property, ctx);
      return;
    }

    case 'MetaProperty': {
      const mp = n as unknown as MetaProperty;
      // import.meta → generated helper. `new.target` is a MetaProperty too — leave alone.
      if (mp.meta?.name === 'import' && mp.property?.name === 'meta') {
        emitEdit(ctx, mp.start, mp.end, ctx.helpers.importMeta);
      }
      return;
    }

    case 'ImportExpression': {
      const ie = n as unknown as ImportExpression;
      // Rewrite the leading `import` keyword (6 chars) to the dynamic import helper.
      emitEdit(ctx, ie.start, ie.start + 'import'.length, ctx.helpers.dynamicImport);
      walk(ie.source, ctx);
      if (ie.options) walk(ie.options, ctx);
      return;
    }

    case 'CallExpression': {
      const call = n as unknown as {
        callee: AnyNodeShape;
        arguments: AnyNodeShape[];
        optional?: boolean;
      };
      const isDirectEval =
        call.optional !== true &&
        call.callee.type === 'Identifier' &&
        (call.callee as unknown as Identifier).name === 'eval' &&
        !isShadowed(ctx, 'eval');
      const replacement = isDirectEval
        ? rewriteDirectEvalImportArgument(call.arguments[0], ctx.helpers.dynamicImport)
        : null;
      walk(call.callee, ctx);
      for (let index = 0; index < call.arguments.length; index++) {
        const argument = call.arguments[index];
        if (!argument) continue;
        if (index === 0 && replacement !== null) {
          emitEdit(ctx, argument.start, argument.end, replacement);
        } else {
          walk(argument, ctx);
        }
      }
      return;
    }

    case 'Property': {
      const p = n as unknown as Property;
      if (p.computed) walk(p.key, ctx);
      if (p.shorthand) {
        // `{ foo }`: key and value are the same Identifier, so rewriting its
        // range yields invalid `{ <replacement> }`. Expand to `foo: <replacement>`
        // by prepending `name: ` at the value's start.
        const id = p.value as unknown as {
          type: string;
          name?: string;
          start: number;
          end: number;
        };
        if (id.type === 'Identifier' && id.name) {
          if (id.name === 'WebAssembly' && !isShadowed(ctx, id.name)) {
            emitEdit(ctx, id.start, id.start, 'WebAssembly: ');
          }
          const binding = ctx.imports.get(id.name);
          if (binding && !isShadowed(ctx, id.name)) {
            emitEdit(ctx, id.start, id.start, `${id.name}: `);
          }
        }
        walk(p.value, ctx);
      } else {
        walk(p.value, ctx);
      }
      return;
    }

    case 'MethodDefinition': {
      const md = n as unknown as { computed: boolean; key: AnyNodeShape; value: AnyNodeShape };
      if (md.computed) walk(md.key, ctx);
      walk(md.value, ctx);
      return;
    }

    case 'PropertyDefinition': {
      const pd = n as unknown as {
        computed: boolean;
        key: AnyNodeShape;
        value: AnyNodeShape | null;
      };
      if (pd.computed) walk(pd.key, ctx);
      if (pd.value) walk(pd.value, ctx);
      return;
    }

    case 'LabeledStatement': {
      const ls = n as unknown as { body: AnyNodeShape };
      walk(ls.body, ctx);
      return;
    }

    case 'BreakStatement':
    case 'ContinueStatement':
      // Label is not a reference.
      return;

    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      walkFunction(n as unknown as AcornFunction, ctx);
      return;

    case 'BlockStatement':
      walkBlock(n as unknown as { body: AnyNodeShape[] }, ctx);
      return;

    case 'ForStatement':
      walkFor(n as unknown as ForStatement, ctx);
      return;

    case 'ForInStatement':
    case 'ForOfStatement':
      walkForInOf(n as unknown as ForInStatement | ForOfStatement, ctx);
      return;

    case 'CatchClause': {
      const cc = n as unknown as CatchClause;
      pushScope(ctx);
      if (cc.param) declarePattern(ctx, cc.param);
      walk(cc.body, ctx);
      popScope(ctx);
      return;
    }

    case 'ClassDeclaration':
    case 'ClassExpression': {
      const c = n as unknown as ClassDeclaration | ClassExpression;
      pushScope(ctx);
      if (c.id) addBinding(ctx, c.id.name);
      if (c.superClass) walk(c.superClass, ctx);
      walk(c.body, ctx);
      popScope(ctx);
      return;
    }

    case 'VariableDeclaration': {
      const vd = n as unknown as VariableDeclaration;
      // Block / for-init wrappers already declared most names; idempotent here.
      declareVarDecl(ctx, vd);
      for (const d of vd.declarations) {
        walkPatternExpressions(d.id, ctx);
        if (d.init) walk(d.init, ctx);
      }
      return;
    }

    case 'ExportSpecifier':
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'PrivateIdentifier':
    case 'Literal':
    case 'TemplateElement':
    case 'ThisExpression':
    case 'Super':
    case 'DebuggerStatement':
    case 'EmptyStatement':
      // No references inside.
      return;

    default:
      walkDefault(n, ctx);
      return;
  }
}

function walkBlock(block: { body: AnyNodeShape[] }, ctx: Ctx): void {
  pushScope(ctx);
  // Pre-declare hoisted function/class/var names so siblings referring to them
  // aren't rewritten.
  for (const child of block.body) {
    if (child.type === 'FunctionDeclaration') {
      const id = (child as unknown as { id?: Identifier | null }).id;
      if (id) addBinding(ctx, id.name);
    } else if (child.type === 'ClassDeclaration') {
      const id = (child as unknown as { id?: Identifier | null }).id;
      if (id) addBinding(ctx, id.name);
    } else if (child.type === 'VariableDeclaration') {
      declareVarDecl(ctx, child as unknown as VariableDeclaration);
    }
  }
  for (const child of block.body) walk(child, ctx);
  popScope(ctx);
}

function walkFor(fs: ForStatement, ctx: Ctx): void {
  pushScope(ctx);
  if (fs.init) {
    if ((fs.init as unknown as AnyNodeShape).type === 'VariableDeclaration') {
      declareVarDecl(ctx, fs.init as unknown as VariableDeclaration);
    }
    walk(fs.init, ctx);
  }
  if (fs.test) walk(fs.test, ctx);
  if (fs.update) walk(fs.update, ctx);
  walk(fs.body, ctx);
  popScope(ctx);
}

function walkForInOf(fs: ForInStatement | ForOfStatement, ctx: Ctx): void {
  pushScope(ctx);
  if ((fs.left as unknown as AnyNodeShape).type === 'VariableDeclaration') {
    declareVarDecl(ctx, fs.left as unknown as VariableDeclaration);
  }
  walk(fs.left, ctx);
  walk(fs.right, ctx);
  walk(fs.body, ctx);
  popScope(ctx);
}

function walkFunction(fn: AcornFunction, ctx: Ctx): void {
  pushScope(ctx);
  // Function name is in scope in the body (named FunctionExpression: only here;
  // FunctionDeclaration: also in enclosing — harmless either way).
  if (fn.id) addBinding(ctx, fn.id.name);
  for (const p of fn.params) {
    declarePattern(ctx, p);
    walkPatternExpressions(p, ctx);
  }
  walk(fn.body, ctx);
  popScope(ctx);
}

/**
 * Walks the nested expression sub-trees of a pattern (default values, computed
 * keys) so identifier refs in them are processed.
 */
function walkPatternExpressions(pat: Pattern, ctx: Ctx): void {
  switch (pat.type) {
    case 'ObjectPattern':
      for (const p of (pat as ObjectPattern).properties) {
        if (p.type === 'RestElement') {
          walkPatternExpressions(p.argument, ctx);
        } else {
          if (p.computed) walk(p.key, ctx);
          walkPatternExpressions(p.value, ctx);
        }
      }
      return;
    case 'ArrayPattern':
      for (const el of (pat as ArrayPattern).elements) {
        if (el) walkPatternExpressions(el, ctx);
      }
      return;
    case 'RestElement':
      walkPatternExpressions((pat as RestElement).argument, ctx);
      return;
    case 'AssignmentPattern': {
      const ap = pat as AssignmentPattern;
      walkPatternExpressions(ap.left, ctx);
      walk(ap.right, ctx);
      return;
    }
    default:
      return;
  }
}

/** Fallback: walk every plain child node/array of nodes. */
function walkDefault(n: AnyNodeShape, ctx: Ctx): void {
  for (const key of Object.keys(n)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
      continue;
    }
    const v = n[key];
    if (!v) continue;
    if (Array.isArray(v)) {
      for (const item of v) walk(item, ctx);
    } else if (typeof v === 'object') {
      walk(v, ctx);
    }
  }
}

export interface TransformResult {
  /** The rewritten body (no `async () =>` wrapper — caller adds that). */
  readonly body: string;
  /** 1-based body-line -> 1-based pre-rewrite source line. `0` means generated code. */
  readonly lineMap: readonly number[];
  /** Every static import / re-export specifier — preloaded by the caller. */
  readonly staticImports: readonly string[];
  /** True when module evaluation itself can suspend (nested functions excluded). */
  readonly hasTopLevelAwait: boolean;
  /** Static export graph descriptors consumed by the loader's link phase. */
  readonly linkedExports: LinkedExports;
  /** Generator pre-yield declarations: exposes bindings after declaration instantiation. */
  readonly instantiationBody: string;
  /** Exported function/var bindings require the shared generator environment before deps run. */
  readonly needsGeneratorInstantiation: boolean;
  /** Collision-free helper identifiers used by the rewritten body. */
  readonly helpers: TransformHelperNames;
}

function uniqueHelperName(source: string, used: Set<string>, base: string): string {
  let candidate = base;
  let suffix = 0;
  while (used.has(candidate) || source.includes(candidate)) {
    suffix++;
    candidate = `${base}${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

function createHelperNames(source: string): TransformHelperNames {
  const used = new Set<string>();
  return {
    dynamicImport: uniqueHelperName(source, used, '__import'),
    importStatic: uniqueHelperName(source, used, '__importStatic'),
    slots: uniqueHelperName(source, used, '__slots'),
    rebuildExports: uniqueHelperName(source, used, '__rebuildExports'),
    importMeta: uniqueHelperName(source, used, 'import_meta'),
    importMetaUrl: uniqueHelperName(source, used, '__importMetaUrl'),
    metaDirname: uniqueHelperName(source, used, '__metaDirname'),
    metaFilename: uniqueHelperName(source, used, '__metaFilename'),
    assetPath: uniqueHelperName(source, used, '__assetPath'),
    metaResolve: uniqueHelperName(source, used, '__metaResolve'),
    runtimeObject: uniqueHelperName(source, used, RUNTIME_OBJECT_BINDING),
    webAssembly: uniqueHelperName(source, used, '__riftyWebAssembly'),
  };
}

/**
 * Transforms an ESM source into an async-function body.
 */
export function transformEsm(source: string, id: string): TransformResult {
  let program: Program;
  try {
    program = acornParse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
      allowImportExportEverywhere: false,
      locations: false,
    });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    throw new ModuleLoadError(
      'SYNTAX_ERROR',
      id,
      `Failed to parse ESM source for ${id}: ${msg}`,
      id,
    );
  }

  const helpers = createHelperNames(source);
  const generatedNames = new Set(Object.values(helpers));
  const declarationPlan = planEsmDeclarations(program, source, helpers, (base) =>
    uniqueHelperName(source, generatedNames, base),
  );
  const edits = declarationPlan.edits;
  collectRewrites(program, source, declarationPlan.importedBindings, edits, helpers);

  const applied = applyEdits(source, edits);
  const body = `${helpers.rebuildExports}();\n${applied.body}`;
  return {
    body,
    lineMap: [0, ...applied.lineMap],
    staticImports: declarationPlan.staticImports,
    hasTopLevelAwait: declarationPlan.hasTopLevelAwait,
    linkedExports: declarationPlan.linkedExports,
    instantiationBody: declarationPlan.instantiationBody,
    needsGeneratorInstantiation: declarationPlan.needsGeneratorInstantiation,
    helpers,
  };
}

interface AppliedEdits {
  readonly body: string;
  readonly lineMap: readonly number[];
}

function applyEdits(source: string, edits: Edit[]): AppliedEdits {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  // Filter overlaps: keep the outer/earlier one.
  const kept: Edit[] = [];
  let lastEnd = -1;
  for (const e of sorted) {
    if (e.start < lastEnd) continue;
    kept.push(e);
    lastEnd = e.end;
  }
  const lineStarts = lineStartsFor(source);
  let out = '';
  let outputLine = 1;
  const lineMap: number[] = [0];
  let cursor = 0;

  function appendGenerated(text: string): void {
    for (const char of text) {
      if (lineMap[outputLine - 1] === undefined) lineMap[outputLine - 1] = 0;
      out += char;
      if (char === '\n') {
        outputLine += 1;
        lineMap[outputLine - 1] = 0;
      }
    }
  }

  function appendSource(text: string, startOffset: number): void {
    let sourceLine = lineAtOffset(lineStarts, startOffset);
    for (const char of text) {
      if (lineMap[outputLine - 1] === 0 || lineMap[outputLine - 1] === undefined) {
        lineMap[outputLine - 1] = sourceLine;
      }
      out += char;
      if (char === '\n') {
        outputLine += 1;
        sourceLine += 1;
        lineMap[outputLine - 1] = sourceLine;
      }
    }
  }

  for (const e of kept) {
    appendSource(source.slice(cursor, e.start), cursor);
    appendGenerated(e.text);
    cursor = e.end;
  }
  appendSource(source.slice(cursor), cursor);
  return { body: out, lineMap };
}

function lineStartsFor(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineAtOffset(lineStarts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const start = lineStarts[mid] ?? 0;
    if (start <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}
