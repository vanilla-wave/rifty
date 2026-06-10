import { type RuntimeController, spawnRuntime } from '@riftydev/runtime-js';
import { onCleanup } from 'solid-js';
// `?worker&url` makes Vite emit + bundle the worker as a module chunk and hand
// back its URL. The previous `new URL('../workers/worker-entry.ts',
// import.meta.url)` form only resolves under `pnpm dev`; `vite build` ships no
// worker chunk for it, so the production worker failed to load with an
// empty-message ErrorEvent ("[worker error] undefined"). The kernel's child
// worker entry is wired identically in main.tsx.
import workerUrl from '../workers/worker-entry.ts?worker&url';

type Writer = (chunk: string, stream?: 'stdout' | 'stderr') => void;

const REPL_HELP = [
  'REPL quick start',
  '  1 + 1                         evaluate an expression',
  "  console.log('hello')          stream stdout",
  "  require('node:path').basename('/tmp/demo.txt')",
  '  await Promise.resolve(42)      await promises directly',
  '',
  'Run executes the editor file main.js.',
  'Commands: .help, .reset',
  '',
].join('\n');

/**
 * Solid adapter around the framework-agnostic runtime controller. This is the
 * only place where the playground UI touches the runtime — keeps the boundary
 * clean (see D-002).
 */
export function useRuntime() {
  let writer: Writer | null = null;
  // Worker liveness: `false` until the first `ready`, back to `false` on `exit`
  // (reset/crash). `controller.eval` rejects with "Runtime is not running" if
  // called while down, so callers that fire eagerly (preset auto-run, the Run
  // button) gate on `whenReady()` instead of racing the boot.
  let running = false;
  let readyWaiters: Array<() => void> = [];
  const controller: RuntimeController = spawnRuntime({ workerUrl });

  function markReady(): void {
    running = true;
    const waiters = readyWaiters;
    readyWaiters = [];
    for (const resolve of waiters) resolve();
  }

  // `attach()` re-runs after every `reset()` (the controller respawns the
  // worker and the old subscription is gone). `controller.on` returns an
  // unsubscribe fn — drop the previous listener before adding a new one so
  // handlers don't accumulate across resets (which would duplicate every
  // terminal line and fire `markReady` once per stale listener).
  let detach: (() => void) | null = null;
  function attach() {
    detach?.();
    detach = controller.on((event) => {
      switch (event.type) {
        case 'stdout':
          writer?.(event.chunk, 'stdout');
          break;
        case 'stderr':
          writer?.(event.chunk, 'stderr');
          break;
        case 'result':
          if (!event.result.ok) {
            writer?.(`${event.result.error.name}: ${event.result.error.message}\n`, 'stderr');
          }
          break;
        case 'ready':
          markReady();
          writer?.('[worker ready]\n');
          break;
        case 'exit':
          running = false;
          writer?.(`[worker exited: ${event.reason}]\n`, 'stderr');
          break;
      }
    });
  }
  attach();

  onCleanup(() => controller.dispose());

  return {
    attachWriter(w: Writer) {
      writer = w;
    },
    write(chunk: string, stream: 'stdout' | 'stderr' = 'stdout') {
      writer?.(chunk, stream);
    },
    /** True once the worker has booted (and not since exited). */
    isRunning(): boolean {
      return running;
    },
    /** Resolves immediately if the worker is up, otherwise on the next `ready`. */
    whenReady(): Promise<void> {
      if (running) return Promise.resolve();
      return new Promise<void>((resolve) => readyWaiters.push(resolve));
    },
    async evaluate(code: string) {
      return controller.eval(code);
    },
    async handleLine(line: string) {
      const command = line.trim();
      if (command === '.help' || command === '?') {
        writer?.(REPL_HELP);
        return;
      }
      if (command === '.reset') {
        await controller.reset();
        attach();
        return;
      }
      if (line.trim().length === 0) return;
      await controller.eval(line);
    },
    writeStdin(data: string | Uint8Array) {
      try {
        controller.writeStdin(data);
      } catch {
        /* worker may be between reset/ready; stdin is best-effort */
      }
    },
    async reset() {
      await controller.reset();
      attach();
    },
    dispose() {
      controller.dispose();
    },
  };
}
