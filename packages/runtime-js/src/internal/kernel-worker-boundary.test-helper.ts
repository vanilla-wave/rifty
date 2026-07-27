interface KernelWorkerInit {
  readonly type: 'init';
  readonly spec: {
    readonly pid: number;
    readonly ppid: number;
    readonly stdio: {
      readonly ipc: MessagePort;
    };
  };
}

function kernelWorkerInit(value: unknown): KernelWorkerInit {
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { readonly type?: unknown }).type !== 'init'
  ) {
    throw new TypeError('expected kernel Worker init');
  }
  return value as KernelWorkerInit;
}

/**
 * Substitute only the absent DOM Worker boundary. The real kernel
 * ProcessManager still allocates, wires, observes, and retires the process.
 */
export function installKernelWorkerBoundary(onInit: (init: KernelWorkerInit) => void): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');

  class BoundaryWorker {
    postMessage(message: unknown): void {
      onInit(kernelWorkerInit(message));
    }

    terminate(): void {}

    addEventListener(): void {}

    removeEventListener(): void {}
  }

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: BoundaryWorker,
  });

  return () => {
    if (previous === undefined) {
      Reflect.deleteProperty(globalThis, 'Worker');
    } else {
      Object.defineProperty(globalThis, 'Worker', previous);
    }
  };
}

export function closeKernelWorkerPeer(init: KernelWorkerInit): void {
  init.spec.stdio.ipc.postMessage({ kind: 'control:peer-closing' });
}
