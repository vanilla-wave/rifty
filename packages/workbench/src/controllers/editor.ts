import { notifySubscribers } from '../fault-boundary.ts';
import { commitOwnerWrites } from '../glue/owner-write-barrier.ts';
import type { VfsWriteFrame } from '../glue/vfs-write-port.ts';

export type EditorStatus = 'idle' | 'opening' | 'ready' | 'saving' | 'error';

export interface EditorOwnerPort {
  readFileBytes(path: string): Promise<Uint8Array>;
  writeFrameAcked(frame: VfsWriteFrame): Promise<void>;
  flushDurable(): Promise<void>;
}

export interface EditorSnapshot {
  readonly status: EditorStatus;
  readonly path: string | null;
  readonly text: string;
  readonly dirty: boolean;
  /** True only after the active text crossed the owner's durability barrier. */
  readonly durable: boolean;
  readonly error: string | null;
}

export interface EditorControllerOptions {
  readonly currentOwner: () => EditorOwnerPort;
  readonly storageBackend: 'opfs' | 'memory';
}

export interface EditorController {
  snapshot(): EditorSnapshot;
  subscribe(listener: (snapshot: EditorSnapshot) => void): () => void;
  open(path: string): Promise<void>;
  edit(text: string): void;
  save(): Promise<void>;
  close(): void;
  dispose(): void;
}

interface SaveRequest {
  readonly owner: EditorOwnerPort;
  readonly path: string;
  readonly text: string;
  readonly revision: number;
  readonly documentEpoch: number;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function createEditorController(options: EditorControllerOptions): EditorController {
  let disposed = false;
  let disposeReject: ((error: Error) => void) | null = null;
  const disposedPromise = new Promise<never>((_resolve, reject) => {
    disposeReject = reject;
  });
  void disposedPromise.catch(() => {});
  let documentEpoch = 0;
  let revision = 0;
  let hasDocument = false;
  let state: EditorSnapshot = {
    status: 'idle',
    path: null,
    text: '',
    dirty: false,
    durable: false,
    error: null,
  };
  const listeners = new Set<(snapshot: EditorSnapshot) => void>();
  let saveTail: Promise<void> = Promise.resolve();

  const assertAlive = (): void => {
    if (disposed) throw new Error('editor controller disposed');
  };

  const publish = (next: EditorSnapshot): void => {
    if (disposed) return;
    state = next;
    notifySubscribers(listeners, state);
  };

  const awaitAlive = <T>(promise: Promise<T>): Promise<T> =>
    Promise.race([promise, disposedPromise]);

  const isCurrent = (request: SaveRequest): boolean =>
    request.documentEpoch === documentEpoch && request.path === state.path;

  const performSave = async (request: SaveRequest): Promise<void> => {
    assertAlive();
    if (isCurrent(request)) {
      publish({ ...state, status: 'saving', durable: false, error: null });
    }
    try {
      const frame: VfsWriteFrame = {
        type: 'write',
        path: request.path,
        data: encoder.encode(request.text),
      };
      const commit = commitOwnerWrites(() => request.owner, [frame]);
      await awaitAlive(commit.applied);
      assertAlive();
      if (isCurrent(request)) {
        publish({
          ...state,
          status: 'saving',
          dirty: revision !== request.revision,
          durable: false,
          error: null,
        });
      }
      await awaitAlive(commit.durable);
      assertAlive();
      if (isCurrent(request)) {
        const currentTextWasFlushed = revision === request.revision;
        publish({
          ...state,
          status: 'ready',
          dirty: !currentTextWasFlushed,
          durable: currentTextWasFlushed && options.storageBackend === 'opfs',
          error: null,
        });
      }
    } catch (error) {
      const failure = asError(error);
      if (!disposed && isCurrent(request)) {
        publish({
          ...state,
          status: 'error',
          dirty: true,
          durable: false,
          error: failure.message,
        });
      }
      throw failure;
    }
  };

  return {
    snapshot() {
      assertAlive();
      return state;
    },
    subscribe(listener) {
      assertAlive();
      listeners.add(listener);
      notifySubscribers([listener], state);
      return () => listeners.delete(listener);
    },
    async open(path) {
      assertAlive();
      const owner = options.currentOwner();
      const epoch = ++documentEpoch;
      revision = 0;
      hasDocument = false;
      publish({
        status: 'opening',
        path,
        text: '',
        dirty: false,
        durable: false,
        error: null,
      });
      try {
        const bytes = await awaitAlive(Promise.resolve().then(() => owner.readFileBytes(path)));
        assertAlive();
        if (epoch !== documentEpoch) return;
        const text = decoder.decode(bytes);
        hasDocument = true;
        publish({
          status: 'ready',
          path,
          text,
          dirty: false,
          durable: false,
          error: null,
        });
      } catch (error) {
        const failure = asError(error);
        if (!disposed && epoch === documentEpoch) {
          publish({
            status: 'error',
            path,
            text: '',
            dirty: false,
            durable: false,
            error: failure.message,
          });
        }
        throw failure;
      }
    },
    edit(text) {
      assertAlive();
      if (!hasDocument || state.path === null || state.status === 'opening') {
        throw new Error('editor has no open file to edit');
      }
      revision += 1;
      publish({
        status: 'ready',
        path: state.path,
        text,
        dirty: true,
        durable: false,
        error: null,
      });
    },
    save() {
      assertAlive();
      if (!hasDocument || state.path === null || state.status === 'opening') {
        return Promise.reject(new Error('editor has no open file to save'));
      }
      let owner: EditorOwnerPort;
      try {
        owner = options.currentOwner();
      } catch (error) {
        return Promise.reject(asError(error));
      }
      const request: SaveRequest = {
        owner,
        path: state.path,
        text: state.text,
        revision,
        documentEpoch,
      };
      const queued = saveTail.catch(() => {}).then(() => performSave(request));
      saveTail = queued;
      return queued;
    },
    close() {
      assertAlive();
      documentEpoch += 1;
      revision = 0;
      hasDocument = false;
      publish({
        status: 'idle',
        path: null,
        text: '',
        dirty: false,
        durable: false,
        error: null,
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      documentEpoch += 1;
      hasDocument = false;
      disposeReject?.(new Error('editor controller disposed'));
      disposeReject = null;
      listeners.clear();
    },
  };
}
