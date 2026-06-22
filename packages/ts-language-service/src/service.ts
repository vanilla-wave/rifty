/**
 * The public language service: a `ts.LanguageService` driven over the rifty VFS,
 * exposing diagnostics as LSP shapes (ADR-0166).
 *
 * `createTsLanguageService` is async — it awaits the std-lib load up front, then
 * builds the (synchronous) overlay + host + `ts.LanguageService`. tsconfig is
 * loaded from `projectRoot` over the VFS.
 */

import type { FsSync } from '@riftydev/vfs';
import ts from 'typescript';
import { createVfsLanguageServiceHost } from './host.ts';
import { loadLibDts } from './lib-dts.ts';
import {
  type CompletionItem,
  type CompletionList,
  type Diagnostic,
  DiagnosticSeverity,
  type Hover,
  type Location,
  type Position,
  type PrepareRenameResult,
  type ReferenceContext,
  type SignatureHelp,
  type TextEdit,
  type WorkspaceEdit,
} from './lsp-types.ts';
import {
  completionEntryToItem,
  partsToString,
  quickInfoToHover,
  renameLocationToTextEdit,
  renderDocumentation,
  signatureHelpItemsToSignatureHelp,
  spanToRange,
} from './mapping.ts';
import { createDocumentOverlay } from './overlay.ts';
import { offsetToPosition, positionToOffset } from './position.ts';
import { loadTsConfig } from './tsconfig.ts';

export interface CreateTsLanguageServiceDeps {
  readonly fsSync: FsSync;
  /** Project root (POSIX-absolute); tsconfig is discovered from here. */
  readonly projectRoot: string;
}

export interface TsLanguageService {
  getSemanticDiagnostics(path: string): Diagnostic[];
  getSyntacticDiagnostics(path: string): Diagnostic[];
  /**
   * Config-level diagnostics from parsing `tsconfig.json` (e.g. an unknown
   * `compilerOptions` value) — what real tsserver surfaces for a broken config.
   * Empty when the config parsed clean. A config error often has no `file`/
   * position; it then collapses to the document start (see {@link toLspDiagnostic}).
   */
  getConfigFileDiagnostics(): Diagnostic[];
  /**
   * Quick-info (hover) at `position` in `path`: the symbol signature as a
   * `typescript` code block + rendered JSDoc, with the symbol's span as `range`.
   * `null` when there is nothing to hover (no symbol/whitespace).
   */
  getQuickInfo(path: string, position: Position): Hover | null;
  /** Go-to-definition: the declaration sites for the symbol at `position`. */
  getDefinition(path: string, position: Position): Location[];
  /** Go-to-type-definition: the declaration sites of the TYPE of the symbol. */
  getTypeDefinition(path: string, position: Position): Location[];
  /** Completion candidates at `position` (labels + kinds; details on demand). */
  getCompletions(path: string, position: Position): CompletionList;
  /**
   * Resolve one completion entry (by `label`) to its full detail (signature +
   * docs). `null` when the entry is unknown at that position. v1 keys on `label`
   * only — see the method body for the source/data limitation note.
   */
  getCompletionDetails(path: string, position: Position, label: string): CompletionItem | null;
  /**
   * Find-references for the symbol at `position`. Every occurrence (across files)
   * as a {@link Location}. When `context.includeDeclaration` is false the
   * declaration sites (`isDefinition`) are filtered out — so this needs
   * `findReferences` (which flags definitions), not the flatter
   * `getReferencesAtPosition`.
   */
  getReferences(path: string, position: Position, context: ReferenceContext): Location[];
  /**
   * Prepare-rename probe at `position`: the span to rename + the seed text, or
   * `null` when the element there cannot be renamed (keyword, string literal,
   * non-renameable import path). Mirrors `ls.getRenameInfo`.
   */
  prepareRename(path: string, position: Position): PrepareRenameResult | null;
  /**
   * Compute the cross-file edits to rename the symbol at `position` to `newName`.
   * Returns a {@link WorkspaceEdit} keyed by VFS path; empty `changes` when the
   * element cannot be renamed (no lying — an empty edit set, not a thrown happy
   * path). Honors tsc's prefix/suffix text (property-shorthand expansion etc.).
   */
  getRenameEdits(path: string, position: Position, newName: string): WorkspaceEdit;
  /**
   * Signature help at `position` (typically inside a call's argument list): the
   * applicable signatures + the active signature/parameter, or `null` when there
   * is no call context. Mirrors `ls.getSignatureHelpItems`.
   */
  getSignatureHelp(path: string, position: Position): SignatureHelp | null;
  openDocument(path: string, text: string): void;
  updateDocument(path: string, text: string): void;
  closeDocument(path: string): void;
  /** Signal an external VFS write so TS drops its cached copy of `path`. */
  invalidate(path: string): void;
}

function severityOf(category: ts.DiagnosticCategory): DiagnosticSeverity {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return DiagnosticSeverity.Error;
    case ts.DiagnosticCategory.Warning:
      return DiagnosticSeverity.Warning;
    case ts.DiagnosticCategory.Suggestion:
      return DiagnosticSeverity.Hint;
    default: // Message
      return DiagnosticSeverity.Information;
  }
}

/**
 * Map a `ts.Diagnostic` to an LSP {@link Diagnostic}. Range comes from the
 * diagnostic's own source file text (`start`+`length`, 0-based via
 * {@link offsetToPosition}); a diagnostic without a file/position collapses to
 * the document start.
 */
function toLspDiagnostic(d: ts.Diagnostic): Diagnostic {
  const text = d.file?.text ?? '';
  const start = d.start ?? 0;
  const end = start + (d.length ?? 0);
  return {
    range: {
      start: offsetToPosition(text, start),
      end: offsetToPosition(text, end),
    },
    severity: severityOf(d.category),
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    code: typeof d.code === 'number' ? d.code : undefined,
    source: 'ts',
  };
}

export async function createTsLanguageService(
  deps: CreateTsLanguageServiceDeps,
): Promise<TsLanguageService> {
  const { fsSync, projectRoot } = deps;
  const libMap = await loadLibDts();
  const parsed = loadTsConfig(fsSync, projectRoot);
  const overlay = createDocumentOverlay();

  const host = createVfsLanguageServiceHost({
    fsSync,
    projectRoot,
    compilerOptions: parsed.options,
    fileNames: parsed.fileNames,
    libMap,
    overlay,
  });
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());

  // tsc routes config-file errors (unknown options, bad option values, bad
  // include/extends) onto the ParsedCommandLine — captured once at build, mapped
  // through the SAME LSP mapper as program diagnostics (real tsserver surfaces
  // these for a broken tsconfig).
  const configDiagnostics = parsed.errors.map(toLspDiagnostic);

  /**
   * Text of `path` as the program sees it (overlay buffer → std-lib → VFS) —
   * the host's own `readFile` does exactly that resolution, so definition/hover
   * spans map against the SAME bytes TS computed them from. `''` if absent (a
   * missing target collapses spans to the document start, like diagnostics).
   */
  const readText = (path: string): string => host.readFile?.(path) ?? '';

  /** Map a `position` in `path` to a TS offset using the file's current text. */
  const offsetAt = (path: string, position: Position): number =>
    positionToOffset(readText(path), position);

  /** Map ts.DefinitionInfo[] → Location[] (each target's own text → Range). */
  const toLocations = (defs: readonly ts.DefinitionInfo[] | undefined): Location[] =>
    (defs ?? []).map((d) => ({
      uri: d.fileName,
      range: spanToRange(readText(d.fileName), d.textSpan),
    }));

  return {
    getSemanticDiagnostics: (path) => service.getSemanticDiagnostics(path).map(toLspDiagnostic),
    getSyntacticDiagnostics: (path) => service.getSyntacticDiagnostics(path).map(toLspDiagnostic),
    getConfigFileDiagnostics: () => [...configDiagnostics],
    getQuickInfo: (path, position) => {
      const info = service.getQuickInfoAtPosition(path, offsetAt(path, position));
      return info ? quickInfoToHover(info, readText(path)) : null;
    },
    getDefinition: (path, position) =>
      toLocations(service.getDefinitionAtPosition(path, offsetAt(path, position))),
    getTypeDefinition: (path, position) =>
      toLocations(service.getTypeDefinitionAtPosition(path, offsetAt(path, position))),
    getCompletions: (path, position) => {
      const info = service.getCompletionsAtPosition(path, offsetAt(path, position), undefined);
      return {
        isIncomplete: info?.isIncomplete === true,
        items: (info?.entries ?? []).map(completionEntryToItem),
      };
    },
    getCompletionDetails: (path, position, label) => {
      const offset = offsetAt(path, position);
      // The resolve frame carries only `label`, but getCompletionEntryDetails
      // needs the entry's `source`/`data` to be exact. So re-query the list and
      // thread the real `source`/`data` through — members, locals, globals AND a
      // uniquely-named auto-import all resolve correctly (no lying bare-label
      // resolve). Residual gap: two SAME-named candidates → first wins.
      // TODO(backlog: protocol/ts-completion-resolve-by-label)
      const list = service.getCompletionsAtPosition(path, offset, undefined);
      const entry = list?.entries.find((e) => e.name === label);
      const details = service.getCompletionEntryDetails(
        path,
        offset,
        label,
        undefined,
        entry?.source,
        undefined,
        entry?.data,
      );
      if (!details) return null;
      const documentation = renderDocumentation(details.documentation, details.tags);
      const item: CompletionItem = {
        label: details.name,
        kind: entry ? completionEntryToItem(entry).kind : undefined,
        detail: partsToString(details.displayParts),
        ...(documentation ? { documentation: { kind: 'markdown', value: documentation } } : {}),
      };
      return item;
    },
    getReferences: (path, position, context) => {
      // findReferences (NOT getReferencesAtPosition): the flattened entries carry
      // `isDefinition`, which is what `includeDeclaration: false` filters on. Each
      // entry's span maps against ITS OWN file's text (cross-file safe).
      const symbols = service.findReferences(path, offsetAt(path, position)) ?? [];
      const out: Location[] = [];
      for (const sym of symbols) {
        for (const ref of sym.references) {
          if (context.includeDeclaration === false && ref.isDefinition === true) continue;
          out.push({ uri: ref.fileName, range: spanToRange(readText(ref.fileName), ref.textSpan) });
        }
      }
      return out;
    },
    prepareRename: (path, position) => {
      const info = service.getRenameInfo(path, offsetAt(path, position), {
        allowRenameOfImportPath: false,
      });
      if (!info.canRename) return null;
      const result: PrepareRenameResult = {
        range: spanToRange(readText(path), info.triggerSpan),
        placeholder: info.displayName,
      };
      return result;
    },
    getRenameEdits: (path, position, newName) => {
      const locations =
        service.findRenameLocations(path, offsetAt(path, position), false, false, {
          providePrefixAndSuffixTextForRename: true,
        }) ?? [];
      const changes: Record<string, TextEdit[]> = {};
      for (const loc of locations) {
        const edits = changes[loc.fileName] ?? [];
        edits.push(renameLocationToTextEdit(loc, newName, readText(loc.fileName)));
        changes[loc.fileName] = edits;
      }
      return { changes };
    },
    getSignatureHelp: (path, position) => {
      const items = service.getSignatureHelpItems(path, offsetAt(path, position), undefined);
      return items ? signatureHelpItemsToSignatureHelp(items) : null;
    },
    openDocument: (path, text) => overlay.open(path, text),
    updateDocument: (path, text) => overlay.update(path, text),
    closeDocument: (path) => overlay.close(path),
    invalidate: (path) => {
      overlay.invalidate(path);
    },
  };
}
