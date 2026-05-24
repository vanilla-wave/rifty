import { detectCapabilities } from '@rifty/runtime-js/env/capabilities';
import { registerServiceWorker } from '@rifty/service-worker';
import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { type DevModeHandle, startDevMode } from './adapters/devMode.ts';
import { type RealViteHandle, startRealVite } from './adapters/realVite.ts';
import { useRuntime } from './adapters/useRuntime.ts';
import { CapabilitiesPanel } from './components/CapabilitiesPanel.tsx';
import { EditorPanel } from './components/EditorPanel.tsx';
import { PreviewPanel } from './components/PreviewPanel.tsx';
import { TerminalPanel } from './components/TerminalPanel.tsx';

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

export function App() {
  const capabilities = detectCapabilities();
  const [mode, setMode] = createSignal<'repl' | 'dev' | 'real-vite'>('repl');
  const [source, setSource] = createSignal(replSource);
  const [devHandle, setDevHandle] = createSignal<DevModeHandle | null>(null);
  const [realViteHandle, setRealViteHandle] = createSignal<RealViteHandle | null>(null);
  const [realVitePort, setRealVitePort] = createSignal(5174);
  const runtime = useRuntime();

  onMount(async () => {
    try {
      await registerServiceWorker('/sw.js');
    } catch (err) {
      runtime.write(`SW registration failed: ${(err as Error).message}\n`, 'stderr');
    }
  });

  onCleanup(() => {
    void devHandle()?.close();
    void realViteHandle()?.close();
    runtime.dispose();
  });

  function onRun(): void {
    runtime.write(`\n> [Run] ${new Date().toLocaleTimeString()}\n`);
    void runtime.evaluate(source());
  }

  function onReset(): void {
    runtime.write('\n[worker reset]\n', 'stderr');
    void runtime.reset();
  }

  async function onToggleMode(): Promise<void> {
    if (mode() === 'repl') {
      runtime.write('\n[entering dev mode — starting dev server on port 3000]\n');
      try {
        const handle = await startDevMode({ port: 3000 });
        setDevHandle(handle);
        setMode('dev');
        setSource(devSource);
        handle.updateEntry(devSource);
      } catch (err) {
        runtime.write(`dev mode failed: ${(err as Error).message}\n`, 'stderr');
      }
    } else {
      const handle = devHandle();
      if (handle) await handle.close();
      setDevHandle(null);
      setMode('repl');
      setSource(replSource);
      runtime.write('\n[left dev mode]\n');
    }
  }

  function onEditorChange(next: string): void {
    setSource(next);
    if (mode() === 'dev') devHandle()?.updateEntry(next);
    if (mode() === 'real-vite') realViteHandle()?.updateEntry(next);
  }

  async function onToggleRealVite(): Promise<void> {
    if (mode() === 'real-vite') {
      const h = realViteHandle();
      if (h) await h.close();
      setRealViteHandle(null);
      setMode('repl');
      setSource(replSource);
      runtime.write('\n[left real-vite mode]\n');
      return;
    }
    runtime.write('\n[starting real Vite — installing from npm, this may take ~20s]\n');
    try {
      const handle = await startRealVite({
        port: realVitePort(),
        onLog: (line) => runtime.write(line),
      });
      setRealViteHandle(handle);
      setRealVitePort(handle.port);
      setMode('real-vite');
      setSource(devSource);
      handle.updateEntry(devSource);
    } catch (err) {
      runtime.write(
        `real-vite failed: ${(err as Error).stack ?? (err as Error).message}\n`,
        'stderr',
      );
    }
  }

  return (
    <div style={{ display: 'grid', 'grid-template-rows': 'auto 1fr', height: '100vh' }}>
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
          {mode() === 'dev'
            ? 'M10 — Dev Mode (port 3000)'
            : mode() === 'real-vite'
              ? `M10 — Real Vite (port ${realVitePort()})`
              : 'M0..M9 — REPL'}
        </span>
        <button
          type="button"
          onClick={() => void onToggleRealVite()}
          style={{
            'margin-left': 'auto',
            background: mode() === 'real-vite' ? '#f59e0b' : '#1f2533',
            color: mode() === 'real-vite' ? '#0f1115' : '#e6e6e6',
            border: '1px solid #2a3142',
            padding: '6px 14px',
            'border-radius': '4px',
            cursor: 'pointer',
            'font-family': 'inherit',
          }}
          data-action="real-vite"
        >
          {mode() === 'real-vite' ? '● Real Vite' : 'Real Vite'}
        </button>
        <button
          type="button"
          onClick={() => void onToggleMode()}
          style={{
            background: mode() === 'dev' ? '#10b981' : '#1f2533',
            color: mode() === 'dev' ? '#0f1115' : '#e6e6e6',
            border: '1px solid #2a3142',
            padding: '6px 14px',
            'border-radius': '4px',
            cursor: 'pointer',
            'font-family': 'inherit',
          }}
          data-action="dev-mode"
        >
          {mode() === 'dev' ? '● Dev Mode' : 'Dev Mode'}
        </button>
        <Show when={mode() === 'repl'}>
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
              mode() === 'dev' || mode() === 'real-vite' ? '1fr 1fr 1fr' : '1fr 1fr',
            height: '100%',
          }}
        >
          <EditorPanel value={source()} onChange={onEditorChange} />
          <TerminalPanel
            attach={(write) => runtime.attachWriter(write)}
            onLine={(line) => runtime.handleLine(line)}
          />
          <Show when={mode() === 'dev'}>
            <PreviewPanel initialPort={3000} />
          </Show>
          <Show when={mode() === 'real-vite'}>
            <PreviewPanel initialPort={realVitePort()} />
          </Show>
        </div>
      </Show>
    </div>
  );
}
