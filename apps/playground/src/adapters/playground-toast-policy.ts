import { DELETE_GRACE_MS } from '../glue/app-project-store.ts';
import type { Toast } from '../glue/page-store.ts';

export const STORE_TOAST_BEAT_MS = 2_500;

export interface PlaygroundStoreToastDismissal {
  update(toast: Toast | null): void;
  dispose(): void;
}

/** Own the one replaceable deadline for the page-store toast channel. */
export function createPlaygroundStoreToastDismissal(
  dismiss: (toast: Toast) => void,
): PlaygroundStoreToastDismissal {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const clear = (): void => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  return Object.freeze({
    update(toast: Toast | null) {
      if (disposed) throw new Error('Playground store toast dismissal is closed');
      clear();
      if (toast === null) return;
      timer = setTimeout(
        () => {
          timer = undefined;
          dismiss(toast);
        },
        toast.undo === true ? DELETE_GRACE_MS : STORE_TOAST_BEAT_MS,
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
    },
  });
}
