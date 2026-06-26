import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
import { createMemoryFs } from '@riftydev/vfs/internal';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import type {
  CompletionOptions,
  FormattingOptions,
  Position,
  Range,
  TextEdit,
} from './lsp-types.ts';
import {
  callHierarchyItemToLsp,
  classifiedSpanToLsp,
  fileTextChangesToWorkspaceEdit,
  formattingOptionsToFormatCodeSettings,
  highlightSpanToDocumentHighlight,
  incomingCallToLsp,
  inlayHintToLsp,
  linkedEditingInfoToLsp,
  navigateToItemToSymbolInformation,
  navigationBarItemToLsp,
  navigationTreeToDocumentSymbol,
  outgoingCallToLsp,
  outliningSpanToFoldingRange,
  quickInfoToHover,
  selectionRangeToLsp,
  spanToRange,
  textChangesToTextEdits,
  todoCommentToLsp,
} from './mapping.ts';
import { offsetToPosition, positionToOffset } from './position.ts';
import { createTsLanguageService } from './service.ts';

const RIFTY_ROOT = '/proj';
const nodeRequire = createRequire(import.meta.url);

const FIXTURE = {
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      strict: true,
      noUnusedLocals: true,
      jsx: 'react-jsx',
      module: 'esnext',
      moduleResolution: 'bundler',
      target: 'es2022',
      types: [],
    },
  }),
  'base.ts':
    'export interface Runner {\n' +
    '  run(value: string): string;\n' +
    '}\n' +
    'export function callRunner(runner: Runner): string {\n' +
    '  return runner.run("ok");\n' +
    '}\n',
  'impl.ts':
    'import { Runner, callRunner } from "./base";\n' +
    'export class Greeter implements Runner {\n' +
    '  run(value: string): string {\n' +
    '    return value.toUpperCase();\n' +
    '  }\n' +
    '}\n' +
    'export function useGreeter(): string {\n' +
    '  const unused = 1;\n' +
    '  const greeter = new Greeter();\n' +
    '  return callRunner(greeter);\n' +
    '}\n' +
    '// TODO: keep the long-tail todo comment visible\n',
  'tags.tsx':
    'declare namespace JSX { interface IntrinsicElements { div: { id?: string }; span: {}; } }\n' +
    'export function View() {\n' +
    '  const label = "x";\n' +
    '  return <div id={label}><span>hello</span></div>;\n' +
    '}\n',
  'format.ts': 'export function f() {\nif (true) {\nreturn 1;\n}\n}\n',
  'doc.ts': 'export function documented(value: string): string {\n  return value;\n}\n',
  'missing-source.ts': 'export class MissingGreeter {}\n',
  'missing.ts': 'const first = new MissingGreeter();\nconst second = new MissingGreeter();\n',
  'copied.ts': 'import { Greeter } from "./impl";\n' + 'const pastedGreeter = new Greeter();\n',
  'paste-target.ts': 'const pastedGreeter = new Greeter();\n',
};

const tmpRoots: string[] = [];
afterAll(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
});

function writeTmpFixture(): string {
  const root = mkdtempSync(nodePath.join(tmpdir(), 'rifty-ts-long-tail-'));
  tmpRoots.push(root);
  for (const [rel, text] of Object.entries(FIXTURE)) {
    const abs = nodePath.join(root, rel);
    mkdirSync(nodePath.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return root;
}

function writeVfsFixture(): ReturnType<typeof createMemoryFs>['fsSync'] {
  const { fsSync } = createMemoryFs();
  const enc = new TextEncoder();
  for (const [rel, text] of Object.entries(FIXTURE)) {
    const abs = `${RIFTY_ROOT}/${rel}`;
    const dir = abs.slice(0, abs.lastIndexOf('/')) || '/';
    fsSync.mkdirSync(dir, { recursive: true });
    fsSync.writeFileSync(abs, enc.encode(text));
  }
  return fsSync;
}

function writeRealWorkspaceTypeScript(fsSync: ReturnType<typeof createMemoryFs>['fsSync']): void {
  const enc = new TextEncoder();
  const packageJson = nodeRequire.resolve('typescript/package.json');
  const packageRoot = nodePath.dirname(packageJson);
  const libDir = nodePath.join(packageRoot, 'lib');
  const target = `${RIFTY_ROOT}/node_modules/typescript`;
  fsSync.mkdirSync(`${target}/lib`, { recursive: true });
  fsSync.writeFileSync(`${target}/package.json`, enc.encode(readFileSync(packageJson, 'utf8')));
  for (const name of readdirSync(libDir)) {
    if (name !== 'typescript.js' && !/^lib(\.[^.]+)*\.d\.ts$/.test(name)) continue;
    fsSync.writeFileSync(
      `${target}/lib/${name}`,
      enc.encode(readFileSync(nodePath.join(libDir, name), 'utf8')),
    );
  }
}

function buildGold(root: string): {
  readonly service: ts.LanguageService;
  readonly host: ts.LanguageServiceHost;
  readonly rel: (abs: string) => string;
} {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) throw new Error('fixture tsconfig missing');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    read.config ?? {},
    ts.sys,
    nodePath.dirname(configPath),
    undefined,
    configPath,
  );
  const fileVersions = new Map<string, string>();
  for (const file of parsed.fileNames) fileVersions.set(file, '0');
  const temporaryTexts = new Map<string, string>();
  const temporaryVersions = new Map<string, number>();
  const serviceRef: { current?: ts.LanguageService } = {};
  const host: ts.LanguageServiceHost & {
    runWithTemporaryFileUpdate(
      rootFile: string,
      updatedText: string,
      cb: (
        updatedProgram: ts.Program | undefined,
        originalProgram: ts.Program | undefined,
        updatedFile: ts.SourceFile | undefined,
      ) => void,
    ): void;
  } = {
    getCompilationSettings: () => parsed.options,
    getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: (fileName) =>
      `${fileVersions.get(fileName) ?? '0'}:${temporaryVersions.get(fileName) ?? 0}`,
    getScriptSnapshot: (fileName) => {
      const text = temporaryTexts.get(fileName) ?? ts.sys.readFile(fileName);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => root,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (fileName) => temporaryTexts.has(fileName) || ts.sys.fileExists(fileName),
    readFile: (fileName) => temporaryTexts.get(fileName) ?? ts.sys.readFile(fileName),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    runWithTemporaryFileUpdate(rootFile, updatedText, cb) {
      const hadTemporary = temporaryTexts.has(rootFile);
      const previousText = temporaryTexts.get(rootFile);
      const bump = (): void => {
        temporaryVersions.set(rootFile, (temporaryVersions.get(rootFile) ?? 0) + 1);
      };
      const originalProgram = serviceRef.current?.getProgram();
      temporaryTexts.set(rootFile, updatedText);
      bump();
      try {
        const updatedProgram = serviceRef.current?.getProgram();
        cb(updatedProgram, originalProgram, updatedProgram?.getSourceFile(rootFile));
      } finally {
        if (hadTemporary && previousText !== undefined) temporaryTexts.set(rootFile, previousText);
        else temporaryTexts.delete(rootFile);
        bump();
      }
    },
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  serviceRef.current = service;
  return {
    service,
    host,
    rel: (abs) => nodePath.relative(root, abs).split(nodePath.sep).join('/'),
  };
}

function probePosition(fileText: string, needle: string, inner: number): Position {
  const at = fileText.indexOf(needle);
  if (at === -1) throw new Error(`needle not found: ${needle}`);
  return offsetToPosition(fileText, at + inner);
}

function abs(root: string, rel: string): string {
  return nodePath.join(root, rel);
}

function lspRangeFor(text: string, needle: string): Range {
  const start = text.indexOf(needle);
  if (start === -1) throw new Error(`needle not found: ${needle}`);
  return {
    start: offsetToPosition(text, start),
    end: offsetToPosition(text, start + needle.length),
  };
}

function remapGoldChanges(
  edit: ReturnType<typeof fileTextChangesToWorkspaceEdit>,
  rel: (abs: string) => string,
): Record<string, TextEdit[]> {
  return Object.fromEntries(
    Object.entries(edit.changes).map(([fileName, edits]) => [
      `${RIFTY_ROOT}/${rel(fileName)}`,
      edits,
    ]),
  );
}

function remapGoldEmit(output: ts.EmitOutput, rel: (abs: string) => string) {
  return {
    emitSkipped: output.emitSkipped,
    outputFiles: output.outputFiles.map((file) => ({
      name: `${RIFTY_ROOT}/${rel(file.name)}`,
      writeByteOrderMark: file.writeByteOrderMark,
      text: file.text,
    })),
    diagnostics: output.diagnostics.map((diag) => diag.code),
  };
}

describe('parity: remaining achievable ts.LanguageService surface', () => {
  it('matches real TS for navigation, decorations, call hierarchy and long-tail editor queries', async () => {
    const root = writeTmpFixture();
    const gold = buildGold(root);
    const fsSync = writeVfsFixture();
    const svc = await createTsLanguageService({ fsSync, projectRoot: RIFTY_ROOT });

    const implText = FIXTURE['impl.ts'];
    const baseText = FIXTURE['base.ts'];
    const tagsText = FIXTURE['tags.tsx'];
    const formatText = FIXTURE['format.ts'];
    const docText = FIXTURE['doc.ts'];
    const missingText = FIXTURE['missing.ts'];
    const copiedText = FIXTURE['copied.ts'];
    const pasteTargetText = FIXTURE['paste-target.ts'];
    const fmtOptions: FormattingOptions = { tabSize: 2, insertSpaces: true };
    const fmtSettings = formattingOptionsToFormatCodeSettings(fmtOptions);
    const defaultFmtSettings = formattingOptionsToFormatCodeSettings({
      tabSize: 4,
      insertSpaces: true,
    });

    const runnerPos = probePosition(baseText, 'Runner {', 1);
    const runnerOffset = positionToOffset(baseText, runnerPos);
    const greeterPos = probePosition(implText, 'Greeter implements', 1);
    const greeterOffset = positionToOffset(implText, greeterPos);
    const runImplPos = probePosition(implText, 'run(value', 1);
    const runImplOffset = positionToOffset(implText, runImplPos);
    const labelPos = probePosition(tagsText, '<div id={label}', 10);
    const labelOffset = positionToOffset(tagsText, labelPos);

    expect(svc.getImplementation(`${RIFTY_ROOT}/base.ts`, runnerPos)).toEqual(
      (gold.service.getImplementationAtPosition(abs(root, 'base.ts'), runnerOffset) ?? []).map(
        (entry) => ({
          uri: `${RIFTY_ROOT}/${gold.rel(entry.fileName)}`,
          range: spanToRange(gold.host.readFile?.(entry.fileName) ?? '', entry.textSpan),
        }),
      ),
    );

    const goldBound = gold.service.getDefinitionAndBoundSpan(abs(root, 'impl.ts'), greeterOffset);
    expect(svc.getDefinitionLinks(`${RIFTY_ROOT}/impl.ts`, greeterPos)).toEqual({
      originSelectionRange: goldBound ? spanToRange(implText, goldBound.textSpan) : undefined,
      locations: (goldBound?.definitions ?? []).map((entry) => ({
        targetUri: `${RIFTY_ROOT}/${gold.rel(entry.fileName)}`,
        targetRange: spanToRange(
          gold.host.readFile?.(entry.fileName) ?? '',
          entry.contextSpan ?? entry.textSpan,
        ),
        targetSelectionRange: spanToRange(
          gold.host.readFile?.(entry.fileName) ?? '',
          entry.textSpan,
        ),
        originSelectionRange: goldBound ? spanToRange(implText, goldBound.textSpan) : undefined,
      })),
    });

    expect(svc.getSuggestionDiagnostics(`${RIFTY_ROOT}/impl.ts`).map((d) => d.code)).toEqual(
      gold.service.getSuggestionDiagnostics(abs(root, 'impl.ts')).map((d) => d.code),
    );
    expect(svc.getCompilerOptionsDiagnostics().map((d) => d.code)).toEqual(
      gold.service.getCompilerOptionsDiagnostics().map((d) => d.code),
    );

    const goldNavigationTree = gold.service.getNavigationTree(abs(root, 'impl.ts'));
    expect(svc.getDocumentSymbols(`${RIFTY_ROOT}/impl.ts`)).toEqual(
      (goldNavigationTree.childItems ?? [goldNavigationTree]).map((item) =>
        navigationTreeToDocumentSymbol(item, implText),
      ),
    );
    expect(svc.getNavigationBarItems(`${RIFTY_ROOT}/impl.ts`)).toEqual(
      gold.service
        .getNavigationBarItems(abs(root, 'impl.ts'))
        .map((item) => navigationBarItemToLsp(item, implText)),
    );
    expect(svc.getFoldingRanges(`${RIFTY_ROOT}/impl.ts`)).toEqual(
      gold.service
        .getOutliningSpans(abs(root, 'impl.ts'))
        .map((span) => outliningSpanToFoldingRange(span, implText)),
    );
    const remapNavigateToItems = (items: readonly ts.NavigateToItem[]) =>
      items.map((item) => {
        const symbol = navigateToItemToSymbolInformation(
          item,
          (fileName) => gold.host.readFile?.(fileName) ?? '',
        );
        return {
          ...symbol,
          location: {
            ...symbol.location,
            uri: `${RIFTY_ROOT}/${gold.rel(symbol.location.uri)}`,
          },
        };
      });
    expect(svc.getWorkspaceSymbols('Greeter')).toEqual(
      remapNavigateToItems(gold.service.getNavigateToItems('Greeter')),
    );
    expect(svc.getWorkspaceSymbols('Greeter', { maxResultCount: 1 })).toEqual(
      remapNavigateToItems(gold.service.getNavigateToItems('Greeter', 1)),
    );
    expect(svc.getWorkspaceSymbols('Greeter', { fileName: `${RIFTY_ROOT}/impl.ts` })).toEqual(
      remapNavigateToItems(
        gold.service.getNavigateToItems('Greeter', undefined, abs(root, 'impl.ts')),
      ),
    );
    expect(svc.getWorkspaceSymbols('Greeter', { excludeDtsFiles: true })).toEqual(
      remapNavigateToItems(gold.service.getNavigateToItems('Greeter', undefined, undefined, true)),
    );
    expect(svc.getWorkspaceSymbols('Greeter', { excludeLibFiles: true })).toEqual(
      remapNavigateToItems(
        gold.service.getNavigateToItems('Greeter', undefined, undefined, undefined, true),
      ),
    );

    const inlayRange = lspRangeFor(implText, 'new Greeter()');
    expect(svc.getInlayHints(`${RIFTY_ROOT}/impl.ts`, inlayRange)).toEqual(
      gold.service
        .provideInlayHints(
          abs(root, 'impl.ts'),
          {
            start: implText.indexOf('new Greeter()'),
            length: 'new Greeter()'.length,
          },
          undefined,
        )
        .map((hint) => inlayHintToLsp(hint, implText)),
    );
    expect(
      svc.getDocumentHighlights(`${RIFTY_ROOT}/impl.ts`, greeterPos, [`${RIFTY_ROOT}/impl.ts`]),
    ).toEqual(
      gold.service
        .getDocumentHighlights(abs(root, 'impl.ts'), greeterOffset, [abs(root, 'impl.ts')])
        ?.flatMap((doc) =>
          doc.highlightSpans.map((span) => highlightSpanToDocumentHighlight(span, implText)),
        ) ?? [],
    );
    expect(
      svc.getSemanticClassifications(`${RIFTY_ROOT}/impl.ts`, lspRangeFor(implText, 'Greeter')),
    ).toEqual(
      gold.service
        .getSemanticClassifications(abs(root, 'impl.ts'), {
          start: implText.indexOf('Greeter'),
          length: 'Greeter'.length,
        })
        .map((span) => classifiedSpanToLsp(span, implText)),
    );
    expect(
      svc.getSemanticClassifications(
        `${RIFTY_ROOT}/impl.ts`,
        lspRangeFor(implText, 'Greeter'),
        '2020',
      ),
    ).toEqual(
      gold.service
        .getSemanticClassifications(
          abs(root, 'impl.ts'),
          {
            start: implText.indexOf('Greeter'),
            length: 'Greeter'.length,
          },
          ts.SemanticClassificationFormat.TwentyTwenty,
        )
        .map((span) => classifiedSpanToLsp(span, implText)),
    );
    expect(
      svc.getEncodedSemanticClassifications(
        `${RIFTY_ROOT}/impl.ts`,
        lspRangeFor(implText, 'Greeter'),
      ),
    ).toEqual(
      gold.service.getEncodedSemanticClassifications(
        abs(root, 'impl.ts'),
        {
          start: implText.indexOf('Greeter'),
          length: 'Greeter'.length,
        },
        ts.SemanticClassificationFormat.TwentyTwenty,
      ),
    );
    expect(
      svc.getEncodedSemanticClassifications(
        `${RIFTY_ROOT}/impl.ts`,
        lspRangeFor(implText, 'Greeter'),
      ).spans.length,
    ).toBeGreaterThan(0);
    expect(
      svc.getSyntacticClassifications(`${RIFTY_ROOT}/impl.ts`, lspRangeFor(implText, 'Greeter')),
    ).toEqual(
      gold.service
        .getSyntacticClassifications(abs(root, 'impl.ts'), {
          start: implText.indexOf('Greeter'),
          length: 'Greeter'.length,
        })
        .map((span) => classifiedSpanToLsp(span, implText)),
    );
    expect(
      svc.getEncodedSyntacticClassifications(
        `${RIFTY_ROOT}/impl.ts`,
        lspRangeFor(implText, 'Greeter'),
      ),
    ).toEqual(
      gold.service.getEncodedSyntacticClassifications(abs(root, 'impl.ts'), {
        start: implText.indexOf('Greeter'),
        length: 'Greeter'.length,
      }),
    );
    expect(svc.toLineColumnOffset(`${RIFTY_ROOT}/impl.ts`, greeterOffset)).toEqual(
      gold.service.toLineColumnOffset?.(abs(root, 'impl.ts'), greeterOffset) ?? null,
    );

    const readGold = (fileName: string): string => gold.host.readFile?.(fileName) ?? '';
    const remapGoldFileName = (fileName: string): string => {
      const baseName = nodePath.basename(fileName);
      if (/^lib(\.[^.]+)*\.d\.ts$/.test(baseName)) return `/ts-lib/${baseName}`;
      return `${RIFTY_ROOT}/${gold.rel(fileName)}`;
    };
    const remapCallItem = (item: ReturnType<typeof callHierarchyItemToLsp>) => ({
      ...item,
      uri: remapGoldFileName(item.uri),
    });
    const remapIncoming = (call: ReturnType<typeof incomingCallToLsp>) => ({
      ...call,
      from: remapCallItem(call.from),
    });
    const remapOutgoing = (call: ReturnType<typeof outgoingCallToLsp>) => ({
      ...call,
      to: remapCallItem(call.to),
    });
    const goldPrepared = gold.service.prepareCallHierarchy(abs(root, 'impl.ts'), runImplOffset);
    const goldPreparedItems = goldPrepared
      ? Array.isArray(goldPrepared)
        ? goldPrepared
        : [goldPrepared]
      : [];
    expect(svc.prepareCallHierarchy(`${RIFTY_ROOT}/impl.ts`, runImplPos)).toEqual(
      goldPreparedItems.map((item) => remapCallItem(callHierarchyItemToLsp(item, readGold))),
    );
    expect(svc.getIncomingCalls(`${RIFTY_ROOT}/impl.ts`, runImplPos)).toEqual(
      gold.service
        .provideCallHierarchyIncomingCalls(abs(root, 'impl.ts'), runImplOffset)
        .map((call) => remapIncoming(incomingCallToLsp(call, readGold))),
    );
    const actualOutgoingCalls = svc.getOutgoingCalls(`${RIFTY_ROOT}/impl.ts`, runImplPos);
    expect(actualOutgoingCalls).toEqual(
      gold.service
        .provideCallHierarchyOutgoingCalls(abs(root, 'impl.ts'), runImplOffset)
        .map((call) => remapOutgoing(outgoingCallToLsp(call, readGold, abs(root, 'impl.ts')))),
    );
    expect(
      actualOutgoingCalls.some((call) =>
        call.fromRanges.some((range) => {
          const expected = lspRangeFor(implText, 'value.toUpperCase');
          return JSON.stringify(range) === JSON.stringify(expected);
        }),
      ),
    ).toBe(true);

    const fmtPosition = probePosition(formatText, '}\n}', 0);
    expect(
      svc.getOnTypeFormattingEdits(`${RIFTY_ROOT}/format.ts`, fmtPosition, '}', fmtOptions),
    ).toEqual(
      textChangesToTextEdits(
        gold.service.getFormattingEditsAfterKeystroke(
          abs(root, 'format.ts'),
          positionToOffset(formatText, fmtPosition),
          '}',
          fmtSettings,
        ),
        formatText,
      ),
    );

    const refactorNeedle = 'value.toUpperCase()';
    const refactorStart = implText.indexOf(refactorNeedle);
    const refactorRange = lspRangeFor(implText, refactorNeedle);
    const refactorSpan = { pos: refactorStart, end: refactorStart + refactorNeedle.length };
    const goldRefactorInfos = gold.service.getApplicableRefactors(
      abs(root, 'impl.ts'),
      refactorSpan,
      undefined,
      'invoked',
      undefined,
      false,
    );
    const goldRefactor = goldRefactorInfos.flatMap((refactor) =>
      refactor.actions
        .filter((action) => !action.notApplicableReason)
        .map((action) => ({ refactor, action })),
    )[0];
    if (!goldRefactor) throw new Error('expected a refactor action');
    const goldRefactorEdit = gold.service.getEditsForRefactor(
      abs(root, 'impl.ts'),
      defaultFmtSettings,
      refactorSpan,
      goldRefactor.refactor.name,
      goldRefactor.action.name,
      undefined,
    );
    if (!goldRefactorEdit) throw new Error('expected refactor edit');
    if (
      goldRefactorEdit.renameFilename === undefined ||
      goldRefactorEdit.renameLocation === undefined
    ) {
      throw new Error('expected refactor edit to request post-edit rename');
    }
    const expectedRefactorRenameUri = `${RIFTY_ROOT}/${gold.rel(goldRefactorEdit.renameFilename)}`;
    const expectedRefactorRenamePosition = offsetToPosition(
      gold.host.readFile?.(goldRefactorEdit.renameFilename) ?? '',
      goldRefactorEdit.renameLocation,
    );
    const expectedRefactorChanges = remapGoldChanges(
      fileTextChangesToWorkspaceEdit(
        goldRefactorEdit.edits,
        (fileName) => gold.host.readFile?.(fileName) ?? '',
      ),
      gold.rel,
    );
    const refactorActions = svc.getRefactorActions(`${RIFTY_ROOT}/impl.ts`, refactorRange);
    const actualRefactor = refactorActions.find(
      (action) =>
        action.refactorName === goldRefactor.refactor.name &&
        action.actionName === goldRefactor.action.name,
    );
    expect(actualRefactor?.refactorDescription).toBe(goldRefactor.refactor.description);
    expect(actualRefactor?.refactorInlineable).toBe(goldRefactor.refactor.inlineable);
    expect(actualRefactor?.range).toEqual(
      goldRefactor.action.range
        ? {
            start: {
              line: goldRefactor.action.range.start.line,
              character: goldRefactor.action.range.start.offset,
            },
            end: {
              line: goldRefactor.action.range.end.line,
              character: goldRefactor.action.range.end.offset,
            },
          }
        : undefined,
    );
    expect(actualRefactor?.edit?.changes).toEqual(expectedRefactorChanges);
    expect((actualRefactor?.edit as { renameFilename?: string } | undefined)?.renameFilename).toBe(
      expectedRefactorRenameUri,
    );
    expect(
      (actualRefactor?.edit as { renameLocation?: unknown } | undefined)?.renameLocation,
    ).toEqual({
      uri: expectedRefactorRenameUri,
      range: {
        start: expectedRefactorRenamePosition,
        end: expectedRefactorRenamePosition,
      },
    });
    const refactorEdit = svc.getRefactorEdits(
      `${RIFTY_ROOT}/impl.ts`,
      refactorRange,
      goldRefactor.refactor.name,
      goldRefactor.action.name,
    );
    expect(refactorEdit?.changes).toEqual(expectedRefactorChanges);
    expect((refactorEdit as { renameLocation?: unknown } | null)?.renameLocation).toEqual({
      uri: expectedRefactorRenameUri,
      range: {
        start: expectedRefactorRenamePosition,
        end: expectedRefactorRenamePosition,
      },
    });

    const firstMissingRange = lspRangeFor(missingText, 'MissingGreeter');
    const missingStart = missingText.indexOf('MissingGreeter');
    const missingFix = gold.service.getCodeFixesAtPosition(
      abs(root, 'missing.ts'),
      missingStart,
      missingStart + 'MissingGreeter'.length,
      [2304],
      defaultFmtSettings,
      {},
    )[0];
    if (!missingFix?.fixId) throw new Error('expected fix-all id');
    const expectedCombinedFixChanges = remapGoldChanges(
      fileTextChangesToWorkspaceEdit(
        gold.service.getCombinedCodeFix(
          { type: 'file', fileName: abs(root, 'missing.ts') },
          missingFix.fixId,
          defaultFmtSettings,
          {},
        ).changes,
        (fileName) => gold.host.readFile?.(fileName) ?? '',
      ),
      gold.rel,
    );
    const actualMissingFix = svc.getCodeFixes(
      `${RIFTY_ROOT}/missing.ts`,
      firstMissingRange,
      [2304],
    )[0];
    expect(actualMissingFix?.fixId).toBe(missingFix.fixId);
    expect(svc.getCombinedCodeFix(`${RIFTY_ROOT}/missing.ts`, missingFix.fixId).changes).toEqual(
      expectedCombinedFixChanges,
    );

    const dottedNeedle = 'value.toUpperCase';
    const dottedStart = implText.indexOf(dottedNeedle);
    const dottedRange: Range = {
      start: offsetToPosition(implText, dottedStart),
      end: offsetToPosition(implText, dottedStart + dottedNeedle.length),
    };
    const goldDottedSpan = gold.service.getNameOrDottedNameSpan(
      abs(root, 'impl.ts'),
      dottedStart,
      dottedStart + dottedNeedle.length,
    );
    expect(svc.getNameOrDottedNameSpan(`${RIFTY_ROOT}/impl.ts`, dottedRange)).toEqual(
      goldDottedSpan ? spanToRange(implText, goldDottedSpan) : null,
    );

    const returnPos = probePosition(implText, 'return value', 1);
    const returnOffset = positionToOffset(implText, returnPos);
    const goldBreakpoint = gold.service.getBreakpointStatementAtPosition(
      abs(root, 'impl.ts'),
      returnOffset,
    );
    expect(svc.getBreakpointStatement(`${RIFTY_ROOT}/impl.ts`, returnPos)).toEqual(
      goldBreakpoint ? spanToRange(implText, goldBreakpoint) : null,
    );

    const firstBracePos = probePosition(formatText, '{', 0);
    const firstBraceOffset = positionToOffset(formatText, firstBracePos);
    expect(svc.getBraceMatching(`${RIFTY_ROOT}/format.ts`, firstBracePos)).toEqual(
      gold.service
        .getBraceMatchingAtPosition(abs(root, 'format.ts'), firstBraceOffset)
        .map((span) => spanToRange(formatText, span)),
    );
    expect(svc.getBraceMatching(`${RIFTY_ROOT}/format.ts`, firstBracePos).length).toBeGreaterThan(
      0,
    );
    const returnFormatPos = probePosition(formatText, 'return 1', 0);
    expect(svc.getIndentation(`${RIFTY_ROOT}/format.ts`, returnFormatPos, fmtOptions)).toBe(
      gold.service.getIndentationAtPosition(
        abs(root, 'format.ts'),
        positionToOffset(formatText, returnFormatPos),
        fmtSettings,
      ),
    );
    expect(svc.isValidBraceCompletion(`${RIFTY_ROOT}/format.ts`, firstBracePos, '{')).toBe(
      gold.service.isValidBraceCompletionAtPosition(
        abs(root, 'format.ts'),
        firstBraceOffset,
        '{'.charCodeAt(0),
      ),
    );
    const todoPos = probePosition(implText, 'TODO', 1);
    const todoOffset = positionToOffset(implText, todoPos);
    const goldCommentSpan = gold.service.getSpanOfEnclosingComment(
      abs(root, 'impl.ts'),
      todoOffset,
      false,
    );
    expect(svc.getSpanOfEnclosingComment(`${RIFTY_ROOT}/impl.ts`, todoPos, false)).toEqual(
      goldCommentSpan ? spanToRange(implText, goldCommentSpan) : null,
    );

    const returnRange = lspRangeFor(formatText, 'return 1;');
    const returnTextRange = {
      pos: formatText.indexOf('return 1;'),
      end: formatText.indexOf('return 1;') + 'return 1;'.length,
    };
    expect(svc.toggleLineComment(`${RIFTY_ROOT}/format.ts`, returnRange)).toEqual(
      textChangesToTextEdits(
        gold.service.toggleLineComment(abs(root, 'format.ts'), returnTextRange),
        formatText,
      ),
    );
    expect(svc.toggleMultilineComment(`${RIFTY_ROOT}/format.ts`, returnRange)).toEqual(
      textChangesToTextEdits(
        gold.service.toggleMultilineComment(abs(root, 'format.ts'), returnTextRange),
        formatText,
      ),
    );
    expect(svc.commentSelection(`${RIFTY_ROOT}/format.ts`, returnRange)).toEqual(
      textChangesToTextEdits(
        gold.service.commentSelection(abs(root, 'format.ts'), returnTextRange),
        formatText,
      ),
    );
    const todoRange = lspRangeFor(implText, '// TODO: keep the long-tail todo comment visible');
    const todoTextRange = {
      pos: implText.indexOf('// TODO: keep the long-tail todo comment visible'),
      end:
        implText.indexOf('// TODO: keep the long-tail todo comment visible') +
        '// TODO: keep the long-tail todo comment visible'.length,
    };
    expect(svc.uncommentSelection(`${RIFTY_ROOT}/impl.ts`, todoRange)).toEqual(
      textChangesToTextEdits(
        gold.service.uncommentSelection(abs(root, 'impl.ts'), todoTextRange),
        implText,
      ),
    );

    const remapMaybe = (fileName: string): string =>
      nodePath.isAbsolute(fileName) ? `${RIFTY_ROOT}/${gold.rel(fileName)}` : fileName;
    const goldMoveSuggestions = gold.service.getMoveToRefactoringFileSuggestions(
      abs(root, 'impl.ts'),
      refactorSpan,
      undefined,
      'invoked',
    );
    expect(svc.getMoveToRefactoringFileSuggestions(`${RIFTY_ROOT}/impl.ts`, refactorRange)).toEqual(
      {
        newFileName: remapMaybe(goldMoveSuggestions.newFileName),
        files: goldMoveSuggestions.files.map(remapMaybe),
      },
    );

    const actualEmit = svc.getEmitOutput(`${RIFTY_ROOT}/impl.ts`);
    expect({
      ...actualEmit,
      diagnostics: actualEmit.diagnostics.map((diag) => diag.code),
    }).toEqual(remapGoldEmit(gold.service.getEmitOutput(abs(root, 'impl.ts')), gold.rel));
    expect(svc.getSupportedCodeFixes()).toEqual(gold.service.getSupportedCodeFixes());
    await expect(svc.applyCodeActionCommand([])).rejects.toMatchObject({
      name: 'NotImplementedError',
    });
    expect(() => svc.getProgram()).toThrowError(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'ts-language-service.getProgram',
      }),
    );
    expect(() =>
      svc.getCompletionEntrySymbol(`${RIFTY_ROOT}/impl.ts`, greeterPos, 'Greeter', undefined),
    ).toThrowError(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'ts-language-service.getCompletionEntrySymbol',
      }),
    );

    expect(svc.getSelectionRange(`${RIFTY_ROOT}/impl.ts`, greeterPos)).toEqual(
      selectionRangeToLsp(
        gold.service.getSmartSelectionRange(abs(root, 'impl.ts'), greeterOffset),
        implText,
      ),
    );
    expect(svc.getFileReferences(`${RIFTY_ROOT}/base.ts`)).toEqual(
      gold.service.getFileReferences(abs(root, 'base.ts')).map((ref) => ({
        uri: `${RIFTY_ROOT}/${gold.rel(ref.fileName)}`,
        range: spanToRange(readGold(ref.fileName), ref.textSpan),
      })),
    );
    expect(
      svc.getFileRenameEdits(`${RIFTY_ROOT}/base.ts`, `${RIFTY_ROOT}/core.ts`).changes,
    ).toEqual(
      Object.fromEntries(
        Object.entries(
          fileTextChangesToWorkspaceEdit(
            gold.service.getEditsForFileRename(
              abs(root, 'base.ts'),
              abs(root, 'core.ts'),
              defaultFmtSettings,
              {},
            ),
            (fileName) => gold.host.readFile?.(fileName) ?? '',
          ).changes,
        ).map(([fileName, edits]) => [`${RIFTY_ROOT}/${gold.rel(fileName)}`, edits]),
      ),
    );

    expect(
      svc.getJsxClosingTag(`${RIFTY_ROOT}/tags.tsx`, probePosition(tagsText, '<span>', 6)),
    ).toEqual(
      gold.service.getJsxClosingTagAtPosition(
        abs(root, 'tags.tsx'),
        tagsText.indexOf('<span>') + 6,
      ) ?? null,
    );
    const goldLinkedEditing = gold.service.getLinkedEditingRangeAtPosition(
      abs(root, 'tags.tsx'),
      labelOffset,
    );
    expect(svc.getLinkedEditingRange(`${RIFTY_ROOT}/tags.tsx`, labelPos)).toEqual(
      goldLinkedEditing ? linkedEditingInfoToLsp(goldLinkedEditing, tagsText) : null,
    );
    expect(
      svc.getDocCommentTemplate(`${RIFTY_ROOT}/doc.ts`, probePosition(docText, 'export', 0)),
    ).toEqual(
      gold.service.getDocCommentTemplateAtPosition(
        abs(root, 'doc.ts'),
        0,
        undefined,
        defaultFmtSettings,
      ),
    );
    expect(svc.getTodoComments(`${RIFTY_ROOT}/impl.ts`, [{ text: 'TODO', priority: 0 }])).toEqual(
      gold.service
        .getTodoComments(abs(root, 'impl.ts'), [{ text: 'TODO', priority: 0 }])
        .map((comment) => todoCommentToLsp(comment, implText)),
    );

    const pastedText = 'const pastedGreeter = new Greeter();\n';
    const copiedRange = lspRangeFor(copiedText, pastedText);
    const pasteLocation = lspRangeFor(pasteTargetText, pastedText);
    expect(svc.preparePasteEditsForFile(`${RIFTY_ROOT}/copied.ts`, [copiedRange])).toBe(
      gold.service.preparePasteEditsForFile(abs(root, 'copied.ts'), [
        {
          pos: copiedText.indexOf(pastedText),
          end: copiedText.indexOf(pastedText) + pastedText.length,
        },
      ]),
    );
    const goldPasteEdits = gold.service.getPasteEdits(
      {
        targetFile: abs(root, 'paste-target.ts'),
        pastedText: [pastedText],
        pasteLocations: [{ pos: 0, end: pastedText.length }],
        copiedFrom: {
          file: abs(root, 'copied.ts'),
          range: [
            {
              pos: copiedText.indexOf(pastedText),
              end: copiedText.indexOf(pastedText) + pastedText.length,
            },
          ],
        },
        preferences: {},
      },
      defaultFmtSettings,
    );
    const goldPaste = fileTextChangesToWorkspaceEdit(
      goldPasteEdits.edits,
      (fileName) => gold.host.readFile?.(fileName) ?? '',
    );
    const expectedPasteChanges = remapGoldChanges(goldPaste, gold.rel);
    const actualPaste = svc.getPasteEdits(
      `${RIFTY_ROOT}/paste-target.ts`,
      [pastedText],
      [pasteLocation],
      {
        file: `${RIFTY_ROOT}/copied.ts`,
        ranges: [copiedRange],
      },
    );
    expect(actualPaste.changes).toEqual(expectedPasteChanges);
    expect(actualPaste.fixId).toEqual(goldPasteEdits.fixId);
    expect(expectedPasteChanges[`${RIFTY_ROOT}/paste-target.ts`]?.[0]?.newText).toContain(
      'Greeter',
    );
  });

  it('honors organize-imports mode and refuses non-cloneable completion symbols loudly', async () => {
    const fixtureRoot = writeTmpFixture();
    const organizeText =
      'import { Greeter } from "./impl";\n' +
      'import { callRunner, Runner } from "./base";\n' +
      'export const value = callRunner(new Greeter());\n';
    const absGoldOrganize = abs(fixtureRoot, 'organize-mode.ts');
    writeFileSync(absGoldOrganize, organizeText);
    const gold = buildGold(fixtureRoot);
    const fsSync = writeVfsFixture();
    const enc = new TextEncoder();
    fsSync.writeFileSync(`${RIFTY_ROOT}/organize-mode.ts`, enc.encode(organizeText));
    const svc = await createTsLanguageService({ fsSync, projectRoot: RIFTY_ROOT });

    const expectedSortOnly = remapGoldChanges(
      fileTextChangesToWorkspaceEdit(
        gold.service.organizeImports(
          {
            type: 'file',
            fileName: absGoldOrganize,
            mode: ts.OrganizeImportsMode.SortAndCombine,
          },
          formattingOptionsToFormatCodeSettings({ tabSize: 2, insertSpaces: true }),
          {},
        ),
        (fileName) => gold.host.readFile?.(fileName) ?? '',
      ),
      gold.rel,
    );
    const actualSortOnly = svc.organizeImports(`${RIFTY_ROOT}/organize-mode.ts`, {
      mode: 'SortAndCombine',
      formattingOptions: { tabSize: 2, insertSpaces: true },
    });
    expect(actualSortOnly.changes).toEqual(expectedSortOnly);
    expect(
      Object.values(actualSortOnly.changes)
        .flat()
        .map((edit) => edit.newText)
        .join(''),
    ).toContain('Runner');

    const implText = FIXTURE['impl.ts'];
    expect(() =>
      svc.getCompletions(`${RIFTY_ROOT}/impl.ts`, probePosition(implText, 'value.', 6), {
        preferences: { includeSymbol: true },
      }),
    ).toThrowError(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'ts-language-service.completions.includeSymbol',
      }),
    );
    expect(() =>
      svc.getCompletions(`${RIFTY_ROOT}/impl.ts`, probePosition(implText, 'value.', 6), {
        includeSymbol: true,
      } as CompletionOptions),
    ).toThrowError(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'ts-language-service.completions.includeSymbol',
      }),
    );
  });

  it('honors clone-safe TS query options instead of hardcoding editor defaults', async () => {
    const root = writeTmpFixture();
    const gold = buildGold(root);
    const fsSync = writeVfsFixture();
    const svc = await createTsLanguageService({ fsSync, projectRoot: RIFTY_ROOT });

    const implText = FIXTURE['impl.ts'];
    const copiedText = FIXTURE['copied.ts'];
    const greeterPos = probePosition(implText, 'Greeter implements', 1);
    const greeterOffset = positionToOffset(implText, greeterPos);

    expect(svc.getQuickInfo(`${RIFTY_ROOT}/impl.ts`, greeterPos, { maximumLength: 4 })).toEqual(
      (() => {
        const goldInfo = gold.service.getQuickInfoAtPosition(
          abs(root, 'impl.ts'),
          greeterOffset,
          4,
        );
        return goldInfo ? quickInfoToHover(goldInfo, implText) : null;
      })(),
    );

    const importPathPos = probePosition(copiedText, '"./impl"', 2);
    const importPathOffset = positionToOffset(copiedText, importPathPos);
    const goldImportRename = gold.service.getRenameInfo(abs(root, 'copied.ts'), importPathOffset, {
      allowRenameOfImportPath: true,
    });
    if (!goldImportRename.canRename) {
      throw new Error(goldImportRename.localizedErrorMessage);
    }
    const expectedImportRenamePlaceholder = nodePath.isAbsolute(goldImportRename.displayName)
      ? `${RIFTY_ROOT}/${gold.rel(goldImportRename.displayName)}`
      : goldImportRename.displayName;
    expect(
      svc.prepareRename(`${RIFTY_ROOT}/copied.ts`, importPathPos, {
        preferences: { allowRenameOfImportPath: true },
      }),
    ).toEqual({
      range: spanToRange(copiedText, goldImportRename.triggerSpan),
      placeholder: expectedImportRenamePlaceholder,
    });
    const goldFileToRename = goldImportRename.fileToRename;
    expect(goldFileToRename).toBe(abs(root, 'impl.ts'));
    if (goldFileToRename === undefined) {
      throw new Error('TypeScript did not expose fileToRename for import-path rename');
    }
    const expectedImportRenameChanges = remapGoldChanges(
      fileTextChangesToWorkspaceEdit(
        gold.service.getEditsForFileRename(
          goldFileToRename,
          abs(root, 'renamed.ts'),
          formattingOptionsToFormatCodeSettings({ tabSize: 4, insertSpaces: true }),
          { allowRenameOfImportPath: true },
        ),
        (fileName) => gold.host.readFile?.(fileName) ?? '',
      ),
      gold.rel,
    );
    expect(
      svc.getRenameEdits(`${RIFTY_ROOT}/copied.ts`, importPathPos, `${RIFTY_ROOT}/renamed.ts`, {
        preferences: { allowRenameOfImportPath: true },
      }).changes,
    ).toEqual(expectedImportRenameChanges);

    const inlayRange = lspRangeFor(implText, 'const greeter = new Greeter()');
    expect(
      svc.getInlayHints(`${RIFTY_ROOT}/impl.ts`, inlayRange, {
        preferences: { includeInlayVariableTypeHints: false },
      }),
    ).toEqual(
      gold.service
        .provideInlayHints(
          abs(root, 'impl.ts'),
          {
            start: implText.indexOf('const greeter = new Greeter()'),
            length: 'const greeter = new Greeter()'.length,
          },
          { includeInlayVariableTypeHints: false },
        )
        .map((hint) => inlayHintToLsp(hint, implText)),
    );

    const refactorNeedle = 'value.toUpperCase()';
    const refactorRange = lspRangeFor(implText, refactorNeedle);
    const refactorSpan = {
      pos: implText.indexOf(refactorNeedle),
      end: implText.indexOf(refactorNeedle) + refactorNeedle.length,
    };
    const extractConstant = svc.getRefactorActions(`${RIFTY_ROOT}/impl.ts`, refactorRange, {
      kind: 'refactor.extract.constant',
      includeInteractiveActions: false,
    });
    const goldExtractConstant = gold.service.getApplicableRefactors(
      abs(root, 'impl.ts'),
      refactorSpan,
      undefined,
      'invoked',
      'refactor.extract.constant',
      false,
    );
    expect(extractConstant.map((action) => action.actionName)).toEqual(
      goldExtractConstant.flatMap((refactor) => refactor.actions.map((action) => action.name)),
    );
  });

  it('uses the project-installed TypeScript compiler and lib files when present', async () => {
    const root = writeTmpFixture();
    const gold = buildGold(root);
    const fsSync = writeVfsFixture();
    writeRealWorkspaceTypeScript(fsSync);
    const logs: string[] = [];

    const svc = await createTsLanguageService({
      fsSync,
      projectRoot: RIFTY_ROOT,
      log: (message) => logs.push(message),
    });

    expect(logs.join('\n')).toContain('init: workspace typescript');
    expect(svc.getSemanticDiagnostics(`${RIFTY_ROOT}/impl.ts`).map((d) => d.code)).toEqual(
      gold.service.getSemanticDiagnostics(abs(root, 'impl.ts')).map((d) => d.code),
    );
  });

  it('fails loudly when a workspace TypeScript package is present but broken', async () => {
    const fsSync = writeVfsFixture();
    fsSync.mkdirSync(`${RIFTY_ROOT}/node_modules/typescript`, { recursive: true });
    fsSync.writeFileSync(
      `${RIFTY_ROOT}/node_modules/typescript/package.json`,
      new TextEncoder().encode(JSON.stringify({ name: 'typescript', version: '0.0.0-broken' })),
    );

    await expect(createTsLanguageService({ fsSync, projectRoot: RIFTY_ROOT })).rejects.toThrow(
      'workspace TypeScript compiler unreadable',
    );
  });
});
