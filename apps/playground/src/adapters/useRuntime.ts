import { type RuntimeController, spawnRuntime } from '@riftydev/runtime-js';
import { onCleanup } from 'solid-js';

type Writer = (chunk: string, stream?: 'stdout' | 'stderr') => void;

/**
 * Solid adapter around the framework-agnostic runtime controller. This is the
 * only place where the playground UI touches the runtime — keeps the boundary
 * clean (see D-002).
 */
export function useRuntime() {
  let writer: Writer | null = null;
  const workerUrl = new URL('../workers/worker-entry.ts', import.meta.url).href;
  const controller: RuntimeController = spawnRuntime({ workerUrl });

  function attach() {
    controller.on((event) => {
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
          writer?.('[worker ready]\n');
          break;
        case 'exit':
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
    async evaluate(code: string) {
      return controller.eval(code);
    },
    async handleLine(line: string) {
      if (line === '.reset') {
        await controller.reset();
        attach();
        return;
      }
      if (line.trim().length === 0) return;
      await controller.eval(line);
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
