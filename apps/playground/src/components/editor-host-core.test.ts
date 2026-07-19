/**
 * Behavioral heirs of the retired EditorHost source greps (epic
 * playground-testable-core): node vitest drives the REAL createEditorHostCore —
 * models, tabs, debounced owner writes, git diffs, dirty gutter, close trees —
 * through its public API. Fakes stand in ONLY at the boundaries the component
 * owns: the mounted Monaco widgets (host surface), the owner snapshot vfs, and
 * the owner ports (readGitOriginalText / readNodeModulesFile / onFileWritten).
 * monaco-editor itself is the vitest-aliased test stub (test-monaco-editor.ts).
 *
 * Solid SERVER runtime: createEffect is a no-op here, so effect bodies are
 * invoked manually (handleInitialFilesChanged / handleRootChanged /
 * handleGitStatusChanged / syncActiveEditor) — exactly what the component wires.
 */
import * as monaco from 'monaco-editor';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FsOpsTarget } from '../glue/fs-ops.ts';
import {
  type EditorDocumentEvent,
  type EditorGitOriginalTextInput,
  type EditorHostCore,
  type EditorHostProps,
  type EditorHostSurface,
  createEditorHostCore,
} from './editor-host-core.ts';

const enc = new TextEncoder();

/** Drain queued microtasks (promise callbacks + queueMicrotask disposals). */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: Error) => void;
} {
  let resolve: (v: T) => void = () => {};
  let reject: (e: Error) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FakeVfs {
  readonly target: FsOpsTarget;
  seed(path: string, text: string): void;
  publishFrame(): void;
}

function unusedOp(op: string): never {
  throw new Error(`fake snapshot vfs: ${op} is not part of the editor read path`);
}

/** Owner-snapshot fake: sync reads + the applied-frame subscription, nothing else. */
function fakeVfs(files: Record<string, string>, opts: { frames?: boolean } = {}): FakeVfs {
  const bytes = new Map<string, Uint8Array>();
  for (const [path, text] of Object.entries(files)) bytes.set(path, enc.encode(text));
  const listeners = new Set<() => void>();
  const target: FsOpsTarget = {
    existsSync: (path) => bytes.has(path),
    readFileBytesSync(path) {
      const data = bytes.get(path);
      if (!data) throw new Error(`ENOENT: no such file "${path}"`);
      return data;
    },
    writeFileSync: () => unusedOp('writeFileSync'),
    readdirSync: () => unusedOp('readdirSync'),
    mkdirSync: () => unusedOp('mkdirSync'),
    rmSync: () => unusedOp('rmSync'),
    renameSync: () => unusedOp('renameSync'),
    statSync: () => unusedOp('statSync'),
    ...(opts.frames === false
      ? {}
      : {
          subscribe(listener: () => void) {
            listeners.add(listener);
            return () => void listeners.delete(listener);
          },
        }),
  };
  return {
    target,
    seed: (path, text) => void bytes.set(path, enc.encode(text)),
    publishFrame() {
      for (const listener of [...listeners]) listener();
    },
  };
}

type DiffPair = { original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel };

interface FakeSurface {
  readonly host: EditorHostSurface;
  editorModel(): monaco.editor.ITextModel | null;
  editorOptions(): { readonly readOnly?: boolean };
  diffEditorOptions(): { readonly readOnly?: boolean };
  position(): monaco.IPosition | undefined;
  focusCount(): number;
  diffModel(): DiffPair | null;
  gutter(): readonly monaco.editor.IModelDeltaDecoration[];
}

/** The mounted Monaco widgets the component's host accessors expose. */
function fakeSurface(): FakeSurface {
  let model: monaco.editor.ITextModel | null = null;
  let options: { readOnly?: boolean } = {};
  let position: monaco.IPosition | undefined;
  let focusCount = 0;
  const editor = {
    getModel: () => model,
    setModel(next: monaco.editor.ITextModel | null) {
      model = next;
    },
    updateOptions(next: { readOnly?: boolean }) {
      options = { ...options, ...next };
    },
    setPosition(p: monaco.IPosition) {
      position = p;
    },
    revealPositionInCenter() {},
    revealRangeInCenter() {},
    setSelection() {},
    focus() {
      focusCount += 1;
    },
  };
  let diffPair: DiffPair | null = null;
  let diffOptions: { readOnly?: boolean } = {};
  const diffEditor = {
    setModel(next: DiffPair | null) {
      diffPair = next;
    },
    updateOptions(next: { readOnly?: boolean }) {
      diffOptions = { ...diffOptions, ...next };
    },
  };
  let decorations: readonly monaco.editor.IModelDeltaDecoration[] = [];
  const dirtyGutter = {
    set(next: readonly monaco.editor.IModelDeltaDecoration[]) {
      decorations = [...next];
    },
    clear() {
      decorations = [];
    },
  };
  return {
    host: {
      getEditor: () => editor as unknown as monaco.editor.IStandaloneCodeEditor,
      getDiffEditor: () => diffEditor as unknown as monaco.editor.IStandaloneDiffEditor,
      getDirtyGutter: () => dirtyGutter as unknown as monaco.editor.IEditorDecorationsCollection,
    },
    editorModel: () => model,
    editorOptions: () => options,
    diffEditorOptions: () => diffOptions,
    position: () => position,
    focusCount: () => focusCount,
    diffModel: () => diffPair,
    gutter: () => decorations,
  };
}

interface HarnessOptions {
  readonly files?: Record<string, string>;
  readonly root?: string;
  /** false → snapshot vfs without `subscribe` (no frames can ever arrive). */
  readonly frames?: boolean;
  /** path → HEAD original text the default readGitOriginalText resolves. */
  readonly gitOriginals?: Record<string, string>;
  readonly readGitOriginalText?: NonNullable<EditorHostProps['readGitOriginalText']>;
  readonly readNodeModulesFile?: NonNullable<EditorHostProps['readNodeModulesFile']>;
  readonly onFileWritten?: (path: string, content: string) => Promise<void> | void;
}

const liveCores: Pick<EditorHostCore, 'teardownPendingWork' | 'teardownModels'>[] = [];

function createHarness(opts: HarnessOptions = {}) {
  const vfs = fakeVfs(opts.files ?? {}, { frames: opts.frames ?? true });
  const [initialFiles, setInitialFiles] = createSignal<readonly string[]>([]);
  const [root, setRoot] = createSignal(opts.root ?? '/p');
  const [gitStatus, setGitStatus] = createSignal<ReadonlyMap<string, string>>(new Map());
  const errors: string[] = [];
  const written: { path: string; content: string }[] = [];
  const active: { label: string; language: string; path?: string }[] = [];
  const gitReads: EditorGitOriginalTextInput[] = [];
  const readGitOriginalText: NonNullable<EditorHostProps['readGitOriginalText']> = (input) => {
    gitReads.push(input);
    if (opts.readGitOriginalText) return opts.readGitOriginalText(input);
    return Promise.resolve(opts.gitOriginals?.[input.path] ?? '');
  };
  const surface = fakeSurface();
  const props: EditorHostProps = {
    initialEditorFiles: initialFiles,
    root,
    vfs: vfs.target,
    registerApi: () => {},
    onActive: (info) => void active.push(info),
    onFileWritten(path, content) {
      written.push({ path, content });
      return opts.onFileWritten?.(path, content);
    },
    onError: (message) => void errors.push(message),
    readGitOriginalText,
    gitStatus,
    ...(opts.readNodeModulesFile ? { readNodeModulesFile: opts.readNodeModulesFile } : {}),
  };
  const core = createEditorHostCore(props, surface.host);
  liveCores.push(core);
  return {
    core,
    vfs,
    surface,
    errors,
    written,
    active,
    gitReads,
    setInitialFiles,
    setRoot,
    setGitStatus,
  };
}

function mustModel(core: EditorHostCore, path: string): monaco.editor.ITextModel {
  const model = core.modelForPath(path);
  if (!model) throw new Error(`no model open for ${path}`);
  return model;
}

afterEach(() => {
  for (const core of liveCores.splice(0)) {
    core.teardownPendingWork();
    core.teardownModels();
  }
  vi.useRealTimers();
});

describe('editor-host-core initial tabs', () => {
  it('hydrates initial tabs before registration-time user opens are drained', () => {
    const h = createHarness({
      files: { '/p/initial.ts': 'initial', '/p/user-picked.ts': 'picked' },
    });
    h.setInitialFiles(['/p/initial.ts']);

    h.core.registerHydratedApi((api) => api.openFile('/p/user-picked.ts'));

    expect(h.core.tabs().map((tab) => tab.id)).toEqual(['/p/initial.ts', '/p/user-picked.ts']);
    expect(h.core.activeId()).toBe('/p/user-picked.ts');
  });

  it('openInitialFiles replaces the tab set with ordinary file tabs (root-relative titles, first active)', () => {
    const h = createHarness({ files: { '/p/a.ts': 'aaa', '/p/src/b.css': 'bbb' } });
    h.core.api.openInitialFiles(['/p/a.ts', '/p/src/b.css']);
    expect(h.core.tabs().map((t) => ({ id: t.id, kind: t.kind, title: t.title }))).toEqual([
      { id: '/p/a.ts', kind: 'file', title: 'a.ts' },
      { id: '/p/src/b.css', kind: 'file', title: 'src/b.css' },
    ]);
    expect(h.core.activeId()).toBe('/p/a.ts');
    expect(h.core.modelForPath('/p/src/b.css')?.getValue()).toBe('bbb');
  });

  it('a reset disposes every previously open model before opening the new set', () => {
    const h = createHarness({ files: { '/p/a.ts': 'aaa', '/p/d.ts': 'ddd' } });
    h.core.api.openFile('/p/d.ts');
    const events: EditorDocumentEvent[] = [];
    h.core.api.onDocument((ev) => void events.push(ev));
    h.core.api.openInitialFiles(['/p/a.ts']);
    expect(h.core.modelForPath('/p/d.ts')).toBeUndefined();
    expect(h.core.tabs().map((t) => t.id)).toEqual(['/p/a.ts']);
    expect(events.some((ev) => ev.path === '/p/d.ts' && ev.kind === 'close')).toBe(true);
  });

  it('the initial-files effect body skips when the paths key is unchanged (models survive)', () => {
    const h = createHarness({ files: { '/p/a.ts': 'aaa', '/p/b.ts': 'bbb' } });
    h.setInitialFiles(['/p/a.ts']);
    h.core.handleInitialFilesChanged();
    const first = h.core.modelForPath('/p/a.ts');
    expect(first).toBeDefined();
    h.core.handleInitialFilesChanged(); // same key — must not reset
    expect(h.core.modelForPath('/p/a.ts')).toBe(first);
    h.setInitialFiles(['/p/a.ts', '/p/b.ts']);
    h.core.handleInitialFilesChanged(); // key changed — full reset
    expect(h.core.tabs().map((t) => t.id)).toEqual(['/p/a.ts', '/p/b.ts']);
    expect(h.core.modelForPath('/p/a.ts')).not.toBe(first);
  });

  it('imperative openInitialFiles shares the dedup key — the App signal echo does not double-reset', () => {
    const h = createHarness({ files: { '/p/c.ts': 'ccc' } });
    h.core.api.openInitialFiles(['/p/c.ts']);
    const model = h.core.modelForPath('/p/c.ts');
    expect(model).toBeDefined();
    h.setInitialFiles(['/p/c.ts']); // App reset writes the signal too…
    h.core.handleInitialFilesChanged(); // …and its echoed effect run must not dispose+reopen
    expect(h.core.modelForPath('/p/c.ts')).toBe(model);
  });

  it('admits only model-backed initial tabs and keeps an available sibling active while an earlier file awaits its frame', () => {
    const h = createHarness({ files: { '/p/second.ts': 'second' } });
    h.setInitialFiles(['/p/late.ts', '/p/second.ts']);

    h.core.handleInitialFilesChanged();

    expect(h.core.tabs().map((tab) => tab.id)).toEqual(['/p/second.ts']);
    expect(h.core.activeId()).toBe('/p/second.ts');
    expect(h.core.modelForPath('/p/late.ts')).toBeUndefined();

    h.vfs.seed('/p/late.ts', 'late');
    h.vfs.publishFrame();

    expect(h.core.tabs().map((tab) => tab.id)).toEqual(['/p/second.ts', '/p/late.ts']);
    expect(mustModel(h.core, '/p/late.ts').getValue()).toBe('late');
    expect(h.core.activeId()).toBe('/p/second.ts');
  });
});

describe('editor-host-core openFile classification', () => {
  it('opens a snapshot-readable file editable and publishes its label/language', () => {
    const h = createHarness({ files: { '/p/src/main.ts': 'export {};' } });
    h.core.api.openFile('/p/src/main.ts');
    h.core.syncActiveEditor();
    expect(h.surface.editorModel()).toBe(mustModel(h.core, '/p/src/main.ts'));
    expect(h.surface.editorOptions().readOnly).toBe(false);
    expect(h.active.at(-1)).toEqual({
      label: 'main.ts',
      language: 'typescript',
      path: '/p/src/main.ts',
    });
  });

  it('re-opening an open path re-activates the existing model — never a second model per path', () => {
    const h = createHarness({ files: { '/p/a.ts': 'aaa', '/p/b.ts': 'bbb' } });
    h.core.api.openFile('/p/a.ts');
    const first = mustModel(h.core, '/p/a.ts');
    h.core.api.openFile('/p/b.ts');
    expect(h.core.activeId()).toBe('/p/b.ts');
    h.core.api.openFile('/p/a.ts');
    expect(h.core.activeId()).toBe('/p/a.ts');
    expect(mustModel(h.core, '/p/a.ts')).toBe(first);
    expect(h.core.tabs()).toHaveLength(2);
  });

  it('node_modules files open read-only via the owner read-port: loading placeholder, then content', async () => {
    const read = deferred<{ size: number; content: Uint8Array | null }>();
    const h = createHarness({ readNodeModulesFile: () => read.promise });
    h.core.api.openFile('/p/node_modules/pkg/index.js');
    expect(mustModel(h.core, '/p/node_modules/pkg/index.js').getValue()).toBe('// loading…');
    h.core.syncActiveEditor();
    expect(h.surface.editorOptions().readOnly).toBe(true);
    read.resolve({ size: 5, content: enc.encode('hello') });
    await settle();
    expect(mustModel(h.core, '/p/node_modules/pkg/index.js').getValue()).toBe('hello');
  });

  it('read-port placeholders stay honest: over-cap and binary are labeled, never faked as empty', async () => {
    const h = createHarness({
      readNodeModulesFile: (path) =>
        path.endsWith('big.js')
          ? Promise.resolve({ size: 123456, content: null })
          : Promise.resolve({ size: 3, content: new Uint8Array([0, 1, 2]) }),
    });
    h.core.api.openFile('/p/node_modules/pkg/big.js');
    h.core.api.openFile('/p/node_modules/pkg/blob.bin');
    await settle();
    expect(mustModel(h.core, '/p/node_modules/pkg/big.js').getValue()).toBe(
      '// too large to preview — 123456 bytes',
    );
    expect(mustModel(h.core, '/p/node_modules/pkg/blob.bin').getValue()).toBe(
      '// binary file — 3 bytes — not editable',
    );
  });

  it('a seeded file absent from the snapshot opens EDITABLE on the next published frame', () => {
    const h = createHarness({});
    h.core.api.openFile('/p/seeded.ts');
    expect(h.core.modelForPath('/p/seeded.ts')).toBeUndefined(); // awaiting the frame…
    expect(h.errors).toEqual([]); // …which is not an error — the owner publish is in flight
    h.vfs.seed('/p/seeded.ts', 'seeded content');
    h.vfs.publishFrame();
    expect(mustModel(h.core, '/p/seeded.ts').getValue()).toBe('seeded content');
    h.core.syncActiveEditor();
    expect(h.surface.editorOptions().readOnly).toBe(false); // editable, never view-only
  });

  it('an explicit open awaiting a frame still activates when it lands', () => {
    const h = createHarness({ files: { '/p/current.ts': 'current' } });
    h.core.api.openFile('/p/current.ts');
    h.core.api.openFile('/p/requested.ts');

    h.vfs.seed('/p/requested.ts', 'requested');
    h.vfs.publishFrame();

    expect(h.core.activeId()).toBe('/p/requested.ts');
    expect(mustModel(h.core, '/p/requested.ts').getValue()).toBe('requested');
  });

  it('with no snapshot frames to wait for, a missing file surfaces the read error loudly', () => {
    const h = createHarness({ frames: false });
    h.core.api.openFile('/p/missing.ts');
    expect(h.errors).toEqual(['ENOENT: no such file "/p/missing.ts"']);
  });

  it('openFile reveal jumps the cursor once the tab becomes the active model (Problems click)', () => {
    const h = createHarness({ files: { '/p/a.ts': 'one\ntwo\nthree\n' } });
    h.core.api.openFile('/p/a.ts', { reveal: { line: 3, column: 2 } });
    expect(h.surface.position()).toBeUndefined(); // editor widget not on this model yet
    h.core.syncActiveEditor();
    expect(h.surface.position()).toEqual({ lineNumber: 3, column: 2 });
    expect(h.surface.focusCount()).toBe(1);
    h.core.syncActiveEditor(); // the reveal is one-shot — later effect runs must not re-jump
    expect(h.surface.focusCount()).toBe(1);
  });
});

describe('editor-host-core working diff (Open Changes)', () => {
  it('openWorkingDiff diffs the LIVE working model against the owner git original', async () => {
    const h = createHarness({
      files: { '/p/src/a.ts': 'working text' },
      gitOriginals: { '/p/src/a.ts': 'original text' },
    });
    h.core.api.openWorkingDiff({ path: '/p/src/a.ts', ref: 'HEAD' });
    await settle();
    expect(h.core.tabs().find((t) => t.kind === 'diff')).toMatchObject({
      id: 'diff:HEAD:/p/src/a.ts',
      title: 'a.ts ↔ HEAD',
      originalTitle: 'HEAD',
      modifiedTitle: 'a.ts',
    });
    expect(h.core.activeId()).toBe('diff:HEAD:/p/src/a.ts');
    h.core.syncActiveEditor();
    const pair = h.surface.diffModel();
    expect(pair?.original.getValue()).toBe('original text');
    expect(pair?.original.uri.scheme).toBe('rifty-git');
    expect(pair?.original.uri.query).toBe('ref=HEAD');
    expect(pair?.modified).toBe(mustModel(h.core, '/p/src/a.ts')); // live model, not a copy
    expect(h.surface.diffEditorOptions().readOnly).toBe(false);
    expect(h.gitReads).toEqual([{ path: '/p/src/a.ts', ref: 'HEAD' }]);
    expect(h.active.at(-1)).toEqual({
      label: 'a.ts ↔ HEAD',
      language: 'typescript',
      path: '/p/src/a.ts',
    });
  });

  it('a deleted file diffs the git original against the supplied snapshot text (rifty-working scheme)', async () => {
    const h = createHarness({ gitOriginals: { '/p/gone.ts': 'was here' } });
    h.core.api.openWorkingDiff({ path: '/p/gone.ts', ref: 'HEAD', deleted: true, modified: '' });
    await settle();
    h.core.syncActiveEditor();
    const pair = h.surface.diffModel();
    expect(pair?.original.getValue()).toBe('was here');
    expect(pair?.modified.getValue()).toBe('');
    expect(pair?.modified.uri.scheme).toBe('rifty-working');
  });

  it('rejects a diff over a read-only working file with a loud error and no tab', async () => {
    const h = createHarness({
      readNodeModulesFile: () => Promise.resolve({ size: 3, content: enc.encode('lib') }),
    });
    h.core.api.openFile('/p/node_modules/pkg/index.js');
    await settle();
    h.core.api.openWorkingDiff({ path: '/p/node_modules/pkg/index.js', ref: 'HEAD' });
    expect(h.errors).toEqual([
      'Cannot open diff for /p/node_modules/pkg/index.js: working file is not text-editable',
    ]);
    expect(h.core.tabs().every((t) => t.kind === 'file')).toBe(true);
    expect(h.gitReads).toEqual([]);
  });

  it('a deleted file without snapshot text errors loudly instead of faking a diff', () => {
    const h = createHarness({});
    h.core.api.openWorkingDiff({ path: '/p/gone.ts', ref: 'HEAD', deleted: true });
    expect(h.errors).toEqual(['Cannot open diff for /p/gone.ts: working file is not available']);
    expect(h.core.tabs()).toEqual([]);
  });

  it('a re-issued diff open cancels the stale pending one — the latest snapshot wins', async () => {
    const original = deferred<string>();
    const h = createHarness({ readGitOriginalText: () => original.promise });
    h.core.api.openWorkingDiff({
      path: '/p/gone.ts',
      ref: 'HEAD',
      deleted: true,
      modified: 'stale',
    });
    h.core.api.openWorkingDiff({
      path: '/p/gone.ts',
      ref: 'HEAD',
      deleted: true,
      modified: 'fresh',
    });
    original.resolve('was here');
    await settle();
    expect(h.core.tabs().filter((t) => t.kind === 'diff')).toHaveLength(1);
    h.core.syncActiveEditor();
    expect(h.surface.diffModel()?.modified.getValue()).toBe('fresh');
    expect(h.gitReads).toHaveLength(1); // the in-flight original read is shared via the cache
  });

  it('hasOriginal:false renders an empty original without asking the owner', async () => {
    const h = createHarness({
      files: { '/p/new.ts': 'fresh file' },
      gitOriginals: { '/p/new.ts': 'MUST NOT BE READ' },
    });
    h.core.api.openWorkingDiff({ path: '/p/new.ts', ref: 'HEAD', hasOriginal: false });
    await settle();
    h.core.syncActiveEditor();
    expect(h.surface.diffModel()?.original.getValue()).toBe('');
    expect(h.gitReads).toEqual([]);
  });

  it('an owner original read failure surfaces onError and opens no diff tab', async () => {
    const h = createHarness({
      files: { '/p/a.ts': 'working' },
      readGitOriginalText: () => Promise.reject(new Error('git object missing')),
    });
    h.core.api.openWorkingDiff({ path: '/p/a.ts', ref: 'HEAD' });
    await settle();
    expect(h.errors).toEqual(['git object missing']);
    expect(h.core.tabs().filter((t) => t.kind === 'diff')).toEqual([]);
  });
});

describe('editor-host-core dirty gutter', () => {
  it('an edit marks changed lines from the SAME owner HEAD original Open Changes uses', async () => {
    const h = createHarness({
      files: { '/p/a.ts': 'one\ntwo\n' },
      gitOriginals: { '/p/a.ts': 'one\ntwo\n' },
    });
    h.setGitStatus(new Map([['/p/a.ts', ' M']]));
    h.core.api.openFile('/p/a.ts');
    mustModel(h.core, '/p/a.ts').setValue('one\nTWO\n');
    await settle();
    expect(h.gitReads).toEqual([{ path: '/p/a.ts', ref: 'HEAD' }]);
    const marks = h.surface.gutter();
    expect(marks).toHaveLength(1);
    expect(marks[0]?.range.startLineNumber).toBe(2);
    expect(marks[0]?.options.linesDecorationsClassName).toBe(
      'rf-dirty-gutter rf-dirty-gutter--modified',
    );
  });

  it('untracked (??) files mark every line added without reading a git original', async () => {
    const h = createHarness({ files: { '/p/new.ts': 'one\n' } });
    h.setGitStatus(new Map([['/p/new.ts', '??']]));
    h.core.api.openFile('/p/new.ts');
    mustModel(h.core, '/p/new.ts').setValue('one\ntwo\n');
    await settle();
    expect(h.gitReads).toEqual([]);
    expect(h.surface.gutter().map((d) => d.options.linesDecorationsClassName)).toEqual([
      'rf-dirty-gutter rf-dirty-gutter--added',
      'rf-dirty-gutter rf-dirty-gutter--added',
    ]);
  });

  it('a local edit with no git status entry still reads the HEAD original for marks', async () => {
    const h = createHarness({
      files: { '/p/a.ts': 'one\n' },
      gitOriginals: { '/p/a.ts': 'one\n' },
    });
    h.core.api.openFile('/p/a.ts');
    mustModel(h.core, '/p/a.ts').setValue('one\ntwo\n');
    await settle();
    expect(h.gitReads).toEqual([{ path: '/p/a.ts', ref: 'HEAD' }]);
    expect(h.surface.gutter().map((d) => d.options.linesDecorationsClassName)).toEqual([
      'rf-dirty-gutter rf-dirty-gutter--added',
    ]);
  });

  it('an original read failure clears the gutter — loud only when git status claimed an original', async () => {
    const failingRead = () => Promise.reject(new Error('no HEAD blob'));
    // No status entry: quiet clear (the file may simply not be in git yet).
    const quiet = createHarness({
      files: { '/p/a.ts': 'one\n' },
      readGitOriginalText: failingRead,
    });
    quiet.core.api.openFile('/p/a.ts');
    mustModel(quiet.core, '/p/a.ts').setValue('two\n');
    await settle();
    expect(quiet.surface.gutter()).toEqual([]);
    expect(quiet.errors).toEqual([]);
    // ' M' status: the owner said there IS an original — a failed read is loud.
    const loud = createHarness({ files: { '/p/a.ts': 'one\n' }, readGitOriginalText: failingRead });
    loud.setGitStatus(new Map([['/p/a.ts', ' M']]));
    loud.core.api.openFile('/p/a.ts');
    mustModel(loud.core, '/p/a.ts').setValue('two\n');
    await settle();
    expect(loud.errors).toEqual(['no HEAD blob']);
  });

  it('handleGitStatusChanged drops the cached original so a status flip recomputes marks', async () => {
    const h = createHarness({
      files: { '/p/a.ts': 'one\n' },
      gitOriginals: { '/p/a.ts': 'one\n' },
    });
    h.setGitStatus(new Map([['/p/a.ts', ' M']]));
    h.core.api.openFile('/p/a.ts');
    mustModel(h.core, '/p/a.ts').setValue('one\ntwo\n');
    await settle();
    expect(h.gitReads).toHaveLength(1);
    h.setGitStatus(new Map([['/p/a.ts', 'MM']]));
    h.core.handleGitStatusChanged();
    await settle();
    expect(h.gitReads).toHaveLength(2); // cache dropped — a fresh owner read, not a stale replay
    expect(h.surface.gutter().map((d) => d.options.linesDecorationsClassName)).toEqual([
      'rf-dirty-gutter rf-dirty-gutter--added',
    ]);
  });
});

describe('editor-host-core debounced owner writes', () => {
  it('debounced edits publish once to the owner after 300ms of quiet (last value wins)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = createHarness({ files: { '/p/a.ts': 'v0' } });
    h.core.api.openFile('/p/a.ts');
    const model = mustModel(h.core, '/p/a.ts');
    model.setValue('v1');
    await vi.advanceTimersByTimeAsync(200);
    model.setValue('v2'); // restarts the debounce window
    await vi.advanceTimersByTimeAsync(299);
    expect(h.written).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.written).toEqual([{ path: '/p/a.ts', content: 'v2' }]);
  });

  it('flushPendingWrites publishes the pending debounced edit immediately and clears the dirty dot', async () => {
    const h = createHarness({ files: { '/p/a.ts': 'v0' } });
    h.core.api.openFile('/p/a.ts');
    mustModel(h.core, '/p/a.ts').setValue('v1');
    expect(h.core.tabs().find((t) => t.id === '/p/a.ts')?.dirty).toBe(true);
    await h.core.api.flushPendingWrites();
    expect(h.written).toEqual([{ path: '/p/a.ts', content: 'v1' }]);
    expect(h.core.tabs().find((t) => t.id === '/p/a.ts')?.dirty).toBe(false);
  });

  it('flushPendingWrites drains a write scheduled while an in-flight publish is running', async () => {
    const firstWrite = deferred<void>();
    let firstCall = true;
    const h = createHarness({
      files: { '/p/a.ts': 'v0' },
      onFileWritten: () => {
        if (!firstCall) return undefined;
        firstCall = false;
        return firstWrite.promise;
      },
    });
    h.core.api.openFile('/p/a.ts');
    const model = mustModel(h.core, '/p/a.ts');
    model.setValue('v1');
    let contentsAtResolve: string[] | undefined;
    const flush = h.core.api.flushPendingWrites().then(() => {
      contentsAtResolve = h.written.map((w) => w.content);
    });
    await settle();
    expect(h.written).toEqual([{ path: '/p/a.ts', content: 'v1' }]); // in flight, unresolved
    model.setValue('v2'); // re-dirties while the first publish is still in flight
    firstWrite.resolve();
    await flush;
    expect(contentsAtResolve).toEqual(['v1', 'v2']); // drained BEFORE the flush resolved
  });

  it('a failing owner publish surfaces through onError (debounce path stays loud)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = createHarness({
      files: { '/p/a.ts': 'v0' },
      onFileWritten: () => Promise.reject(new Error('owner store rejected the write')),
    });
    h.core.api.openFile('/p/a.ts');
    mustModel(h.core, '/p/a.ts').setValue('v1');
    await vi.advanceTimersByTimeAsync(300);
    expect(h.errors).toContain('owner store rejected the write');
  });

  it('retries a dirty generation whose debounced owner publish failed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let attempt = 0;
    const h = createHarness({
      files: { '/p/a.ts': 'v0' },
      onFileWritten: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('first owner publish failed');
      },
    });
    h.core.api.openFile('/p/a.ts');
    mustModel(h.core, '/p/a.ts').setValue('v1');

    await vi.advanceTimersByTimeAsync(300);
    expect(h.errors).toContain('first owner publish failed');
    expect(h.core.tabs().find((tab) => tab.id === '/p/a.ts')?.dirty).toBe(true);

    await h.core.api.flushPendingWrites();
    expect(h.written).toEqual([
      { path: '/p/a.ts', content: 'v1' },
      { path: '/p/a.ts', content: 'v1' },
    ]);
    expect(h.core.tabs().find((tab) => tab.id === '/p/a.ts')?.dirty).toBe(false);
  });

  // Fault classes: concurrent-same-key + provenance-lie. Completion owns the
  // admitted model generation, never whichever text happens to be current later.
  it('keeps v2 dirty when v1 settles, then retries v2 after its first publish fails', async () => {
    const v1 = deferred<void>();
    const firstV2 = deferred<void>();
    let v2Attempts = 0;
    const h = createHarness({
      files: { '/p/a.ts': 'v0' },
      onFileWritten: (_path, content) => {
        if (content === 'v1') return v1.promise;
        v2Attempts += 1;
        return v2Attempts === 1 ? firstV2.promise : undefined;
      },
    });
    h.core.api.openFile('/p/a.ts');
    const model = mustModel(h.core, '/p/a.ts');
    model.setValue('v1');
    const firstFlush = h.core.api.flushPendingWrites().then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );
    await vi.waitFor(() => expect(h.written).toEqual([{ path: '/p/a.ts', content: 'v1' }]));

    model.setValue('v2');
    v1.resolve();
    await vi.waitFor(() =>
      expect(h.written).toEqual([
        { path: '/p/a.ts', content: 'v1' },
        { path: '/p/a.ts', content: 'v2' },
      ]),
    );
    expect(h.core.tabs().find((tab) => tab.id === '/p/a.ts')?.dirty).toBe(true);

    firstV2.reject(new Error('v2 owner publish failed'));
    const outcome = await firstFlush;
    expect(outcome).toMatchObject({
      status: 'rejected',
      error: expect.objectContaining({ message: 'v2 owner publish failed' }),
    });
    expect(h.core.tabs().find((tab) => tab.id === '/p/a.ts')?.dirty).toBe(true);

    await h.core.api.flushPendingWrites();
    expect(h.written.map(({ content }) => content)).toEqual(['v1', 'v2', 'v2']);
    expect(h.core.tabs().find((tab) => tab.id === '/p/a.ts')?.dirty).toBe(false);
  });

  it('never retries read-only or externally closed models', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const editable = createHarness({
      files: { '/p/a.ts': 'v0' },
      onFileWritten: async () => {
        throw new Error('owner publish failed before close');
      },
    });
    editable.core.api.openFile('/p/a.ts');
    mustModel(editable.core, '/p/a.ts').setValue('v1');
    await vi.advanceTimersByTimeAsync(300);
    editable.core.api.closePath('/p/a.ts');
    await editable.core.api.flushPendingWrites();
    expect(editable.written).toEqual([{ path: '/p/a.ts', content: 'v1' }]);

    const readOnly = createHarness({
      readNodeModulesFile: () => Promise.resolve({ size: 3, content: enc.encode('lib') }),
    });
    readOnly.core.api.openFile('/p/node_modules/pkg/index.js');
    await settle();
    mustModel(readOnly.core, '/p/node_modules/pkg/index.js').setValue('programmatic change');
    await readOnly.core.api.flushPendingWrites();
    expect(readOnly.written).toEqual([]);
  });
});

describe('editor-host-core close hooks (owner rename/delete lifecycles)', () => {
  it('closePath closes without publishing the pending edit — an owner delete must not resurrect the file', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = createHarness({ files: { '/p/src/a.ts': 'v0' } });
    h.core.api.openFile('/p/src/a.ts');
    const events: EditorDocumentEvent[] = [];
    h.core.api.onDocument((ev) => void events.push(ev));
    mustModel(h.core, '/p/src/a.ts').setValue('v1'); // pending debounced write
    h.core.api.closePath('/p/src/a.ts');
    expect(h.core.modelForPath('/p/src/a.ts')).toBeUndefined();
    expect(h.core.tabs()).toEqual([]);
    expect(events.at(-1)).toEqual({ path: '/p/src/a.ts', text: '', kind: 'close' });
    await vi.advanceTimersByTimeAsync(1000); // outlive the debounce window
    expect(h.written).toEqual([]);
  });

  it('closePathTree closes the subtree (trailing slash tolerated) but not a sibling prefix path', () => {
    const h = createHarness({
      files: { '/p/src/a.ts': 'a', '/p/src/deep/b.ts': 'b', '/p/srcfoo.ts': 'c' },
    });
    h.core.api.openFile('/p/src/a.ts');
    h.core.api.openFile('/p/src/deep/b.ts');
    h.core.api.openFile('/p/srcfoo.ts');
    h.core.api.closePathTree('/p/src/');
    expect(h.core.tabs().map((t) => t.id)).toEqual(['/p/srcfoo.ts']);
    expect(h.core.modelForPath('/p/src/deep/b.ts')).toBeUndefined();
    expect(h.core.modelForPath('/p/srcfoo.ts')).toBeDefined();
  });

  it('treats / as the whole open editor tree', () => {
    const h = createHarness({
      files: { '/p/src/a.ts': 'a', '/p/other.ts': 'b' },
    });
    h.core.api.openFile('/p/src/a.ts');
    h.core.api.openFile('/p/other.ts');

    expect([...h.core.api.openPathsUnder('/')].sort()).toEqual(['/p/other.ts', '/p/src/a.ts']);
    h.core.api.closePathTree('/');

    expect(h.core.tabs()).toEqual([]);
    expect(h.core.modelForPath('/p/src/a.ts')).toBeUndefined();
    expect(h.core.modelForPath('/p/other.ts')).toBeUndefined();
  });

  it('closing the working file tears down its live-model git diff but keeps blob compares', async () => {
    const h = createHarness({
      files: { '/p/a.ts': 'working' },
      gitOriginals: { '/p/a.ts': 'orig' },
    });
    h.core.api.openWorkingDiff({ path: '/p/a.ts', ref: 'HEAD' });
    await settle();
    h.core.api.openTextDiff({
      id: 'cmp-1',
      path: '/p/a.ts',
      title: 'a.ts: v1 ↔ v2',
      originalTitle: 'v1',
      modifiedTitle: 'v2',
      original: 'one',
      modified: 'two',
    });
    expect(h.core.tabs().filter((t) => t.kind === 'diff')).toHaveLength(2);
    h.core.closeFile('/p/a.ts');
    const ids = h.core.tabs().map((t) => t.id);
    expect(ids).toContain('cmp-1'); // snapshot compare owns its models — survives
    expect(ids).not.toContain('diff:HEAD:/p/a.ts'); // live-model diff dies with its file
    expect(ids).not.toContain('/p/a.ts');
  });

  it('closePath cancels a pending diff open — a late owner read cannot resurrect the tab', async () => {
    const original = deferred<string>();
    const h = createHarness({
      files: { '/p/a.ts': 'working' },
      readGitOriginalText: () => original.promise,
    });
    h.core.api.openWorkingDiff({ path: '/p/a.ts', ref: 'HEAD' });
    h.core.api.closePath('/p/a.ts');
    original.resolve('orig');
    await settle();
    expect(h.core.tabs()).toEqual([]);
  });

  it('openPathsUnder lists open file tabs at or under a file or directory path', () => {
    const h = createHarness({
      files: { '/p/src/a.ts': 'a', '/p/src/deep/b.ts': 'b', '/p/other.ts': 'c' },
    });
    h.core.api.openFile('/p/src/a.ts');
    h.core.api.openFile('/p/src/deep/b.ts');
    h.core.api.openFile('/p/other.ts');
    expect([...h.core.api.openPathsUnder('/p/src')].sort()).toEqual([
      '/p/src/a.ts',
      '/p/src/deep/b.ts',
    ]);
    expect(h.core.api.openPathsUnder('/p/src/a.ts')).toEqual(['/p/src/a.ts']);
  });
});

describe('editor-host-core blob compare (openTextDiff)', () => {
  it('openTextDiff opens an activated blob-vs-blob compare with caller titles and compare schemes', () => {
    const h = createHarness({});
    h.core.api.openTextDiff({
      id: 'cmp-1',
      path: '/p/a.ts',
      title: 'a.ts: v1 ↔ v2',
      originalTitle: 'v1',
      modifiedTitle: 'v2',
      original: 'one\n',
      modified: 'two\n',
    });
    expect(h.core.tabs()).toEqual([
      {
        id: 'cmp-1',
        kind: 'diff',
        path: '/p/a.ts',
        title: 'a.ts: v1 ↔ v2',
        originalTitle: 'v1',
        modifiedTitle: 'v2',
        dirty: false,
      },
    ]);
    expect(h.core.activeId()).toBe('cmp-1');
    expect(h.core.activeTabKind()).toBe('diff');
    h.core.syncActiveEditor();
    const pair = h.surface.diffModel();
    expect(pair?.original.getValue()).toBe('one\n');
    expect(pair?.modified.getValue()).toBe('two\n');
    expect(pair?.original.uri.scheme).toBe('rifty-compare-original');
    expect(pair?.modified.uri.scheme).toBe('rifty-compare-modified');
    expect(pair?.original.uri.query).toBe('id=cmp-1');
    expect(h.surface.diffEditorOptions().readOnly).toBe(true);
  });

  it('re-opening the same compare id replaces the models and disposes the stale pair (single tab)', () => {
    const h = createHarness({});
    const open = (original: string, modified: string) =>
      h.core.api.openTextDiff({
        id: 'cmp-1',
        path: '/p/a.ts',
        title: 't',
        originalTitle: 'o',
        modifiedTitle: 'm',
        original,
        modified,
      });
    open('one', 'two');
    h.core.syncActiveEditor();
    const stale = h.surface.diffModel();
    open('three', 'four');
    h.core.syncActiveEditor();
    expect(h.core.tabs().filter((t) => t.kind === 'diff')).toHaveLength(1);
    expect(h.surface.diffModel()?.original.getValue()).toBe('three');
    expect(h.surface.diffModel()?.modified.getValue()).toBe('four');
    expect(stale?.original.isDisposed()).toBe(true);
    expect(stale?.modified.isDisposed()).toBe(true);
  });
});

describe('editor-host-core root switch', () => {
  it('the first handleRootChanged run is the mount baseline — it tears nothing down', async () => {
    const h = createHarness({
      files: { '/p/a.ts': 'working' },
      gitOriginals: { '/p/a.ts': 'orig' },
    });
    h.core.api.openWorkingDiff({ path: '/p/a.ts', ref: 'HEAD' });
    await settle();
    h.core.handleRootChanged(); // mount-effect run — must only record the baseline
    expect(h.core.tabs().some((t) => t.kind === 'diff')).toBe(true);
  });

  it('switching the project root tears down git diff tabs and cancels pending opens', async () => {
    const pendingOriginal = deferred<string>();
    const h = createHarness({
      files: { '/p/a.ts': 'working a', '/p/b.ts': 'working b' },
      readGitOriginalText: (input) =>
        input.path === '/p/b.ts' ? pendingOriginal.promise : Promise.resolve('orig a'),
    });
    h.core.handleRootChanged(); // baseline
    h.core.api.openWorkingDiff({ path: '/p/a.ts', ref: 'HEAD' });
    await settle(); // landed
    h.core.syncActiveEditor();
    h.core.api.openWorkingDiff({ path: '/p/b.ts', ref: 'HEAD' }); // still pending
    h.core.handleRootChanged(); // same root — must be a no-op
    expect(h.core.tabs().some((t) => t.kind === 'diff')).toBe(true);
    h.setRoot('/q');
    h.core.handleRootChanged();
    expect(h.core.tabs().some((t) => t.kind === 'diff')).toBe(false);
    expect(h.surface.diffModel()).toBeNull(); // widget detached from the dead models
    expect(h.core.activeId()).toBe('/p/a.ts'); // active falls off the dead diff tab
    pendingOriginal.resolve('late'); // the cancelled open must not resurrect a tab
    await settle();
    expect(h.core.tabs().some((t) => t.kind === 'diff')).toBe(false);
  });
});

describe('editor-host-core session guards', () => {
  it('closeActiveTab returns false when no editor tab is active', () => {
    const h = createHarness({});
    expect(h.core.api.closeActiveTab()).toBe(false);
  });

  it('closeActiveTab closes the active tab, flushes its pending edit, and empties the editor', async () => {
    const h = createHarness({ files: { '/p/a.ts': 'v0' } });
    h.core.api.openFile('/p/a.ts');
    mustModel(h.core, '/p/a.ts').setValue('v1');
    expect(h.core.api.closeActiveTab()).toBe(true);
    expect(h.core.tabs()).toEqual([]);
    await settle();
    expect(h.written).toEqual([{ path: '/p/a.ts', content: 'v1' }]); // Cmd+W must not lose the edit
    h.core.syncActiveEditor();
    expect(h.surface.editorModel()).toBeNull();
    expect(h.active.at(-1)).toEqual({ label: '', language: 'plaintext' });
  });
});

describe('editor-host-core LS bridge API', () => {
  it('setMarkers owns the rifty-ts marker channel for a path model; unknown paths are a no-op', () => {
    const h = createHarness({ files: { '/p/a.ts': 'x' } });
    h.core.api.openFile('/p/a.ts');
    const marker: monaco.editor.IMarkerData = {
      severity: 8 as monaco.MarkerSeverity,
      message: 'boom',
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 2,
    };
    h.core.api.setMarkers('/p/a.ts', [marker]);
    const model = mustModel(h.core, '/p/a.ts');
    expect(monaco.editor.getModelMarkers({ resource: model.uri, owner: 'rifty-ts' })).toHaveLength(
      1,
    );
    h.core.api.setMarkers('/p/unknown.ts', [marker]); // no model → no-op, no throw
    expect(monaco.editor.getModelMarkers({ owner: 'rifty-ts' })).toHaveLength(1);
    h.core.api.setMarkers('/p/a.ts', []); // replace semantics clear the channel
    expect(monaco.editor.getModelMarkers({ owner: 'rifty-ts' })).toHaveLength(0);
  });

  it('onDocument replays already-open buffers to a late subscriber, streams change/close, and unsubscribes', () => {
    const h = createHarness({ files: { '/p/a.ts': 'aaa', '/p/b.ts': 'bbb' } });
    h.core.api.openFile('/p/a.ts');
    h.core.api.openFile('/p/b.ts');
    const events: EditorDocumentEvent[] = [];
    const unsubscribe = h.core.api.onDocument((ev) => void events.push(ev));
    expect(events).toEqual([
      { path: '/p/a.ts', text: 'aaa', kind: 'open' },
      { path: '/p/b.ts', text: 'bbb', kind: 'open' },
    ]);
    mustModel(h.core, '/p/a.ts').setValue('aaa2');
    expect(events.at(-1)).toEqual({ path: '/p/a.ts', text: 'aaa2', kind: 'change' });
    h.core.closeFile('/p/b.ts');
    expect(events.at(-1)).toEqual({ path: '/p/b.ts', text: '', kind: 'close' });
    unsubscribe();
    mustModel(h.core, '/p/a.ts').setValue('aaa3');
    expect(events.at(-1)).toEqual({ path: '/p/b.ts', text: '', kind: 'close' }); // no new events
  });

  it('pathForModel resolves our models to VFS paths and rejects foreign models', () => {
    const h = createHarness({ files: { '/p/a.ts': 'x' } });
    h.core.api.openFile('/p/a.ts');
    expect(h.core.api.pathForModel(mustModel(h.core, '/p/a.ts'))).toBe('/p/a.ts');
    const foreign = monaco.editor.createModel('alien', 'plaintext');
    expect(h.core.api.pathForModel(foreign)).toBeUndefined();
  });

  it('ensureModel opens a go-to-def target without activating its tab; unreachable targets return undefined', () => {
    const h = createHarness({ files: { '/p/a.ts': 'x', '/p/src/lib.ts': 'lib' } });
    h.core.api.openFile('/p/a.ts');
    const uri = h.core.api.ensureModel('/p/src/lib.ts');
    expect(uri).toBe(mustModel(h.core, '/p/src/lib.ts').uri);
    expect(h.core.activeId()).toBe('/p/a.ts'); // the target the user didn't pick stays inactive
    expect(h.core.tabs().map((t) => t.id)).toContain('/p/src/lib.ts');
    expect(h.core.api.ensureModel('/p/a.ts')).toBe(mustModel(h.core, '/p/a.ts').uri);
    // A racing seed can't produce a model this tick — undefined, never a fake.
    expect(h.core.api.ensureModel('/p/still-racing.ts')).toBeUndefined();
  });

  it('ensureModel isNewFile creates an empty editable model without stealing activation', () => {
    const h = createHarness({ files: { '/p/a.ts': 'x' } });
    h.core.api.openFile('/p/a.ts');
    const uri = h.core.api.ensureModel('/p/new.ts', { isNewFile: true });
    expect(uri).toBeDefined();
    expect(mustModel(h.core, '/p/new.ts').getValue()).toBe('');
    expect(h.core.activeId()).toBe('/p/a.ts');
    mustModel(h.core, '/p/new.ts').setValue('workspace-edit text'); // editable: edits track dirty
    expect(h.core.tabs().find((t) => t.id === '/p/new.ts')?.dirty).toBe(true);
  });

  it('canEnsureModel dry-runs reachability without opening tabs or models', () => {
    const h = createHarness({
      files: { '/p/a.ts': 'x' },
      readNodeModulesFile: () => Promise.resolve({ size: 1, content: new Uint8Array([65]) }),
    });
    expect(h.core.api.canEnsureModel('/p/a.ts')).toBe(true); // snapshot-readable
    expect(h.core.api.canEnsureModel('/p/node_modules/pkg/index.d.ts')).toBe(true); // read-port
    expect(h.core.api.canEnsureModel('/p/racing.ts')).toBe(false); // no bytes anywhere yet
    expect(h.core.api.canEnsureModel('/p/racing.ts', { isNewFile: true })).toBe(true);
    expect(h.core.tabs()).toEqual([]); // dry-run: no editor-visible side effects
    expect(h.core.modelForPath('/p/a.ts')).toBeUndefined();
  });
});
