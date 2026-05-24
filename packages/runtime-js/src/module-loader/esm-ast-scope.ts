/**
 * Scope / pattern helpers for the AST-based ESM transformer.
 *
 * A `Scope` is just a set of names declared at one lexical level. The walker
 * maintains a stack of these and checks each identifier reference against the
 * whole stack to see whether an imported binding has been shadowed.
 */

import type {
  ArrayPattern,
  AssignmentPattern,
  ObjectPattern,
  Pattern,
  RestElement,
  VariableDeclaration,
} from 'acorn';
export interface ImportBinding {
  /** The synthesized local namespace variable, e.g. `__m0`. */
  readonly ns: string;
  /** `'*'` for `import * as ns`, `'default'` for default, or the named binding. */
  readonly imported: string;
}

export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export type Scope = Map<string, true>;

export interface Ctx {
  readonly source: string;
  readonly imports: Map<string, ImportBinding>;
  readonly edits: Edit[];
  /** Stack of scopes; index 0 is module scope. */
  readonly scopes: Scope[];
  /**
   * Spans we should not emit identifier rewrites into (e.g. inside an
   * already-replaced import declaration). Sorted by start.
   */
  readonly forbiddenSpans: Array<readonly [number, number]>;
}

export function pushScope(ctx: Ctx): void {
  ctx.scopes.push(new Map());
}
export function popScope(ctx: Ctx): void {
  ctx.scopes.pop();
}
export function addBinding(ctx: Ctx, name: string): void {
  const top = ctx.scopes[ctx.scopes.length - 1];
  if (top) top.set(name, true);
}
export function isShadowed(ctx: Ctx, name: string): boolean {
  for (let i = ctx.scopes.length - 1; i >= 0; i--) {
    const s = ctx.scopes[i];
    if (s?.has(name)) return true;
  }
  return false;
}

export function declarePattern(ctx: Ctx, pat: Pattern): void {
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

export function declareVarDecl(ctx: Ctx, decl: VariableDeclaration): void {
  for (const d of decl.declarations) declarePattern(ctx, d.id);
}

// ─────────────────────────── span / edit helpers ───────────────────────────

export function isForbidden(ctx: Ctx, start: number, end: number): boolean {
  // Linear scan is fine (small N — one entry per top-level import/export).
  for (const [s, e] of ctx.forbiddenSpans) {
    if (start >= s && end <= e) return true;
    if (start >= e) continue;
    if (end <= s) break;
  }
  return false;
}

export function emitEdit(ctx: Ctx, start: number, end: number, text: string): void {
  if (isForbidden(ctx, start, end)) return;
  ctx.edits.push({ start, end, text });
}

export function replacementFor(b: ImportBinding): string {
  if (b.imported === '*') return b.ns;
  if (b.imported === 'default') return `${b.ns}.default`;
  if (/^[A-Za-z_$][\w$]*$/.test(b.imported)) return `${b.ns}.${b.imported}`;
  return `${b.ns}[${JSON.stringify(b.imported)}]`;
}
