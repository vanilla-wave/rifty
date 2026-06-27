import type { EditorDocumentEvent } from '../components/EditorHost.tsx';

export interface TsDiagnosticsClient<Diagnostic> {
  open(path: string, text: string): Promise<void>;
  update(path: string, text: string): Promise<void>;
  close(path: string): Promise<void>;
  getSemanticDiagnostics(path: string): Promise<readonly Diagnostic[]>;
  getSyntacticDiagnostics(path: string): Promise<readonly Diagnostic[]>;
}

export interface TsDiagnosticsSyncOptions<Diagnostic, Marker> {
  readonly client: TsDiagnosticsClient<Diagnostic>;
  readonly debounceMs: number;
  readonly isSupportedPath: (path: string) => boolean;
  readonly setMarkers: (path: string, markers: readonly Marker[]) => void;
  readonly setDiagnostics: (
    updater: (prev: Map<string, readonly Diagnostic[]>) => Map<string, readonly Diagnostic[]>,
  ) => void;
  readonly toMarkers: (diagnostics: readonly Diagnostic[]) => readonly Marker[];
  readonly beforeRequest?: () => Promise<void>;
  readonly warn: (message: string) => void;
}

export interface TsDiagnosticsSync {
  handleDocument(ev: EditorDocumentEvent): void;
  refreshOpenDiagnostics(): Promise<void>;
  dispose(): void;
}

export function createTsDiagnosticsSync<Diagnostic, Marker>(
  options: TsDiagnosticsSyncOptions<Diagnostic, Marker>,
): TsDiagnosticsSync {
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const openPaths = new Set<string>();
  const diagnosticVersions = new Map<string, number>();
  let disposed = false;

  function bumpDiagnosticVersion(path: string): number {
    const next = (diagnosticVersions.get(path) ?? 0) + 1;
    diagnosticVersions.set(path, next);
    return next;
  }

  async function refreshDiagnostics(path: string, version: number): Promise<void> {
    if (disposed) return;
    try {
      await options.beforeRequest?.();
      if (disposed || !openPaths.has(path) || diagnosticVersions.get(path) !== version) return;
      const [semantic, syntactic] = await Promise.all([
        options.client.getSemanticDiagnostics(path),
        options.client.getSyntacticDiagnostics(path),
      ]);
      if (disposed || !openPaths.has(path) || diagnosticVersions.get(path) !== version) return;
      const diags = [...syntactic, ...semantic];
      options.setMarkers(path, options.toMarkers(diags));
      options.setDiagnostics((prev) => {
        const next = new Map(prev);
        if (diags.length === 0) next.delete(path);
        else next.set(path, diags);
        return next;
      });
    } catch (err) {
      if (!disposed) options.warn((err as Error).message);
    }
  }

  function clearTimer(path: string): void {
    const timer = debounceTimers.get(path);
    if (timer) {
      clearTimeout(timer);
      debounceTimers.delete(path);
    }
  }

  function handleDocument(ev: EditorDocumentEvent): void {
    if (!options.isSupportedPath(ev.path)) return;
    if (ev.kind === 'close') {
      bumpDiagnosticVersion(ev.path);
      clearTimer(ev.path);
      if (openPaths.delete(ev.path)) {
        void (async (): Promise<void> => {
          await options.beforeRequest?.();
          if (!disposed) await options.client.close(ev.path);
        })().catch((err: unknown) => {
          if (!disposed) options.warn((err as Error).message);
        });
      }
      options.setMarkers(ev.path, []);
      options.setDiagnostics((prev) => {
        if (!prev.has(ev.path)) return prev;
        const next = new Map(prev);
        next.delete(ev.path);
        return next;
      });
      return;
    }

    const version = bumpDiagnosticVersion(ev.path);
    clearTimer(ev.path);
    debounceTimers.set(
      ev.path,
      setTimeout(() => {
        debounceTimers.delete(ev.path);
        void (async (): Promise<void> => {
          await options.beforeRequest?.();
          if (disposed || diagnosticVersions.get(ev.path) !== version) return;
          if (openPaths.has(ev.path)) {
            await options.client.update(ev.path, ev.text);
          } else {
            openPaths.add(ev.path);
            await options.client.open(ev.path, ev.text);
          }
          await refreshDiagnostics(ev.path, version);
        })().catch((err: unknown) => {
          if (!disposed) options.warn((err as Error).message);
        });
      }, options.debounceMs),
    );
  }

  async function refreshOpenDiagnostics(): Promise<void> {
    await Promise.all(
      [...openPaths].map((path) => refreshDiagnostics(path, bumpDiagnosticVersion(path))),
    );
  }

  function dispose(): void {
    disposed = true;
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    debounceTimers.clear();
    openPaths.clear();
    diagnosticVersions.clear();
  }

  return { handleDocument, refreshOpenDiagnostics, dispose };
}
