import type { RuntimeController, RuntimeEvent } from '@riftydev/runtime-js';

/** One subscription owner from opening through replacement Workers. */
export function createSandboxEvents() {
  const handlers = new Set<(event: RuntimeEvent) => void>();
  const on: RuntimeController['on'] = (handler) => {
    handlers.add(handler);
    return () => handlers.delete(handler);
  };
  return {
    on,
    clear: () => handlers.clear(),
    emit(event: RuntimeEvent) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error) {
          console.error('runtime listener threw', error);
        }
      }
    },
  };
}
