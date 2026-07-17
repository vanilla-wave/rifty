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
  reopenOpenDocuments(): Promise<void>;
  refreshOpenDiagnostics(): Promise<void>;
  dispose(): void;
}

export function createTsDiagnosticsSync<Diagnostic, Marker>(
  options: TsDiagnosticsSyncOptions<Diagnostic, Marker>,
): TsDiagnosticsSync {
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const openPaths = new Set<string>();
  const liveDocuments = new Map<string, string>();
  const diagnosticVersions = new Map<string, number>();
  let activeReopen: Promise<void> | undefined;
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

  async function waitForActiveReopen(): Promise<void> {
    while (activeReopen !== undefined) {
      const pending = activeReopen;
      try {
        await pending;
      } catch {
        // Reopen caller owns failure; a later event still applies latest text.
      }
      if (activeReopen === pending) return;
    }
  }

  function handleDocument(ev: EditorDocumentEvent): void {
    if (!options.isSupportedPath(ev.path)) return;
    if (ev.kind === 'close') {
      liveDocuments.delete(ev.path);
      bumpDiagnosticVersion(ev.path);
      clearTimer(ev.path);
      void (async (): Promise<void> => {
        await waitForActiveReopen();
        await options.beforeRequest?.();
        if (!disposed && openPaths.delete(ev.path)) await options.client.close(ev.path);
      })().catch((err: unknown) => {
        if (!disposed) options.warn((err as Error).message);
      });
      options.setMarkers(ev.path, []);
      options.setDiagnostics((prev) => {
        if (!prev.has(ev.path)) return prev;
        const next = new Map(prev);
        next.delete(ev.path);
        return next;
      });
      return;
    }

    liveDocuments.set(ev.path, ev.text);
    const version = bumpDiagnosticVersion(ev.path);
    clearTimer(ev.path);
    debounceTimers.set(
      ev.path,
      setTimeout(() => {
        debounceTimers.delete(ev.path);
        void (async (): Promise<void> => {
          await waitForActiveReopen();
          await options.beforeRequest?.();
          if (
            disposed ||
            diagnosticVersions.get(ev.path) !== version ||
            liveDocuments.get(ev.path) !== ev.text
          ) {
            return;
          }
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

  async function reopenOpenDocuments(): Promise<void> {
    if (disposed) return;
    const previousReopen = activeReopen;
    const documents = [...liveDocuments].map(([path, text]) => {
      clearTimer(path);
      return { path, text, version: bumpDiagnosticVersion(path) };
    });
    openPaths.clear();
    for (const { path } of documents) options.setMarkers(path, []);
    options.setDiagnostics((prev) => {
      const next = new Map(prev);
      for (const { path } of documents) next.delete(path);
      return next;
    });

    const replay = (async (): Promise<void> => {
      if (previousReopen !== undefined) {
        try {
          await previousReopen;
        } catch {
          // This reset supersedes the failed replay.
        }
      }
      const results = await Promise.allSettled(
        documents.map(async ({ path, text, version }) => {
          await options.beforeRequest?.();
          if (disposed) return;
          await options.client.open(path, text);
          if (disposed) return;
          openPaths.add(path);
          await refreshDiagnostics(path, version);
        }),
      );
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failure !== undefined) throw failure.reason;
    })();
    activeReopen = replay;
    try {
      await replay;
    } finally {
      if (activeReopen === replay) activeReopen = undefined;
    }
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
    liveDocuments.clear();
    diagnosticVersions.clear();
  }

  return { handleDocument, reopenOpenDocuments, refreshOpenDiagnostics, dispose };
}
