import type { OwnerToPageFrame, PreviewPortEntry } from '../glue/pty-protocol.ts';

const DEV_SID = 'dev-server';

export interface PreviewRegistryDeps {
  readonly send: (frame: OwnerToPageFrame) => void;
}
export interface PreviewRegistry {
  setDevServer(port: number): void;
  clearDevServer(): void;
  addNode(sid: string, ports: number[]): void;
  removeBySid(sid: string): void;
  /** Re-emit the current set (answers pty:preview-req). */
  publish(): void;
}

export function createPreviewRegistry(deps: PreviewRegistryDeps): PreviewRegistry {
  // Insertion order matters for the switcher default (most-recent last): dev
  // server keeps its slot; node entries append.
  let dev: PreviewPortEntry | null = null;
  const node = new Map<string, PreviewPortEntry[]>();

  const snapshot = (): PreviewPortEntry[] => [
    ...(dev ? [dev] : []),
    ...[...node.values()].flat(),
  ];
  const emit = (): void => deps.send({ type: 'pty:preview', ports: snapshot() });

  return {
    setDevServer(port) {
      dev = { port, url: `/preview/${port}/`, label: 'npm run dev', source: 'dev-server', sid: DEV_SID };
      emit();
    },
    clearDevServer() {
      dev = null;
      emit();
    },
    addNode(sid, ports) {
      node.set(
        sid,
        ports.map((port) => ({ port, url: `/preview/${port}/`, label: `node :${port}`, source: 'node', sid })),
      );
      emit();
    },
    removeBySid(sid) {
      if (node.delete(sid)) emit();
    },
    publish() {
      emit();
    },
  };
}
