/**
 * Scope-aware identifier rewriter for the ESM AST transformer.
 *
 * Walks the entire program, maintaining a stack of lexical scopes that track
 * declared names. For each identifier reference (i.e. a use, not a declaration,
 * not a static property name, not an object literal key, not a label, etc.) we
 * check:
 *   - Does it match one of the module's imported bindings?
 *   - Is it shadowed by any enclosing scope?
 *
 * If matched and not shadowed, we emit an edit replacing it with the
 * appropriate namespace member access.
 *
 * Also rewrites:
 *   - `import.meta` (MetaProperty) → `import_meta` (a local injected by the
 *     wrapper around the body).
 *   - dynamic `import(x)` (ImportExpression) → `__import(x)`.
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
import {
  type Ctx,
  type Edit,
  type ImportBinding,
  addBinding,
  declarePattern,
  declareVarDecl,
  emitEdit,
  isShadowed,
  popScope,
  pushScope,
  replacementFor,
} from './esm-ast-scope.ts';

export function collectRewrites(
  program: Program,
  source: string,
  imports: Map<string, ImportBinding>,
  edits: Edit[],
): void {
  const forbiddenSpans: Array<readonly [number, number]> = [];
  for (const e of edits) forbiddenSpans.push([e.start, e.end]);
  forbiddenSpans.sort((a, b) => a[0] - b[0]);

  const ctx: Ctx = {
    source,
    imports,
    edits,
    scopes: [new Map()],
    forbiddenSpans,
  };

  // Pre-pass: collect top-level (module) declared names so that, e.g., a
  // top-level `function foo() {}` shadows an import in another module's body.
  // (We add bindings to the module scope before walking so forward references
  // inside hoisted function bodies see the correct shadowing.)
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
      // export { a, b }: specifiers refer to local names. We've already emitted
      // slot-getter edits for these — skip the specifier subtree to avoid
      // double-walking the local-name identifiers.
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
      // import.meta → import_meta. `new.target` is a MetaProperty too — leave alone.
      if (mp.meta?.name === 'import' && mp.property?.name === 'meta') {
        emitEdit(ctx, mp.start, mp.end, 'import_meta');
      }
      return;
    }

    case 'ImportExpression': {
      const ie = n as unknown as ImportExpression;
      // Rewrite the leading `import` keyword (6 chars) to `__import`.
      emitEdit(ctx, ie.start, ie.start + 'import'.length, '__import');
      walk(ie.source, ctx);
      if (ie.options) walk(ie.options, ctx);
      return;
    }

    case 'Property': {
      const p = n as unknown as Property;
      if (p.computed) walk(p.key, ctx);
      if (p.shorthand) {
        // `{ foo }` — key and value point at the same Identifier. Rewriting
        // its source range produces `{ <replacement> }`, which is invalid.
        // If the identifier needs a rewrite, expand to `foo: <replacement>`
        // by emitting an edit that prepends `name: ` at the value's start.
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
      // Names go in the enclosing scope. The block / for-init wrappers already
      // declared most; calling again is idempotent.
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
  // don't get rewritten.
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
  // Function name is in scope in the body (FunctionExpression: only inside;
  // FunctionDeclaration: in enclosing — harmless either way).
  if (fn.id) addBinding(ctx, fn.id.name);
  for (const p of fn.params) {
    declarePattern(ctx, p);
    walkPatternExpressions(p, ctx);
  }
  walk(fn.body, ctx);
  popScope(ctx);
}

/**
 * Patterns can contain nested expressions (default values, computed keys).
 * Walks just those expression sub-trees so identifier refs in them are
 * processed.
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
