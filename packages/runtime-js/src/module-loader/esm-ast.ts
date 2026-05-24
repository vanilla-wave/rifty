/**
 * AST-based ESM → async-function-body transformer.
 *
 * Replaces the earlier regex + zone-scanner approach (ADR 0009). Uses acorn to
 * parse the source and acorn-walk to traverse it, tracking lexical scopes so
 * that identifier references that look like imports but are shadowed by a
 * parameter or local binding are left alone.
 *
 * The result body, when run as the body of an `async () => { ... }` with the
 * helpers `__import`, `__importStatic`, `__slots`, `__rebuildExports` (and
 * `__filename`, `__dirname`, `__importMetaUrl`, `import_meta`) in scope,
 * populates the slot table for the module.
 */

import type {
  ArrayPattern,
  AssignmentPattern,
  ExportAllDeclaration,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  Identifier,
  ImportDeclaration,
  Node,
  ObjectPattern,
  Pattern,
  Program,
  RestElement,
} from 'acorn';
import { parse as acornParse } from 'acorn';
import { ModuleLoadError } from './errors.ts';
import type { Edit, ImportBinding } from './esm-ast-scope.ts';
import { collectRewrites } from './esm-ast-walker.ts';

export interface TransformResult {
  /** The rewritten body (no `async () =>` wrapper — caller adds that). */
  readonly body: string;
  /** Every static import / re-export specifier — preloaded by the caller. */
  readonly staticImports: readonly string[];
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
  /** Map of local binding name (in the original source) → resolved import. */
  const importedBindings = new Map<string, ImportBinding>();
  let importCounter = 0;

  for (const node of program.body) {
    if (node.type === 'ImportDeclaration') {
      const ns = `__m${importCounter++}`;
      handleImportDeclaration(node, ns, edits, importedBindings);
      staticImports.add(literalString(node.source.value));
    } else if (node.type === 'ExportNamedDeclaration') {
      const sourceLit = node.source ? literalString(node.source.value) : null;
      if (sourceLit !== null) {
        const ns = `__m${importCounter++}`;
        handleReExportNamed(node, ns, edits, sourceLit);
        staticImports.add(sourceLit);
      } else {
        handleExportNamed(node, edits, importedBindings);
      }
    } else if (node.type === 'ExportDefaultDeclaration') {
      handleExportDefault(node, edits, source);
    } else if (node.type === 'ExportAllDeclaration') {
      const ns = `__m${importCounter++}`;
      const sourceLit = literalString(node.source.value);
      handleExportAll(node, ns, edits, sourceLit);
      staticImports.add(sourceLit);
    }
  }

  // Walk the whole program to:
  //   - rewrite identifier references to imported bindings (scope-aware)
  //   - rewrite `import.meta` → `import_meta`
  //   - rewrite dynamic `import(x)` → `__import(x)`
  collectRewrites(program, source, importedBindings, edits);

  let body = applyEdits(source, edits);
  body = `__rebuildExports();\n${body}`;
  return { body, staticImports: [...staticImports] };
}

// ────────────────────────────── import / export ──────────────────────────────

function handleImportDeclaration(
  node: ImportDeclaration,
  ns: string,
  edits: Edit[],
  importedBindings: Map<string, ImportBinding>,
): void {
  const spec = literalString(node.source.value);
  const lines: string[] = [`const ${ns} = __importStatic(${JSON.stringify(spec)});`];

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
): void {
  const lines: string[] = [`{ const ${ns} = __importStatic(${JSON.stringify(sourceLit)});`];
  for (const s of node.specifiers) {
    const exported =
      s.exported.type === 'Identifier' ? s.exported.name : String(s.exported.value ?? '');
    const local = s.local.type === 'Identifier' ? s.local.name : String(s.local.value ?? '');
    lines.push(
      `Object.defineProperty(__slots, ${JSON.stringify(exported)}, { configurable: true, enumerable: true, get: () => ${ns}[${JSON.stringify(local)}] });`,
    );
  }
  lines.push('__rebuildExports(); }');
  edits.push({ start: node.start, end: node.end, text: lines.join('\n') });
}

function handleExportNamed(
  node: ExportNamedDeclaration,
  edits: Edit[],
  imports: Map<string, ImportBinding>,
): void {
  if (node.declaration) {
    const decl = node.declaration;
    const names = collectDeclarationNames(decl);
    // Strip the `export` keyword so the declaration body is left in place and
    // the walker can rewrite identifier references inside it.
    edits.push({ start: node.start, end: decl.start, text: '' });
    const trailing: string[] = [];
    for (const n of names) {
      trailing.push(
        `Object.defineProperty(__slots, ${JSON.stringify(n)}, { configurable: true, enumerable: true, get: () => ${n} });`,
      );
    }
    trailing.push('__rebuildExports();');
    // Zero-width edit after the declaration body.
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
      `Object.defineProperty(__slots, ${JSON.stringify(exported)}, { configurable: true, enumerable: true, get: () => ${ref} });`,
    );
  }
  lines.push('__rebuildExports();');
  edits.push({ start: node.start, end: node.end, text: lines.join('\n') });
}

function handleExportDefault(node: ExportDefaultDeclaration, edits: Edit[], _source: string): void {
  const decl = node.declaration;
  if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id) {
    const name = decl.id.name;
    // Strip `export default ` (start..decl.start). Leave the declaration as-is
    // so the walker can rewrite identifiers inside it. Then append a slot write.
    edits.push({ start: node.start, end: decl.start, text: '' });
    edits.push({
      start: decl.end,
      end: node.end,
      text: `\n__slots.default = ${name};\n__rebuildExports();`,
    });
    return;
  }
  // Anonymous declaration or expression — wrap as an assignment to __slots.default.
  // Leaving the body/expr in place lets the walker rewrite refs inside it.
  edits.push({ start: node.start, end: decl.start, text: '__slots.default = (' });
  edits.push({ start: decl.end, end: node.end, text: ');\n__rebuildExports();' });
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
): void {
  if (node.exported) {
    const exportedName =
      node.exported.type === 'Identifier' ? node.exported.name : String(node.exported.value ?? '');
    const text = `{ const ${ns} = __importStatic(${JSON.stringify(sourceLit)}); Object.defineProperty(__slots, ${JSON.stringify(exportedName)}, { configurable: true, enumerable: true, get: () => ${ns} }); __rebuildExports(); }`;
    edits.push({ start: node.start, end: node.end, text });
    return;
  }
  const text = `{ const ${ns} = __importStatic(${JSON.stringify(sourceLit)}); for (const __k of Object.keys(${ns})) if (__k !== 'default') Object.defineProperty(__slots, __k, { configurable: true, enumerable: true, get: ((k) => () => ${ns}[k])(__k) }); __rebuildExports(); }`;
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

// ──────────────────────────────── edits → output ────────────────────────────────

function applyEdits(source: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  // Filter overlaps: keep the outer/earlier one.
  const kept: Edit[] = [];
  let lastEnd = -1;
  for (const e of sorted) {
    if (e.start < lastEnd) continue;
    kept.push(e);
    lastEnd = e.end;
  }
  let out = '';
  let cursor = 0;
  for (const e of kept) {
    out += source.slice(cursor, e.start);
    out += e.text;
    cursor = e.end;
  }
  out += source.slice(cursor);
  return out;
}
