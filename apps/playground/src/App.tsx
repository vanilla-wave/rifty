import { RegistryClient } from '@riftydev/npm-client';
import { detectCapabilities } from '@riftydev/runtime-js/env/capabilities';
import { Show, createSignal, onCleanup } from 'solid-js';
import { useShellSession } from './adapters/shell-adapter.ts';
import { useMode } from './adapters/useMode.ts';
import { useRuntime } from './adapters/useRuntime.ts';
import { type BootResult, backendLabel, swErrorBannerMessage } from './boot.ts';
import { CapabilitiesPanel } from './components/CapabilitiesPanel.tsx';
import { EditorPanel } from './components/EditorPanel.tsx';
import { PreviewPanel } from './components/PreviewPanel.tsx';
import { TerminalPanel } from './components/TerminalPanel.tsx';
import { createNpmShellCommand } from './glue/npm-shell-command.ts';
import { proxiedRegistryFetch } from './glue/registry-fetch.ts';
import { SyncMirrorVfs } from './glue/sync-mirror-vfs.ts';

const replSource = `// Welcome to rifty.
//
// REPL mode: click "Run" to evaluate this code in a Worker.
// Or toggle "Dev Mode" to start a Vite-like dev server (M10) and edit
// /workspace/src/main.js below — the preview iframe live-reloads.
console.log('worker alive');
console.log('M0+M1: REPL streams stdout/stderr from a Worker.');
console.log('M2: require()/import() backed by an in-Worker module loader.');
`;

const devSource = `document.getElementById('app').textContent =
  'Hello from rifty — edit me, save, see HMR reload the iframe.';
document.body.style.background = '#0f1115';
document.body.style.color = '#e6e6e6';
document.body.style.fontFamily = 'system-ui, sans-serif';
`;

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
  // wires terminals; transitions live in the adapter.
  const machine = useMode({
    sources: { repl: replSource, dev: devSource },
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

  function onRun(): void {
    runtime.write(`\n> [Run] ${new Date().toLocaleTimeString()}\n`);
    void runtime.evaluate(machine.source());
  }

  function onReset(): void {
    runtime.write('\n[worker reset]\n', 'stderr');
    void runtime.reset();
  }

  return (
    <div style={{ display: 'grid', 'grid-template-rows': 'auto auto 1fr', height: '100vh' }}>
      <Show when={props.boot.swError && !swBannerDismissed()}>
        <div
          role="alert"
          data-banner="sw-error"
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '12px',
            padding: '8px 16px',
            background: '#3b1f1f',
            color: '#fecaca',
            'border-bottom': '1px solid #5b2a2a',
            'font-size': '13px',
          }}
        >
          <span style={{ flex: '1 1 auto' }}>{swErrorBannerMessage(props.boot.swError ?? '')}</span>
          <button
            type="button"
            onClick={() => setSwBannerDismissed(true)}
            data-action="dismiss-sw-banner"
            style={{
              background: 'transparent',
              color: '#fecaca',
              border: '1px solid #7f3a3a',
              padding: '2px 10px',
              'border-radius': '4px',
              cursor: 'pointer',
              'font-family': 'inherit',
              'font-size': '12px',
            }}
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      </Show>
      <header
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '12px',
          padding: '8px 16px',
          'border-bottom': '1px solid #232735',
          background: '#161922',
        }}
      >
        <strong>rifty</strong>
        <span style={{ color: '#8a93a3', 'font-size': '12px' }}>
          {machine.mode() === 'dev'
            ? 'M10 — Dev Mode (port 3000)'
            : machine.mode() === 'real-vite'
              ? `M10 — Real Vite (port ${machine.realVitePort()})`
              : 'M0..M9 — REPL'}
        </span>
        <span
          data-storage-badge
          title={props.boot.vfsBoot.reason ?? ''}
          style={{
            color: props.boot.vfsBoot.backend === 'opfs' ? '#a5d6a7' : '#fbbf24',
            background: props.boot.vfsBoot.backend === 'opfs' ? '#1a2e1f' : '#3a2f10',
            border: `1px solid ${props.boot.vfsBoot.backend === 'opfs' ? '#2a4a32' : '#5a4a18'}`,
            padding: '2px 8px',
            'border-radius': '4px',
            'font-size': '11px',
          }}
        >
          {backendLabel(props.boot.vfsBoot)}
        </span>
        <button
          type="button"
          onClick={() => void machine.toggleRealVite()}
          style={{
            'margin-left': 'auto',
            background: machine.mode() === 'real-vite' ? '#f59e0b' : '#1f2533',
            color: machine.mode() === 'real-vite' ? '#0f1115' : '#e6e6e6',
            border: '1px solid #2a3142',
            padding: '6px 14px',
            'border-radius': '4px',
            cursor: 'pointer',
            'font-family': 'inherit',
          }}
          data-action="real-vite"
        >
          {machine.mode() === 'real-vite' ? '● Real Vite' : 'Real Vite'}
        </button>
        <button
          type="button"
          onClick={() => void machine.toggleDev()}
          style={{
            background: machine.mode() === 'dev' ? '#10b981' : '#1f2533',
            color: machine.mode() === 'dev' ? '#0f1115' : '#e6e6e6',
            border: '1px solid #2a3142',
            padding: '6px 14px',
            'border-radius': '4px',
            cursor: 'pointer',
            'font-family': 'inherit',
          }}
          data-action="dev-mode"
        >
          {machine.mode() === 'dev' ? '● Dev Mode' : 'Dev Mode'}
        </button>
        <Show when={machine.mode() === 'repl'}>
          <button
            type="button"
            onClick={onRun}
            style={{
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              padding: '6px 14px',
              'border-radius': '4px',
              cursor: 'pointer',
              'font-family': 'inherit',
            }}
            data-action="run"
          >
            Run
          </button>
          <button
            type="button"
            onClick={onReset}
            style={{
              background: '#1f2533',
              color: '#e6e6e6',
              border: '1px solid #2a3142',
              padding: '6px 14px',
              'border-radius': '4px',
              cursor: 'pointer',
              'font-family': 'inherit',
            }}
            data-action="reset"
          >
            Reset
          </button>
        </Show>
      </header>

      <Show when={capabilities.sufficient} fallback={<CapabilitiesPanel check={capabilities} />}>
        <div
          style={{
            display: 'grid',
            'grid-template-columns':
              machine.mode() === 'dev' || machine.mode() === 'real-vite'
                ? '1fr 1fr 1fr'
                : '1fr 1fr',
            height: '100%',
          }}
        >
          <EditorPanel value={machine.source()} onChange={(next) => machine.setSource(next)} />
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
          <Show when={machine.mode() === 'dev'}>
            <PreviewPanel initialPort={3000} />
          </Show>
          <Show when={machine.mode() === 'real-vite'}>
            <PreviewPanel initialPort={machine.realVitePort()} />
          </Show>
        </div>
      </Show>
    </div>
  );
}
