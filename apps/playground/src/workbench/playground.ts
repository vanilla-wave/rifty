import type { LogEntry } from '@riftydev/git';
import type {
  CodeAction,
  CodeFixOptions,
  CombinedCodeFixOptions,
  CompletionDetailsOptions,
  CompletionItem,
  CompletionList,
  CompletionOptions,
  DefinitionLinks,
  Diagnostic,
  DocumentHighlight,
  DocumentSymbol,
  EncodedClassifications,
  FoldingRange,
  FormattingOptions,
  Hover,
  InlayHint,
  InlayHintOptions,
  LinkedEditingRanges,
  Location,
  OrganizeImportsOptions,
  Position,
  PrepareRenameResult,
  QuickInfoOptions,
  Range,
  RefactorOptions,
  ReferenceContext,
  RenameOptions,
  SelectionRange,
  SignatureHelp,
  SignatureHelpOptions,
  TextEdit,
  WorkspaceEdit,
} from '@riftydev/ts-language-service/lsp-types';
import { createBrowserOpenPlaygroundWorkbench } from './internal/browser-workbench-composition.ts';
import type { Workbench, WorkbenchOptions, WorkbenchProjectOpenOptions } from './open-workbench.ts';
import type { PreviewHandle } from './preview-readiness.ts';
import type { ProjectDefinition } from './project-definition.ts';
import type { ProjectSession } from './project-session.ts';
import type { ProjectTerminalSnapshot } from './project-terminal.ts';

export type { ProjectTerminalSnapshot } from './project-terminal.ts';

export interface PlaygroundProjectOpenOptions extends WorkbenchProjectOpenOptions {
  readonly initialTerminalState?: ProjectTerminalSnapshot;
}

export interface PlaygroundTerminalStateRestoreInput {
  readonly format: 'project-rooted' | 'legacy-workspace-absolute';
  readonly state: ProjectTerminalSnapshot;
}

export interface PlaygroundTrustedSnapshot {
  readonly snapshotId: string;
  readonly assetUrl: string;
  readonly templateId: string;
}

export type PlaygroundFirstMaterialization =
  | { readonly kind: 'snapshot'; readonly snapshot: PlaygroundTrustedSnapshot }
  | { readonly kind: 'install' };

interface PlaygroundPlanBase {
  readonly id: string;
  readonly starterId: string;
  readonly templateId: string;
  readonly files: Readonly<Record<string, string | Uint8Array>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly firstMaterialization: PlaygroundFirstMaterialization;
}

export interface VitePlaygroundPlan extends PlaygroundPlanBase {
  readonly kind: 'vite';
  readonly port: number;
  readonly viteVersion?: string;
}

export interface NodeServerPlaygroundPlan extends PlaygroundPlanBase {
  readonly kind: 'node-server';
  readonly entryPath: string;
  readonly port: number;
}

export interface NodeCliPlaygroundPlan extends PlaygroundPlanBase {
  readonly kind: 'node-cli';
  readonly entryPath: string;
  readonly args?: readonly string[];
}

export type PlaygroundProjectPlan =
  | VitePlaygroundPlan
  | NodeServerPlaygroundPlan
  | NodeCliPlaygroundPlan;

export type PlaygroundProjectRef =
  | { readonly kind: 'scratch' }
  | { readonly kind: 'project'; readonly id: string };

export interface PlaygroundProject {
  readonly id: string;
  readonly name: string;
  readonly starterId: string;
  readonly editedAt: string;
}

export interface PlaygroundScratch {
  readonly starterId: string;
  readonly dirty: boolean;
  readonly editedAt: string;
}

export interface PlaygroundCatalogSnapshot {
  readonly active: PlaygroundProjectRef | null;
  readonly scratch: PlaygroundScratch | null;
  readonly projects: readonly PlaygroundProject[];
}

export interface PlaygroundProjectCatalog {
  snapshot(): PlaygroundCatalogSnapshot;
  subscribe(listener: (snapshot: PlaygroundCatalogSnapshot) => void): () => void;
  createScratch(input: {
    readonly definition: ProjectDefinition<unknown>;
    readonly preserveDirtySameStarter?: boolean;
  }): Promise<PlaygroundCatalogSnapshot>;
  saveScratch(input: {
    readonly id: string;
    readonly name: string;
    readonly definition: ProjectDefinition<unknown>;
  }): Promise<PlaygroundCatalogSnapshot>;
  activate(target: PlaygroundProjectRef): Promise<PlaygroundCatalogSnapshot>;
  rename(id: string, name: string): Promise<PlaygroundCatalogSnapshot>;
  reset(input: {
    readonly target: PlaygroundProjectRef;
    readonly definition: ProjectDefinition<unknown>;
  }): Promise<PlaygroundCatalogSnapshot>;
  delete(id: string): Promise<PlaygroundCatalogSnapshot>;
}

export interface PlaygroundTypeScript {
  reinitialize(): Promise<void>;
  open(path: string, text: string): Promise<void>;
  update(path: string, text: string): Promise<void>;
  close(path: string): Promise<void>;
  invalidate(path: string): Promise<void>;
  getSemanticDiagnostics(path: string): Promise<readonly Diagnostic[]>;
  getSyntacticDiagnostics(path: string): Promise<readonly Diagnostic[]>;
  getQuickInfo(path: string, position: Position, options?: QuickInfoOptions): Promise<Hover | null>;
  getDefinitionLinks(path: string, position: Position): Promise<DefinitionLinks>;
  getTypeDefinition(path: string, position: Position): Promise<readonly Location[]>;
  getCompletions(
    path: string,
    position: Position,
    options?: CompletionOptions,
  ): Promise<CompletionList>;
  getCompletionDetails(
    path: string,
    position: Position,
    label: string,
    source?: string,
    data?: unknown,
    options?: CompletionDetailsOptions,
  ): Promise<CompletionItem | null>;
  getReferences(
    path: string,
    position: Position,
    context: ReferenceContext,
  ): Promise<readonly Location[]>;
  prepareRename(
    path: string,
    position: Position,
    options?: RenameOptions,
  ): Promise<PrepareRenameResult | null>;
  getRenameEdits(
    path: string,
    position: Position,
    newName: string,
    options?: RenameOptions,
  ): Promise<WorkspaceEdit>;
  getSignatureHelp(
    path: string,
    position: Position,
    options?: SignatureHelpOptions,
  ): Promise<SignatureHelp | null>;
  getCodeFixes(
    path: string,
    range: Range,
    errorCodes: number[],
    options?: CodeFixOptions,
  ): Promise<readonly CodeAction[]>;
  getCombinedCodeFix(
    path: string,
    fixId: unknown,
    options?: CombinedCodeFixOptions,
  ): Promise<WorkspaceEdit>;
  organizeImports(path: string, options?: OrganizeImportsOptions): Promise<WorkspaceEdit>;
  getRefactorActions(
    path: string,
    range: Range,
    options?: RefactorOptions,
  ): Promise<readonly CodeAction[]>;
  getFormattingEdits(path: string, options: FormattingOptions): Promise<readonly TextEdit[]>;
  getRangeFormattingEdits(
    path: string,
    range: Range,
    options: FormattingOptions,
  ): Promise<readonly TextEdit[]>;
  getOnTypeFormattingEdits(
    path: string,
    position: Position,
    key: string,
    options: FormattingOptions,
  ): Promise<readonly TextEdit[]>;
  getImplementation(path: string, position: Position): Promise<readonly Location[]>;
  getDocumentSymbols(path: string): Promise<readonly DocumentSymbol[]>;
  getFoldingRanges(path: string): Promise<readonly FoldingRange[]>;
  getInlayHints(
    path: string,
    range: Range,
    options?: InlayHintOptions,
  ): Promise<readonly InlayHint[]>;
  getDocumentHighlights(
    path: string,
    position: Position,
    filesToSearch: readonly string[],
  ): Promise<readonly DocumentHighlight[]>;
  getEncodedSemanticClassifications(path: string, range: Range): Promise<EncodedClassifications>;
  getSelectionRange(path: string, position: Position): Promise<SelectionRange | null>;
  getLinkedEditingRange(path: string, position: Position): Promise<LinkedEditingRanges | null>;
}

export interface PlaygroundScmChange {
  readonly path: string;
  readonly code: string;
  readonly area: 'staged' | 'working';
}

export interface PlaygroundScmSnapshot {
  readonly branch?: string;
  readonly history: readonly LogEntry[];
  readonly changes: readonly PlaygroundScmChange[];
}

export interface PlaygroundScmBlob {
  readonly source: 'head' | 'index' | 'working' | 'empty';
  readonly bytes: Uint8Array;
}

export interface PlaygroundScmDiff {
  readonly original: PlaygroundScmBlob;
  readonly modified: PlaygroundScmBlob;
}

export interface PlaygroundScm {
  snapshot(): PlaygroundScmSnapshot;
  subscribe(listener: (snapshot: PlaygroundScmSnapshot) => void): () => void;
  refresh(): Promise<PlaygroundScmSnapshot>;
  diff(change: PlaygroundScmChange): Promise<PlaygroundScmDiff>;
  stage(path: string): Promise<void>;
  unstage(path: string): Promise<void>;
  discard(path: string): Promise<void>;
  commit(message: string): Promise<string>;
}

export interface PlaygroundArchiveV1 {
  readonly version: 1;
  readonly root: '/';
  readonly files: readonly {
    readonly path: string;
    readonly encoding: 'base64';
    readonly content: string;
  }[];
}

export interface PlaygroundArchive {
  export(): Promise<string>;
  import(archiveJson: string): Promise<void>;
}

export interface PlaygroundPreview extends PreviewHandle {
  readonly label: string;
  readonly source: 'dev-server' | 'preview' | 'node';
}

export interface PlaygroundPreviewRegistry {
  snapshot(): readonly PlaygroundPreview[];
  subscribe(listener: (snapshot: readonly PlaygroundPreview[]) => void): () => void;
}

export interface PlaygroundSessionTools {
  readonly typescript: PlaygroundTypeScript;
  readonly scm: PlaygroundScm;
  readonly archive: PlaygroundArchive;
  readonly previews: PlaygroundPreviewRegistry;
  awaitDurability(): Promise<void>;
}

export interface PlaygroundWorkbench extends Workbench {
  openProject<TReady>(
    definition: ProjectDefinition<TReady>,
    options?: PlaygroundProjectOpenOptions,
  ): Promise<ProjectSession<TReady>>;
  readonly playground: {
    define(plan: VitePlaygroundPlan): ProjectDefinition<PreviewHandle>;
    define(plan: NodeServerPlaygroundPlan): ProjectDefinition<PreviewHandle>;
    define(plan: NodeCliPlaygroundPlan): ProjectDefinition<void>;
    define(plan: PlaygroundProjectPlan): ProjectDefinition<unknown>;
    readonly catalog: PlaygroundProjectCatalog;
    restoreTerminalState(input: PlaygroundTerminalStateRestoreInput): ProjectTerminalSnapshot;
    forSession<T>(session: ProjectSession<T>): PlaygroundSessionTools;
  };
}

export type PlaygroundWorkbenchOptions = Omit<WorkbenchOptions, 'deployment'> & {
  readonly deployment: Omit<WorkbenchOptions['deployment'], 'workers'> & {
    readonly workers: WorkbenchOptions['deployment']['workers'] & {
      readonly typescript: string;
    };
  };
};

/** Browser composition is wired with the owner/catalog implementation at the integration seam. */
export type OpenPlaygroundWorkbench = (
  options: PlaygroundWorkbenchOptions,
) => Promise<PlaygroundWorkbench>;

/** First-party browser companion; deployment assets remain explicit caller input. */
export const openPlaygroundWorkbench: OpenPlaygroundWorkbench =
  createBrowserOpenPlaygroundWorkbench();
