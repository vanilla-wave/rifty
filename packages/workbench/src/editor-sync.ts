import { type VfsSnapshotFrame, subscribeVfsSnapshot } from './vfs-snapshot-port.ts';
import { type VfsWriteFrame, sendVfsWrite } from './vfs-write-port.ts';

export interface EditorSyncSessionLike {
  readonly port?: number;
  readonly entryPath: string;
  updateFile(path: string, content: string): void;
}

export interface EditorSyncOptions {
  readonly session: EditorSyncSessionLike;
  readonly onSnapshot?: (frame: VfsSnapshotFrame) => void;
  readonly subscribeSnapshot?: (
    port: number,
    onFrame: (frame: VfsSnapshotFrame) => void,
  ) => () => void;
  readonly sendVfsWrite?: (port: number, frame: VfsWriteFrame) => void;
}

export interface EditorSync {
  writeEntry(content: string): void;
  writeFile(path: string, content: string): void;
  mkdir(path: string, recursive?: boolean): void;
  dispose(): void;
}

export function createEditorSync(opts: EditorSyncOptions): EditorSync {
  let disposed = false;
  const unsubscribe =
    opts.onSnapshot && opts.session.port !== undefined
      ? (opts.subscribeSnapshot ?? subscribeVfsSnapshot)(opts.session.port, opts.onSnapshot)
      : undefined;
  const assertOpen = (): void => {
    if (disposed) throw new Error('editor sync disposed');
  };
  return {
    writeEntry(content) {
      assertOpen();
      opts.session.updateFile(opts.session.entryPath, content);
    },
    writeFile(path, content) {
      assertOpen();
      opts.session.updateFile(path, content);
    },
    mkdir(path, recursive = true) {
      assertOpen();
      if (opts.session.port === undefined) {
        throw new Error('editor sync mkdir requires a session port');
      }
      (opts.sendVfsWrite ?? sendVfsWrite)(opts.session.port, {
        type: 'mkdir',
        path,
        recursive,
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
    },
  };
}
