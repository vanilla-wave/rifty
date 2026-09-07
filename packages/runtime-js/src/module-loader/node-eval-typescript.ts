// Loaded only after Acorn rejects CLI eval source (ADR-0380).
import type * as TsTypes from 'typescript';
import ts from './generated/typescript-browser.js';

const TYPESCRIPT_ONLY_MODIFIERS = new Set<TsTypes.SyntaxKind>([
  ts.SyntaxKind.DeclareKeyword,
  ts.SyntaxKind.AbstractKeyword,
  ts.SyntaxKind.ReadonlyKeyword,
  ts.SyntaxKind.PublicKeyword,
  ts.SyntaxKind.PrivateKeyword,
  ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.OverrideKeyword,
]);

function hasTypeScriptOnlySyntax(node: TsTypes.Node): boolean {
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

export function nodeEvalConstBindingMarker(
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
  const bindings: TsTypes.Identifier[] = [];
  const visit = (node: TsTypes.Node): void => {
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

export function requiresTypeScriptEvalContext(
  source: string,
  parsesAsJavaScriptScript: (source: string) => boolean,
): boolean {
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
