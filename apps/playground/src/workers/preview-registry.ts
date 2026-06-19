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

  // Dedup by port so a `node server.js` that picks the SAME port as the live dev
  // server (no PORT injection, ADR-0154 §4) is not double-listed (ADR-0157 review
  // C3): the SW routes one `/preview/<port>/` per port, so two entries would make
  // the page wire two bridges on it and a teardown of either delete the shared
  // route. Dev slot wins (it was there first); first node sid wins among nodes.
  const snapshot = (): PreviewPortEntry[] => {
    const seen = new Set<number>();
    const out: PreviewPortEntry[] = [];
    for (const entry of [...(dev ? [dev] : []), ...[...node.values()].flat()]) {
      if (seen.has(entry.port)) continue;
      seen.add(entry.port);
      out.push(entry);
    }
    return out;
  };
  const emit = (): void => deps.send({ type: 'pty:preview', ports: snapshot() });

  return {
    setDevServer(port) {
      dev = {
        port,
        url: `/preview/${port}/`,
        label: 'npm run dev',
        source: 'dev-server',
        sid: DEV_SID,
      };
      emit();
    },
    clearDevServer() {
      dev = null;
      emit();
    },
    addNode(sid, ports) {
      node.set(
        sid,
        ports.map((port) => ({
          port,
          url: `/preview/${port}/`,
          label: `node :${port}`,
          source: 'node',
          sid,
        })),
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
