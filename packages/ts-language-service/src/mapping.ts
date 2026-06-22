/**
 * Pure `ts` → LSP mapping for hover / definition / completions (ADR-0166).
 *
 * Kept separate from `service.ts` so the parity test can apply the EXACT same
 * renderer to Side A's raw `ts` results as the service applies to Side B — a
 * symmetric normalization (no hiding): the gold standard compares the SAME
 * rendered shape on both sides, never the renderer's output vs raw ts.
 *
 * These are leaf helpers: they take already-extracted `ts` data (display parts,
 * spans, kinds) plus the file text needed to map a `TextSpan` to a `Range`, and
 * return LSP wire shapes. No `ts.LanguageService` access here.
 */

import ts from 'typescript';
import {
  type CompletionItem,
  CompletionItemKind,
  type FormattingOptions,
  type Hover,
  type MarkupContent,
  type ParameterInformation,
  type Range,
  type SignatureHelp,
  type SignatureInformation,
  type TextEdit,
  type WorkspaceEdit,
} from './lsp-types.ts';
import { offsetToPosition } from './position.ts';

/** Map a `ts.TextSpan` (start/length) over `text` to an LSP {@link Range}. */
export function spanToRange(text: string, span: ts.TextSpan): Range {
  return {
    start: offsetToPosition(text, span.start),
    end: offsetToPosition(text, span.start + span.length),
  };
}

/** Flatten `SymbolDisplayPart[]` to its text (tsc's own `displayPartsToString`). */
export function partsToString(parts: readonly ts.SymbolDisplayPart[] | undefined): string {
  return ts.displayPartsToString(parts as ts.SymbolDisplayPart[] | undefined);
}

/**
 * Render JSDoc documentation + tags to a single markdown string. `documentation`
 * is the leading prose; each `@tag` is appended on its own line as `*@name* text`
 * (tag text itself may be display parts → flattened). Empty when there is none.
 */
export function renderDocumentation(
  documentation: readonly ts.SymbolDisplayPart[] | undefined,
  tags: readonly ts.JSDocTagInfo[] | undefined,
): string {
  const doc = partsToString(documentation);
  const tagLines = (tags ?? []).map((t) => {
    const body = typeof t.text === 'string' ? t.text : partsToString(t.text);
    return body ? `*@${t.name}* — ${body}` : `*@${t.name}*`;
  });
  return [doc, ...tagLines].filter((s) => s.length > 0).join('\n\n');
}

/**
 * Render a hover body from quick-info display parts + docs. The signature
 * (`displayParts`) becomes a fenced `typescript` code block; documentation/tags
 * follow as markdown prose — exactly how tsserver→LSP bridges render quick info.
 */
export function renderHoverContents(
  displayParts: readonly ts.SymbolDisplayPart[] | undefined,
  documentation: readonly ts.SymbolDisplayPart[] | undefined,
  tags: readonly ts.JSDocTagInfo[] | undefined,
): MarkupContent {
  const signature = partsToString(displayParts);
  const docs = renderDocumentation(documentation, tags);
  const code = signature ? `\`\`\`typescript\n${signature}\n\`\`\`` : '';
  const value = [code, docs].filter((s) => s.length > 0).join('\n\n');
  return { kind: 'markdown', value };
}

/** Build a {@link Hover} from a raw `ts.QuickInfo` and the queried file's text. */
export function quickInfoToHover(info: ts.QuickInfo, text: string): Hover {
  return {
    contents: renderHoverContents(info.displayParts, info.documentation, info.tags),
    range: spanToRange(text, info.textSpan),
  };
}

/**
 * Map `ts.ScriptElementKind` → LSP {@link CompletionItemKind}. Mirrors the
 * canonical tsserver→LSP bridge (typescript-language-server); unknown kinds fall
 * back to `Text` (LSP has no "unknown"). Member kinds (method/property/getter/…)
 * and declaration kinds (class/interface/enum/var/…) are distinguished so the
 * editor shows the right glyph.
 */
export function scriptElementKindToCompletionKind(kind: ts.ScriptElementKind): CompletionItemKind {
  const K = ts.ScriptElementKind;
  switch (kind) {
    case K.primitiveType:
    case K.keyword:
      return CompletionItemKind.Keyword;
    case K.constElement:
      return CompletionItemKind.Constant;
    case K.letElement:
    case K.variableElement:
    case K.localVariableElement:
    case K.variableUsingElement:
    case K.variableAwaitUsingElement:
    case K.alias:
    case K.parameterElement:
      return CompletionItemKind.Variable;
    case K.memberVariableElement:
    case K.memberGetAccessorElement:
    case K.memberSetAccessorElement:
    case K.memberAccessorVariableElement:
      return CompletionItemKind.Field;
    case K.functionElement:
    case K.localFunctionElement:
      return CompletionItemKind.Function;
    case K.memberFunctionElement:
    case K.constructSignatureElement:
    case K.callSignatureElement:
    case K.indexSignatureElement:
      return CompletionItemKind.Method;
    case K.enumElement:
      return CompletionItemKind.Enum;
    case K.enumMemberElement:
      return CompletionItemKind.EnumMember;
    case K.moduleElement:
    case K.externalModuleName:
      return CompletionItemKind.Module;
    case K.classElement:
    case K.localClassElement:
      return CompletionItemKind.Class;
    case K.interfaceElement:
      return CompletionItemKind.Interface;
    case K.typeElement:
    case K.typeParameterElement:
      return CompletionItemKind.TypeParameter;
    case K.constructorImplementationElement:
      return CompletionItemKind.Constructor;
    case K.string:
      return CompletionItemKind.Constant;
    case K.directory:
      return CompletionItemKind.Folder;
    case K.scriptElement:
      return CompletionItemKind.File;
    case K.warning:
    case K.unknown:
    case K.label:
    case K.link:
    case K.linkName:
    case K.linkText:
    case K.jsxAttribute:
      return CompletionItemKind.Text;
    default:
      return CompletionItemKind.Text;
  }
}

/**
 * Map a `ts.RenameLocation` → LSP {@link TextEdit} against the target file's
 * `text`. The replaced `range` is the location's `textSpan`; `newText` is the
 * new name wrapped in any `prefixText`/`suffixText` tsc attaches. Those carry
 * the property-shorthand expansion (`{ x }` → `{ x: newName }` yields
 * `prefixText: "x: "`, span over `x`) and similar — so we MUST honor them or the
 * resulting source is wrong (parity catches drift).
 */
export function renameLocationToTextEdit(
  loc: ts.RenameLocation,
  newName: string,
  text: string,
): TextEdit {
  return {
    range: spanToRange(text, loc.textSpan),
    newText: `${loc.prefixText ?? ''}${newName}${loc.suffixText ?? ''}`,
  };
}

/**
 * Map a `ts.SignatureHelpItem` → LSP {@link SignatureInformation}. The label is
 * `prefix + params.join(separator) + suffix` (e.g. `add(a: number, b: number):
 * number`) — the canonical tsserver→LSP rendering; each parameter's label is its
 * own `displayParts` (e.g. `a: number`), so an editor can highlight the active
 * one. Per-signature/param JSDoc is rendered to markdown when present.
 */
export function signatureHelpItemToSignatureInformation(
  item: ts.SignatureHelpItem,
): SignatureInformation {
  const prefix = partsToString(item.prefixDisplayParts);
  const suffix = partsToString(item.suffixDisplayParts);
  const separator = partsToString(item.separatorDisplayParts);
  const parameters: ParameterInformation[] = item.parameters.map((p) => {
    const docs = renderDocumentation(p.documentation, undefined);
    const param: { label: string; documentation?: MarkupContent } = {
      label: partsToString(p.displayParts),
    };
    if (docs) param.documentation = { kind: 'markdown', value: docs };
    return param;
  });
  const label = `${prefix}${parameters.map((p) => p.label).join(separator)}${suffix}`;
  const docs = renderDocumentation(item.documentation, item.tags);
  const info: { label: string; documentation?: MarkupContent; parameters: ParameterInformation[] } =
    { label, parameters };
  if (docs) info.documentation = { kind: 'markdown', value: docs };
  return info;
}

/**
 * Map raw `ts.SignatureHelpItems` → LSP {@link SignatureHelp}. `activeSignature`
 * = the selected overload (`selectedItemIndex`); `activeParameter` = the
 * argument the cursor sits in (`argumentIndex`).
 */
export function signatureHelpItemsToSignatureHelp(items: ts.SignatureHelpItems): SignatureHelp {
  return {
    signatures: items.items.map(signatureHelpItemToSignatureInformation),
    activeSignature: items.selectedItemIndex,
    activeParameter: items.argumentIndex,
  };
}

/**
 * Map a `ts.CompletionEntry` → LSP {@link CompletionItem} (label + kind + sort/
 * insert/filter text). `detail`/`documentation` are filled lazily by
 * {@link getCompletionDetails} (resolve), not here — the initial list is cheap.
 */
export function completionEntryToItem(entry: ts.CompletionEntry): CompletionItem {
  const item: {
    label: string;
    kind: CompletionItemKind;
    sortText: string;
    insertText?: string;
    filterText?: string;
  } = {
    label: entry.name,
    kind: scriptElementKindToCompletionKind(entry.kind),
    sortText: entry.sortText,
  };
  if (entry.insertText !== undefined) item.insertText = entry.insertText;
  if (entry.filterText !== undefined) item.filterText = entry.filterText;
  return item;
}

/**
 * Map a `ts.TextChange[]` (one file's edits) → LSP {@link TextEdit}[] against
 * that file's `text`. Each `TextChange.span` becomes a Range; `newText` passes
 * through verbatim (an empty `newText` is a deletion; an empty span an insert).
 * Order is preserved — tsc already emits non-overlapping edits in apply order.
 */
export function textChangesToTextEdits(
  changes: readonly ts.TextChange[],
  text: string,
): TextEdit[] {
  return changes.map((c) => ({ range: spanToRange(text, c.span), newText: c.newText }));
}

/**
 * Map a `ts.FileTextChanges[]` (the multi-file edit shape returned by code-fixes
 * and organize-imports) → an LSP {@link WorkspaceEdit}. Grouped by `fileName`;
 * each file's `textChanges` map against THAT file's current `text` (supplied by
 * `readText`, the program's own view of the bytes). Shared by both code-fixes
 * and organize-imports so the ts→LSP edit shape is identical for both.
 *
 * `isNewFile` changes (tsc proposing a brand-new file) still key on `fileName`;
 * `readText` returns `''` for an absent file → spans collapse to document start,
 * which is correct for an all-insert new-file change.
 */
export function fileTextChangesToWorkspaceEdit(
  fileChanges: readonly ts.FileTextChanges[],
  readText: (fileName: string) => string,
): WorkspaceEdit {
  const changes: Record<string, TextEdit[]> = {};
  for (const fc of fileChanges) {
    const edits = changes[fc.fileName] ?? [];
    edits.push(...textChangesToTextEdits(fc.textChanges, readText(fc.fileName)));
    changes[fc.fileName] = edits;
  }
  return { changes };
}

/**
 * Derive a full `ts.FormatCodeSettings` from the LSP {@link FormattingOptions}
 * the editor sends, so rifty formatting is byte-identical to a real
 * `ts.LanguageService`. The base is `ts.getDefaultFormatCodeSettings('\n')` —
 * the EXACT seed tsserver uses (newline `'\n'`; `indentStyle` Smart;
 * `trimTrailingWhitespace` + `indentSwitchCase` true; `insertSpaceAfterComma
 * Delimiter`/`…AfterSemicolonInForStatements`/`…BeforeAndAfterBinaryOperators`/
 * `…AfterKeywordsInControlFlowStatements` true; `…AfterFunctionKeywordForAnonymous
 * Functions` false; `…NonemptyBraces` true, the other `…Nonempty*` false;
 * `placeOpenBraceOnNewLineFor*` false; `semicolons` Ignore = keep source style).
 * We delegate to that helper (rather than spelling the flags out) so we can never
 * silently drift from tsserver's defaults across a typescript bump. Then ONLY the
 * editor-driven fields are overridden:
 *   - `tabSize` / `indentSize` ← `options.tabSize` (indent width = tab width)
 *   - `convertTabsToSpaces` ← `options.insertSpaces`
 *
 * Parity NB: the parity test imports THIS function and feeds its result to both
 * sides, so both run identical settings — a drift here would change the emitted
 * spacing and break parity rather than hide.
 */
export function formattingOptionsToFormatCodeSettings(
  options: FormattingOptions,
): ts.FormatCodeSettings {
  return {
    ...ts.getDefaultFormatCodeSettings('\n'),
    tabSize: options.tabSize,
    indentSize: options.tabSize,
    convertTabsToSpaces: options.insertSpaces,
  };
}
