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
  ExportAllDeclaration,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  Identifier,
  ImportDeclaration,
  ImportExpression,
  MemberExpression,
  MetaProperty,
  Node,
  ObjectPattern,
  Pattern,
  Program,
  Property,
  RestElement,
  VariableDeclaration,
} from 'acorn';
import { parse as acornParse } from 'acorn';
import { ModuleLoadError } from './errors.ts';

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

export interface TransformHelperNames {
  readonly dynamicImport: string;
  readonly importStatic: string;
  readonly slots: string;
  readonly rebuildExports: string;
  readonly importMeta: string;
  readonly importMetaUrl: string;
  readonly metaDirname: string;
  readonly metaFilename: string;
  readonly assetPath: string;
  readonly metaResolve: string;
  readonly runtimeObject: string;
}

interface ImportBinding {
  /** The synthesized local namespace variable, e.g. `__m0`. */
  readonly ns: string;
  /** `'*'` for `import * as ns`, `'default'` for default, or the named binding. */
  readonly imported: string;
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

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
  if (b.imported === '*') return b.ns;
  if (b.imported === 'default') return `${b.ns}.default`;
  if (/^[A-Za-z_$][\w$]*$/.test(b.imported)) return `${b.ns}.${b.imported}`;
  return `${b.ns}[${JSON.stringify(b.imported)}]`;
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
  /** Collision-free helper identifiers used by the rewritten body. */
  readonly helpers: TransformHelperNames;
  /** Original module-scope declarations, including static-import locals. */
  readonly moduleBindings: readonly string[];
}

interface ModuleBindingNode {
  readonly type: string;
  readonly kind?: string;
  readonly id?: ModuleBindingNode | null;
  readonly local?: { readonly name?: string };
  readonly declaration?: ModuleBindingNode | null;
  readonly declarations?: readonly { readonly id: ModuleBindingNode }[];
  readonly specifiers?: readonly { readonly local: { readonly name: string } }[];
  readonly properties?: readonly ModuleBindingNode[];
  readonly elements?: readonly (ModuleBindingNode | null)[];
  readonly argument?: ModuleBindingNode;
  readonly left?: ModuleBindingNode;
  readonly value?: ModuleBindingNode;
  readonly name?: string;
  readonly [key: string]: unknown;
}

function collectModulePatternBindings(
  node: ModuleBindingNode | null | undefined,
  out: Set<string>,
): void {
  if (node === null || node === undefined) return;
  switch (node.type) {
    case 'Identifier':
      if (node.name !== undefined) out.add(node.name);
      return;
    case 'ObjectPattern':
      for (const property of node.properties ?? []) {
        collectModulePatternBindings(
          property.type === 'RestElement' ? property.argument : property.value,
          out,
        );
      }
      return;
    case 'ArrayPattern':
      for (const element of node.elements ?? []) collectModulePatternBindings(element, out);
      return;
    case 'RestElement':
      collectModulePatternBindings(node.argument, out);
      return;
    case 'AssignmentPattern':
      collectModulePatternBindings(node.left, out);
      return;
    default:
      return;
  }
}

function collectModuleDeclarationBindings(
  node: ModuleBindingNode | null | undefined,
  out: Set<string>,
): void {
  if (node === null || node === undefined) return;
  switch (node.type) {
    case 'ImportDeclaration':
      for (const specifier of node.specifiers ?? []) out.add(specifier.local.name);
      return;
    case 'VariableDeclaration':
      for (const declaration of node.declarations ?? []) {
        collectModulePatternBindings(declaration.id, out);
      }
      return;
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      collectModulePatternBindings(node.id, out);
      return;
    case 'ExportNamedDeclaration':
    case 'ExportDefaultDeclaration':
      collectModuleDeclarationBindings(node.declaration, out);
      return;
    default:
      return;
  }
}

/**
 * `var` is function-scoped even when its declaration sits under module-level
 * control flow. Stop at nested function/class scopes; their vars cannot collide
 * with parameters of the module factory.
 */
function collectModuleHoistedVarBindings(node: unknown, out: Set<string>): void {
  if (typeof node !== 'object' || node === null) return;
  const candidate = node as ModuleBindingNode;
  switch (candidate.type) {
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ClassDeclaration':
    case 'ClassExpression':
      return;
    case 'VariableDeclaration':
      if (candidate.kind === 'var') {
        for (const declaration of candidate.declarations ?? []) {
          collectModulePatternBindings(declaration.id, out);
        }
      }
      return;
    default:
      break;
  }
  for (const key of Object.keys(candidate)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
      continue;
    }
    const value = candidate[key];
    if (Array.isArray(value)) {
      for (const item of value) collectModuleHoistedVarBindings(item, out);
    } else {
      collectModuleHoistedVarBindings(value, out);
    }
  }
}

function collectModuleBindings(program: Program): readonly string[] {
  const names = new Set<string>();
  for (const node of program.body) {
    collectModuleDeclarationBindings(node as unknown as ModuleBindingNode, names);
    collectModuleHoistedVarBindings(node, names);
  }
  return [...names];
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

  const edits: Edit[] = [];
  const staticImports = new Set<string>();
  const moduleBindings = collectModuleBindings(program);
  /** Map of local binding name (in the original source) → resolved import. */
  const importedBindings = new Map<string, ImportBinding>();
  const helpers = createHelperNames(source);
  const generatedNames = new Set(Object.values(helpers));
  let importCounter = 0;

  for (const node of program.body) {
    if (node.type === 'ImportDeclaration') {
      if (isFileAttributeImport(node)) {
        // `import x from "spec" with { type: "file" }` binds the local to the
        // resolved PATH, not a module. Deliberately NOT in staticImports — the
        // asset is never evaluated as a module (may be binary, e.g. opencode's
        // `photon_rs_bg.wasm`).
        handleFileImport(
          node,
          uniqueHelperName(source, generatedNames, `__file${importCounter++}`),
          edits,
          helpers,
        );
      } else {
        const ns = uniqueHelperName(source, generatedNames, `__m${importCounter++}`);
        handleImportDeclaration(node, ns, edits, importedBindings, helpers);
        staticImports.add(literalString(node.source.value));
      }
    } else if (node.type === 'ExportNamedDeclaration') {
      const sourceLit = node.source ? literalString(node.source.value) : null;
      if (sourceLit !== null) {
        const ns = uniqueHelperName(source, generatedNames, `__m${importCounter++}`);
        handleReExportNamed(node, ns, edits, sourceLit, helpers);
        staticImports.add(sourceLit);
      } else {
        handleExportNamed(node, edits, importedBindings, helpers);
      }
    } else if (node.type === 'ExportDefaultDeclaration') {
      handleExportDefault(node, edits, source, helpers);
    } else if (node.type === 'ExportAllDeclaration') {
      const ns = uniqueHelperName(source, generatedNames, `__m${importCounter++}`);
      const sourceLit = literalString(node.source.value);
      handleExportAll(node, ns, edits, sourceLit, helpers);
      staticImports.add(sourceLit);
    }
  }

  collectRewrites(program, source, importedBindings, edits, helpers);

  const applied = applyEdits(source, edits);
  const body = `${helpers.rebuildExports}();\n${applied.body}`;
  return {
    body,
    lineMap: [0, ...applied.lineMap],
    staticImports: [...staticImports],
    helpers,
    moduleBindings,
  };
}

/**
 * True for an import carrying the `with { type: "file" }` attribute (esbuild/Bun
 * "file" loader). acorn exposes import attributes as `node.attributes` (older
 * trees: `node.assertions`); each is `{ key, value }` with a string-literal
 * `value`. opencode uses this to import an asset's PATH, e.g.
 * `import photonWasm from "…/photon_rs_bg.wasm" with { type: "file" }`.
 */
function isFileAttributeImport(node: ImportDeclaration): boolean {
  const attrs = node.attributes;
  if (!attrs) return false;
  for (const a of attrs) {
    const key = a.key.type === 'Identifier' ? a.key.name : String(a.key.value ?? '');
    if (key === 'type' && a.value.value === 'file') return true;
  }
  return false;
}

/**
 * Emit a `with { type: "file" }` import as a binding to the asset's resolved
 * absolute PATH. The injected `__assetPath` helper (esm.ts) resolves the
 * specifier to its file id without loading it as a module. Default specifier →
 * the path string; namespace specifier → `{ default: <path> }`. Named specifiers
 * are meaningless for a file asset and are dropped.
 */
function handleFileImport(
  node: ImportDeclaration,
  assetVar: string,
  edits: Edit[],
  helpers: TransformHelperNames,
): void {
  const spec = literalString(node.source.value);
  const lines: string[] = [`const ${assetVar} = ${helpers.assetPath}(${JSON.stringify(spec)});`];
  for (const s of node.specifiers) {
    if (s.type === 'ImportDefaultSpecifier') {
      lines.push(`const ${s.local.name} = ${assetVar};`);
    } else if (s.type === 'ImportNamespaceSpecifier') {
      lines.push(`const ${s.local.name} = { default: ${assetVar} };`);
    }
  }
  edits.push({ start: node.start, end: node.end, text: lines.join('\n') });
}

function handleImportDeclaration(
  node: ImportDeclaration,
  ns: string,
  edits: Edit[],
  importedBindings: Map<string, ImportBinding>,
  helpers: TransformHelperNames,
): void {
  const spec = literalString(node.source.value);
  const lines: string[] = [`const ${ns} = ${helpers.importStatic}(${JSON.stringify(spec)});`];

  for (const s of node.specifiers) {
    if (s.type === 'ImportDefaultSpecifier') {
      importedBindings.set(s.local.name, { ns, imported: 'default' });
    } else if (s.type === 'ImportNamespaceSpecifier') {
      importedBindings.set(s.local.name, { ns, imported: '*' });
    } else {
      const imported =
        s.imported.type === 'Identifier' ? s.imported.name : String(s.imported.value ?? '');
      importedBindings.set(s.local.name, { ns, imported });
    }
  }

  edits.push({ start: node.start, end: node.end, text: lines.join('\n') });
}

function handleReExportNamed(
  node: ExportNamedDeclaration,
  ns: string,
  edits: Edit[],
  sourceLit: string,
  helpers: TransformHelperNames,
): void {
  const lines: string[] = [
    `{ const ${ns} = ${helpers.importStatic}(${JSON.stringify(sourceLit)});`,
  ];
  for (const s of node.specifiers) {
    const exported =
      s.exported.type === 'Identifier' ? s.exported.name : String(s.exported.value ?? '');
    const local = s.local.type === 'Identifier' ? s.local.name : String(s.local.value ?? '');
    lines.push(
      `${helpers.runtimeObject}.defineProperty(${helpers.slots}, ${JSON.stringify(exported)}, { configurable: true, enumerable: true, get: () => ${ns}[${JSON.stringify(local)}] });`,
    );
  }
  lines.push(`${helpers.rebuildExports}(); }`);
  edits.push({ start: node.start, end: node.end, text: lines.join('\n') });
}

function handleExportNamed(
  node: ExportNamedDeclaration,
  edits: Edit[],
  imports: Map<string, ImportBinding>,
  helpers: TransformHelperNames,
): void {
  if (node.declaration) {
    const decl = node.declaration;
    const names = collectDeclarationNames(decl);
    // Strip `export` so the declaration body stays in place for the walker to
    // rewrite identifier references inside it.
    edits.push({ start: node.start, end: decl.start, text: '' });
    const trailing: string[] = [];
    for (const n of names) {
      trailing.push(
        `${helpers.runtimeObject}.defineProperty(${helpers.slots}, ${JSON.stringify(n)}, { configurable: true, enumerable: true, get: () => ${n} });`,
      );
    }
    trailing.push(`${helpers.rebuildExports}();`);
    edits.push({ start: decl.end, end: node.end, text: `\n${trailing.join('\n')}` });
    return;
  }
  // export { a, b as c };
  const lines: string[] = [];
  for (const s of node.specifiers) {
    const exported =
      s.exported.type === 'Identifier' ? s.exported.name : String(s.exported.value ?? '');
    const local = s.local.type === 'Identifier' ? s.local.name : String(s.local.value ?? '');
    const ref = referenceFor(local, imports);
    lines.push(
      `${helpers.runtimeObject}.defineProperty(${helpers.slots}, ${JSON.stringify(exported)}, { configurable: true, enumerable: true, get: () => ${ref} });`,
    );
  }
  lines.push(`${helpers.rebuildExports}();`);
  edits.push({ start: node.start, end: node.end, text: lines.join('\n') });
}

function handleExportDefault(
  node: ExportDefaultDeclaration,
  edits: Edit[],
  _source: string,
  helpers: TransformHelperNames,
): void {
  const decl = node.declaration;
  if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id) {
    const name = decl.id.name;
    // Strip `export default `, leaving the declaration for the walker to rewrite,
    // then append a slot write.
    edits.push({ start: node.start, end: decl.start, text: '' });
    edits.push({
      start: decl.end,
      end: node.end,
      text: `\n${helpers.slots}.default = ${name};\n${helpers.rebuildExports}();`,
    });
    return;
  }
  // Anonymous declaration or expression — wrap as an assignment to the default slot,
  // leaving the body/expr in place for the walker to rewrite refs inside it.
  edits.push({ start: node.start, end: decl.start, text: `${helpers.slots}.default = (` });
  edits.push({ start: decl.end, end: node.end, text: `);\n${helpers.rebuildExports}();` });
}

function referenceFor(local: string, imports: Map<string, ImportBinding>): string {
  const b = imports.get(local);
  if (!b) return local;
  if (b.imported === '*') return b.ns;
  if (b.imported === 'default') return `${b.ns}.default`;
  if (/^[A-Za-z_$][\w$]*$/.test(b.imported)) return `${b.ns}.${b.imported}`;
  return `${b.ns}[${JSON.stringify(b.imported)}]`;
}

function handleExportAll(
  node: ExportAllDeclaration,
  ns: string,
  edits: Edit[],
  sourceLit: string,
  helpers: TransformHelperNames,
): void {
  if (node.exported) {
    const exportedName =
      node.exported.type === 'Identifier' ? node.exported.name : String(node.exported.value ?? '');
    const text = `{ const ${ns} = ${helpers.importStatic}(${JSON.stringify(sourceLit)}); ${helpers.runtimeObject}.defineProperty(${helpers.slots}, ${JSON.stringify(exportedName)}, { configurable: true, enumerable: true, get: () => ${ns} }); ${helpers.rebuildExports}(); }`;
    edits.push({ start: node.start, end: node.end, text });
    return;
  }
  const text = `{ const ${ns} = ${helpers.importStatic}(${JSON.stringify(sourceLit)}); for (const __k of ${helpers.runtimeObject}.keys(${ns})) if (__k !== 'default') ${helpers.runtimeObject}.defineProperty(${helpers.slots}, __k, { configurable: true, enumerable: true, get: ((k) => () => ${ns}[k])(__k) }); ${helpers.rebuildExports}(); }`;
  edits.push({ start: node.start, end: node.end, text });
}

function collectDeclarationNames(decl: Node): string[] {
  const out: string[] = [];
  if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
    const id = (decl as { id?: Identifier | null }).id;
    if (id) out.push(id.name);
    return out;
  }
  if (decl.type === 'VariableDeclaration') {
    const varDecl = decl as unknown as { declarations: { id: Pattern }[] };
    for (const d of varDecl.declarations) collectPatternNames(d.id, out);
  }
  return out;
}

function collectPatternNames(pat: Pattern, out: string[]): void {
  switch (pat.type) {
    case 'Identifier':
      out.push(pat.name);
      return;
    case 'ObjectPattern':
      for (const p of (pat as ObjectPattern).properties) {
        if (p.type === 'RestElement') collectPatternNames(p.argument, out);
        else collectPatternNames(p.value, out);
      }
      return;
    case 'ArrayPattern':
      for (const el of (pat as ArrayPattern).elements) {
        if (el) collectPatternNames(el, out);
      }
      return;
    case 'RestElement':
      collectPatternNames((pat as RestElement).argument, out);
      return;
    case 'AssignmentPattern':
      collectPatternNames((pat as AssignmentPattern).left, out);
      return;
    default:
      return;
  }
}

function literalString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('expected string literal');
  }
  return value;
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
