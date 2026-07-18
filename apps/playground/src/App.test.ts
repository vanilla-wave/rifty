import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BootResult } from './boot.ts';
import { saveAffordance, storageModeFromBoot } from './glue/degraded-storage.ts';

// The browser UI transitively imports xterm and cannot run in node vitest.
// Keep only client-only JSX/composition pins here. Semantic behavior belongs
// to adapters/*.contract.test.ts and browser e2e.
const entrySource = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const appSource = readFileSync(
  fileURLToPath(new URL('./adapters/playground-app.tsx', import.meta.url)),
  'utf8',
);
const streamsCompatSrc = readFileSync(
  fileURLToPath(new URL('../../../docs/public/compat/streams.md', import.meta.url)),
  'utf8',
);
const httpCompatSrc = readFileSync(
  fileURLToPath(new URL('../../../docs/public/compat/http.md', import.meta.url)),
  'utf8',
);
const streamInteropAdrSrc = readFileSync(
  fileURLToPath(
    new URL(
      '../../../docs/adr/net/0154-http-stream-interop-and-drain-contract.md',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('App semantic companion boundary', () => {
  it('re-exports the semantic App entry and consumes one already-admitted companion', () => {
    expect(entrySource).toContain("export { App } from './adapters/playground-app.tsx'");
    expect(appSource).toMatch(
      /readonly workbench: PlaygroundWorkbench;[\s\S]*runtime = createPlaygroundAppRuntime\(props\.workbench, \{/,
    );
    expect(appSource).not.toContain('openPlaygroundAppWorkbench');
    expect(appSource).toMatch(
      /closeAfterFailure\('Playground App initialization',[\s\S]*await runtime\?\.close\(\)/,
    );
  });

  it('owns no worker, VFS, catalog, Git, or TypeScript transport', () => {
    for (const retired of [
      'startWorkspaceOwner',
      'WorkspaceOwnerHandle',
      'OwnerRpcFs',
      'SnapshotFs',
      'bridgeGitOwnerRpc',
      'bridgeProjectIndex',
      'createTsLanguageServiceClient',
      'createWorkspaceLifecycle',
      'createProjectIndexBoot',
    ]) {
      expect(appSource, retired).not.toContain(retired);
    }
  });
});

describe('App client-only semantic bindings', () => {
  it('keeps Monaco lazy until a project session is bound', () => {
    expect(appSource).toContain('const EditorHost = lazy(() =>');
    expect(appSource).toContain('function warmEditorStack(): void');
    expect(appSource).toContain(
      'const mirror = createPlaygroundProjectMirror(context.session.files)',
    );
  });

  it('routes editor documents and explorer mutations through the active session', () => {
    expect(appSource).toContain(
      'const documents = createPlaygroundDocumentWriter(context.session.documents)',
    );
    expect(appSource).toContain('const mutations = createPlaygroundFileMutations(');
    expect(appSource).toContain('return project.documents.write(path, content)');
    expect(appSource).toContain('root="/"');
    expect(appSource).toContain("root={() => '/'}");
  });

  it('binds diagnostics and providers to the active session TypeScript tool', () => {
    expect(appSource).toContain('client: project.context.tools.typescript');
  });

  it('binds SCM to the active session and disposes its subscription', () => {
    expect(appSource).toContain('context.tools.scm.subscribe(setScmSnapshot)');
    expect(appSource).toContain('project.unsubscribeScm()');
    expect(appSource).toContain('project.context.tools.scm.diff(change)');
  });

  it('routes archive through the active session', () => {
    expect(appSource).toContain('project.context.tools.archive.export()');
    expect(appSource).toContain('project.context.tools.archive.import(json)');
  });

  it('routes terminal operations and rejected commands through the semantic terminal adapter', () => {
    expect(appSource).toContain('createPlaygroundTerminalUi(context.session)');
    expect(appSource).toContain('project.terminal.runLine(id, line, dims)');
    expect(appSource).toContain(
      'onRawInput={(id, data) => void bound()?.terminal.write(id, data)}',
    );
    expect(appSource).toContain(
      'onResize={(id, dims) => void bound()?.terminal.resize(id, dims.cols, dims.rows)}',
    );
    expect(appSource).toContain("terminalWriters.get(id)?.(`${errorMessage(error)}\\n`, 'stderr')");
  });

  it('subscribes to semantic previews and opens their routed URL in an opener-owned iframe', () => {
    expect(appSource).toContain("globalThis.window?.open('', '_blank')");
    expect(appSource).toContain('<iframe src="${');
    expect(appSource).toContain('context.tools.previews.subscribe(setPreviewPorts)');
    expect(appSource).not.toContain('refreshKey=');
  });
});

describe('App user-visible safety and honesty', () => {
  it('wires Export to the real archive and describes Share as link-only', () => {
    expect(appSource).toContain('onExport={() => void exportArchive()}');
    expect(appSource).toContain("'Link copied — opens this playground'");
  });

  it('closes only the active editor tab on Cmd/Ctrl+W', () => {
    expect(appSource).toContain('editorApi?.closeActiveTab()');
  });

  it('prompts before unload for unproved durability or dirty memory-backed state', () => {
    expect(appSource).toContain(
      "if (healthUi.persistenceAtRisk() || (storageMode() === 'memory' && store.dirty()))",
    );
    expect(appSource).toContain(
      "globalThis.window?.addEventListener('beforeunload', onBeforeUnload)",
    );
  });

  it('labels the empty and Scratch states honestly', () => {
    expect(appSource).toContain('scratchDisplayName(activeGlyph().label)');
    expect(appSource).toContain("return 'Choose project'");
    expect(appSource).not.toContain("'Untitled scratch'");
  });
});

describe('stream compat docs', () => {
  it('claims Readable.toWeb and the Writable/Duplex WHATWG bridge', () => {
    expect(streamsCompatSrc).toContain('| `Readable.toWeb` | ✅ |');
    expect(streamsCompatSrc).toContain('`Writable.toWeb`');
    expect(streamsCompatSrc).toContain('`Duplex.toWeb`');
    expect(streamsCompatSrc).not.toContain('| `Writable.toWeb` | ❌ |');
    expect(streamsCompatSrc).not.toContain('| `Readable.toWeb` / `Writable.toWeb` | ❌ |');
    expect(streamInteropAdrSrc).toContain('Correction 2026-06-29');
    expect(streamInteropAdrSrc).toContain('Readable.toWeb()');
  });
});

describe('http compat docs', () => {
  it('caveats rawHeaders as fetch-normalized rather than Node-raw', () => {
    expect(httpCompatSrc).toContain('| Request headers / `rawHeaders` | ⚠️ |');
    expect(httpCompatSrc).toContain('derived from Fetch-normalized headers');
    expect(httpCompatSrc).toContain('raw casing/order/duplicates are not claimed');
  });
});

describe('App degraded path wiring', () => {
  const memoryBoot: BootResult = {
    vfsBoot: { backend: 'memory' },
    storage: { available: false },
  } as BootResult;
  const opfsBoot: BootResult = {
    vfsBoot: { backend: 'opfs' },
    storage: { available: true, persistedBefore: true, persistedAfter: true },
  } as BootResult;

  it('derives memory/opfs mode from the real boot backend', () => {
    expect(storageModeFromBoot(memoryBoot)).toBe('memory');
    expect(storageModeFromBoot(opfsBoot)).toBe('opfs');
  });

  it('gates DegradedBanner and StatusBar from one storage mode', () => {
    expect(appSource).toContain('const initialStorageMode = storageModeFromBoot(props.boot)');
    expect(appSource).toContain('degradedBannerVisible({');
    expect(appSource).toContain('storageMode={storageMode()}');
  });

  it('reports memory saves as EPHEMERAL and binds the same affordance in App', () => {
    expect(saveAffordance(storageModeFromBoot(memoryBoot)).label).toBe('EPHEMERAL');
    expect(saveAffordance(storageModeFromBoot(memoryBoot)).ephemeral).toBe(true);
    expect(saveAffordance(storageModeFromBoot(memoryBoot)).label).not.toBe('Saved');
    expect(appSource).toContain('saveAffordance(storageMode())');
  });
});
