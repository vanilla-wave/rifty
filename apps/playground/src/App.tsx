import { RegistryClient } from '@riftydev/npm-client';
import { detectCapabilities } from '@riftydev/runtime-js/env/capabilities';
import { syncMirror } from '@riftydev/vfs';
import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { useShellSession } from './adapters/shell-adapter.ts';
import { useLayout } from './adapters/useLayout.ts';
import { useMode } from './adapters/useMode.ts';
import { useRuntime } from './adapters/useRuntime.ts';
import { type BootResult, isCrossOriginIsolated, swErrorBannerMessage } from './boot.ts';
import { ActivityBar } from './components/ActivityBar.tsx';
import { BottomPanel } from './components/BottomPanel.tsx';
import { CapabilitiesPanel } from './components/CapabilitiesPanel.tsx';
import { type EditorApi, EditorHost, PROGRAM_MIRROR_PATH } from './components/EditorHost.tsx';
import { FileExplorer } from './components/FileExplorer.tsx';
import { PresetGallery } from './components/PresetGallery.tsx';
import { PreviewPanel } from './components/PreviewPanel.tsx';
import { Splitter } from './components/Splitter.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { writeText } from './glue/fs-ops.ts';
import { createNpmShellCommand } from './glue/npm-shell-command.ts';
import { proxiedRegistryFetch } from './glue/registry-fetch.ts';
import { SyncMirrorVfs } from './glue/sync-mirror-vfs.ts';
import { DEFAULT_PRESET, type Preset } from './presets.ts';

const WORKSPACE = '/workspace';

export interface AppProps {
  /**
   * Single bundle from `bootstrapPlayground()`. Carries the VFS backend
   * descriptor (ADR-0013) plus an optional SW-registration error captured by
   * the bootstrap pipeline. App never re-registers the SW itself.
   */
  readonly boot: BootResult;
}

export function App(props: AppProps) {
  const capabilities = detectCapabilities();
  const [swBannerDismissed, setSwBannerDismissed] = createSignal(false);
  const [activePreset, setActivePreset] = createSignal(DEFAULT_PRESET.id);
  const [activeFile, setActiveFile] = createSignal('main.js');
  const [activeFilePath, setActiveFilePath] = createSignal<string | undefined>(undefined);
  const [activeLang, setActiveLang] = createSignal('javascript');
  const [toast, setToast] = createSignal<string | null>(null);

  const layout = useLayout();
  const runtime = useRuntime();
  // Main-thread sync VFS mirror — the same store the shell + `npm install`
  // write to, so the file explorer is honest (ADR-0075). Captured once: the
  // active mirror is stable after `initBackend()` ran during bootstrap.
  const vfs = syncMirror();

  let editorApi: EditorApi | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function flashError(message: string): void {
    setToast(message);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(null), 3800);
  }

  // Long-lived shell session — drives the terminal in `dev` / `real-vite`
  // modes so users can `npm install`, `vite dev`, file ops, etc.
  const shell = useShellSession({ cwd: WORKSPACE });
  shell.registerCommand(
    'npm',
    createNpmShellCommand({
      vfs: new SyncMirrorVfs(),
      registry: new RegistryClient({ fetch: proxiedRegistryFetch() }),
    }),
  );

  // Mode state machine — owns `repl | dev | real-vite`, the inner dev /
  // real-vite handles, and the editor's program source.
  const machine = useMode({
    sources: { repl: DEFAULT_PRESET.source, dev: DEFAULT_PRESET.source },
    log: (chunk, stream) => runtime.write(chunk, stream),
  });

  if (props.boot.swError) {
    runtime.write(`SW registration failed: ${props.boot.swError}\n`, 'stderr');
  }

  onMount(() => {
    // Seed the workspace so the explorer is immediately useful (idempotent).
    try {
      if (!vfs.existsSync(PROGRAM_MIRROR_PATH))
        writeText(vfs, PROGRAM_MIRROR_PATH, DEFAULT_PRESET.source);
      if (!vfs.existsSync(`${WORKSPACE}/README.md`)) {
        writeText(
          vfs,
          `${WORKSPACE}/README.md`,
          '# workspace\n\nThis is the in-browser virtual filesystem.\n\n- Edit the program in the `main.js` tab (it drives Run / the live preview).\n- Create files here, or run `npm install <pkg>` in the console — installs land in `node_modules`.\n',
        );
      }
    } catch {
      /* best-effort seeding */
    }
  });

  onCleanup(() => {
    if (toastTimer) clearTimeout(toastTimer);
    runtime.dispose();
    shell.dispose();
  });

  async function runRepl(source: string, label: string): Promise<void> {
    await runtime.whenReady();
    runtime.write(`\n> [${label}] ${new Date().toLocaleTimeString()}\n`);
    try {
      await runtime.evaluate(source);
    } catch (err) {
      runtime.write(`${(err as Error).message}\n`, 'stderr');
    }
  }

  function onRun(): void {
    void runRepl(machine.source(), 'Run');
  }

  function onReset(): void {
    runtime.write('\n[worker reset]\n', 'stderr');
    void runtime.reset();
  }

  function onSelectPreset(preset: Preset): void {
    setActivePreset(preset.id);
    void machine.loadPreset(preset);
    if (preset.mode === 'repl') void runRepl(preset.source, preset.label);
  }

  const modeLabel = (): string =>
    machine.mode() === 'dev'
      ? 'Dev · port 3000'
      : machine.mode() === 'real-vite'
        ? `Real Vite · port ${machine.realVitePort()}`
        : 'REPL · Worker';

  const programTitle = (): string => (machine.mode() === 'repl' ? 'main.js' : 'src/main.js');
  const hasPreview = (): boolean => machine.mode() === 'dev' || machine.mode() === 'real-vite';
  const isOpfs = props.boot.vfsBoot.backend === 'opfs';

  return (
    <div class="rf-app rf-grain">
      <Show when={props.boot.swError && !swBannerDismissed()}>
        <div class="rf-banner" role="alert" data-banner="sw-error">
          <span class="rf-banner__msg">{swErrorBannerMessage(props.boot.swError ?? '')}</span>
          <button
            type="button"
            class="rf-btn rf-btn--ghost"
            onClick={() => setSwBannerDismissed(true)}
            data-action="dismiss-sw-banner"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      </Show>

      <header class="rf-header">
        <span class="rf-brand">
          <span class="rf-brand__mark" aria-hidden="true" />
          <strong class="rf-wordmark">rifty</strong>
        </span>

        <span class="rf-modechip" data-mode={machine.mode()}>
          <span class="rf-modechip__dot" />
          {modeLabel()}
        </span>

        <span class="rf-spacer" />

        <div class="rf-seg">
          <button
            type="button"
            class="rf-btn"
            data-kind="real-vite"
            data-active={machine.mode() === 'real-vite'}
            onClick={() => {
              setActivePreset('');
              void machine.toggleRealVite();
            }}
            data-action="real-vite"
          >
            Real Vite
          </button>
          <button
            type="button"
            class="rf-btn"
            data-active={machine.mode() === 'dev'}
            onClick={() => {
              setActivePreset('');
              void machine.toggleDev();
            }}
            data-action="dev-mode"
          >
            Dev Mode
          </button>
        </div>

        <Show when={machine.mode() === 'repl'}>
          <button type="button" class="rf-btn rf-btn--primary" onClick={onRun} data-action="run">
            ▶ Run
          </button>
          <button type="button" class="rf-btn rf-btn--ghost" onClick={onReset} data-action="reset">
            Reset
          </button>
        </Show>
      </header>

      <Show when={capabilities.sufficient} fallback={<CapabilitiesPanel check={capabilities} />}>
        <div
          class="rf-shell"
          data-sidebar={layout.sidebarCollapsed() ? 'collapsed' : 'open'}
          style={{
            '--rf-sidebar-w': `${layout.sidebarW()}px`,
            '--rf-console-h': `${layout.consoleH()}px`,
            '--rf-preview-w': `${layout.previewW()}px`,
          }}
        >
          <ActivityBar
            view={layout.view()}
            collapsed={layout.sidebarCollapsed()}
            onSelect={(v) => layout.selectView(v)}
          />

          <aside class="rf-sidebar">
            <Show when={layout.view() === 'explorer'}>
              <FileExplorer
                vfs={vfs}
                root={WORKSPACE}
                visible={layout.view() === 'explorer' && !layout.sidebarCollapsed()}
                activePath={activeFilePath()}
                onOpenFile={(path) => editorApi?.openFile(path)}
                onError={flashError}
              />
            </Show>
            <Show when={layout.view() === 'presets'}>
              <PresetGallery activeId={activePreset()} onSelect={onSelectPreset} />
            </Show>
          </aside>

          <Splitter
            orientation="vertical"
            value={layout.sidebarW()}
            min={layout.bounds.sidebarW[0]}
            max={layout.bounds.sidebarW[1]}
            defaultValue={264}
            dir={1}
            ariaLabel="Resize sidebar"
            onInput={(px) => layout.setSidebarW(px)}
            onCommit={() => layout.persist()}
            onReset={() => layout.resetSidebarW()}
          />

          <main class="rf-main" data-console={layout.consoleCollapsed() ? 'collapsed' : 'open'}>
            <div class="rf-editorarea" data-preview={hasPreview() ? 'on' : 'off'}>
              <EditorHost
                programValue={machine.source}
                programTitle={programTitle}
                onProgramChange={(v) => machine.setSource(v)}
                vfs={vfs}
                registerApi={(api) => {
                  editorApi = api;
                }}
                onActive={(info) => {
                  setActiveFile(info.label);
                  setActiveLang(info.language);
                  setActiveFilePath(info.path);
                }}
                onFileWritten={() => {
                  /* explorer polls; nothing else needed */
                }}
                onError={flashError}
              />

              <Show when={hasPreview()}>
                <Splitter
                  orientation="vertical"
                  value={layout.previewW()}
                  min={layout.bounds.previewW[0]}
                  max={layout.bounds.previewW[1]}
                  defaultValue={480}
                  dir={-1}
                  ariaLabel="Resize preview"
                  onInput={(px) => layout.setPreviewW(px)}
                  onCommit={() => layout.persist()}
                  onReset={() => layout.resetPreviewW()}
                />
              </Show>
              <Show when={machine.mode() === 'dev'}>
                <PreviewPanel initialPort={3000} />
              </Show>
              <Show when={machine.mode() === 'real-vite'}>
                <PreviewPanel initialPort={machine.realVitePort()} />
              </Show>
            </div>

            <Splitter
              orientation="horizontal"
              value={layout.consoleH()}
              min={layout.bounds.consoleH[0]}
              max={layout.bounds.consoleH[1]}
              defaultValue={232}
              dir={-1}
              ariaLabel="Resize console"
              onInput={(px) => layout.setConsoleH(px)}
              onCommit={() => layout.persist()}
              onReset={() => layout.resetConsoleH()}
            />

            <BottomPanel
              sub={machine.mode() === 'repl' ? 'worker · stdout / stderr' : 'shell'}
              collapsed={layout.consoleCollapsed()}
              onToggleCollapse={() => layout.toggleConsole()}
              attach={(write) => {
                runtime.attachWriter(write);
                shell.attachWriter(write);
              }}
              onLine={(line) => {
                if (machine.mode() === 'dev' || machine.mode() === 'real-vite') {
                  void shell.runLine(line);
                  return;
                }
                return runtime.handleLine(line);
              }}
            />
          </main>
        </div>

        <StatusBar
          mode={machine.mode()}
          modeLabel={modeLabel()}
          activeFile={activeFile()}
          language={activeLang()}
          isOpfs={isOpfs}
          storageReason={props.boot.vfsBoot.reason}
          coi={isCrossOriginIsolated()}
        />
      </Show>

      <Show when={toast()}>
        <output class="rf-toast">{toast()}</output>
      </Show>
    </div>
  );
}
