import { RegistryClient } from '@riftydev/npm-client';
import { detectCapabilities } from '@riftydev/runtime-js/env/capabilities';
import { Show, createSignal, onCleanup } from 'solid-js';
import { useShellSession } from './adapters/shell-adapter.ts';
import { useMode } from './adapters/useMode.ts';
import { useRuntime } from './adapters/useRuntime.ts';
import { type BootResult, swErrorBannerMessage } from './boot.ts';
import { CapabilitiesPanel } from './components/CapabilitiesPanel.tsx';
import { EditorPanel } from './components/EditorPanel.tsx';
import { PresetGallery } from './components/PresetGallery.tsx';
import { PreviewPanel } from './components/PreviewPanel.tsx';
import { TerminalPanel } from './components/TerminalPanel.tsx';
import { createNpmShellCommand } from './glue/npm-shell-command.ts';
import { proxiedRegistryFetch } from './glue/registry-fetch.ts';
import { SyncMirrorVfs } from './glue/sync-mirror-vfs.ts';
import { DEFAULT_PRESET, type Preset } from './presets.ts';

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
  const [collapsed, setCollapsed] = createSignal(false);
  const runtime = useRuntime();
  // Long-lived shell session — drives the terminal in `dev` / `real-vite`
  // modes so users can `npm install`, `vite dev`, file ops, etc. Output
  // streams via `onChunk` so progress bars / live logs reach the terminal in
  // real time. REPL mode keeps using `runtime.handleLine` to eval JS code.
  const shell = useShellSession({ cwd: '/workspace' });
  // Wire `npm install …` into the shell (follow-ups item #15, 2026-05-27).
  // Without this the prompt returns exit 127. The same registry + VFS
  // pair is used by `realVite.ts`, so installs from the shell and from the
  // Real-Vite mode share the warm tarball cache.
  shell.registerCommand(
    'npm',
    createNpmShellCommand({
      vfs: new SyncMirrorVfs(),
      registry: new RegistryClient({ fetch: proxiedRegistryFetch() }),
    }),
  );
  // Mode state machine — owns `repl | dev | real-vite`, the inner dev /
  // real-vite handles, and the editor source. App.tsx only renders JSX and
  // wires terminals; transitions live in the adapter. The REPL seed is the
  // default preset's source (it prints `worker alive`, which the M1 e2e
  // asserts against the boot-time editor content).
  const machine = useMode({
    sources: { repl: DEFAULT_PRESET.source, dev: DEFAULT_PRESET.source },
    log: (chunk, stream) => runtime.write(chunk, stream),
  });

  // SW errors come from the consolidated bootstrap (boot.ts), no longer from
  // an `onMount` race here. If `boot.swError` is present, the bootstrap
  // pipeline already logged it; mirror it into the terminal so users see it
  // alongside the banner.
  if (props.boot.swError) {
    runtime.write(`SW registration failed: ${props.boot.swError}\n`, 'stderr');
  }

  onCleanup(() => {
    runtime.dispose();
    shell.dispose();
  });

  // Evaluate REPL source, but only once the worker is up — `controller.eval`
  // rejects with "Runtime is not running" if called during boot/reset, which a
  // fast click (or auto-run on a freshly loaded page) can hit. `whenReady`
  // gates on the worker's `ready` event; the catch keeps a transient failure
  // out of the console as an unhandled rejection.
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
    // REPL presets are instant — auto-run so the gallery feels alive on click.
    if (preset.mode === 'repl') {
      void runRepl(preset.source, preset.label);
    }
  }

  const modeLabel = (): string =>
    machine.mode() === 'dev'
      ? 'Dev Mode · port 3000'
      : machine.mode() === 'real-vite'
        ? `Real Vite · port ${machine.realVitePort()}`
        : 'REPL · Worker';

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

        <span
          class="rf-badge"
          data-storage-badge
          data-tone={isOpfs ? 'ok' : 'warn'}
          title={props.boot.vfsBoot.reason ?? ''}
        >
          <span class="rf-badge__dot" />
          {isOpfs ? 'OPFS · persisted' : 'in-memory'}
        </span>

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
        <div class="rf-body" data-collapsed={collapsed()}>
          <Show when={!collapsed()}>
            <PresetGallery activeId={activePreset()} onSelect={onSelectPreset} />
          </Show>

          <div class="rf-main" data-mode={machine.mode()}>
            <section class="rf-pane">
              <div class="rf-pane__chrome">
                <span class="rf-pane__title">Editor</span>
                <span class="rf-pane__sub">
                  {machine.mode() === 'repl' ? 'main.js' : '/workspace/src/main.js'}
                </span>
                <div class="rf-pane__tools">
                  <button
                    type="button"
                    class="rf-iconbtn"
                    onClick={() => setCollapsed((c) => !c)}
                    title={collapsed() ? 'Show presets' : 'Hide presets'}
                    aria-label={collapsed() ? 'Show presets' : 'Hide presets'}
                  >
                    {collapsed() ? '⇥' : '⇤'}
                  </button>
                </div>
              </div>
              <div class="rf-pane__body">
                <EditorPanel
                  value={machine.source()}
                  onChange={(next) => machine.setSource(next)}
                />
              </div>
            </section>

            <section class="rf-pane">
              <div class="rf-pane__chrome">
                <span class="rf-pane__title">Console</span>
                <span class="rf-pane__sub">
                  {machine.mode() === 'repl' ? 'worker · stdout / stderr' : 'shell'}
                </span>
              </div>
              <div class="rf-pane__body">
                <TerminalPanel
                  attach={(write) => {
                    // Both sessions share the same terminal writer. Runtime emits
                    // worker stdout/stderr in REPL mode; shell emits builtin /
                    // command output in `dev` / `real-vite` modes. They don't
                    // contend — `onLine` below routes input to exactly one of
                    // them per mode.
                    runtime.attachWriter(write);
                    shell.attachWriter(write);
                  }}
                  onLine={(line) => {
                    // Dev / real-vite modes drive the shell (M10 Tier 0 wiring).
                    // REPL mode keeps the worker-eval behaviour unchanged.
                    if (machine.mode() === 'dev' || machine.mode() === 'real-vite') {
                      void shell.runLine(line);
                      return;
                    }
                    return runtime.handleLine(line);
                  }}
                />
              </div>
            </section>

            <Show when={machine.mode() === 'dev'}>
              <PreviewPanel initialPort={3000} />
            </Show>
            <Show when={machine.mode() === 'real-vite'}>
              <PreviewPanel initialPort={machine.realVitePort()} />
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
