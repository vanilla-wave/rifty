interface PendingEditorOp<Api> {
  readonly contextKey: string;
  readonly op: (api: Api) => void;
}

export interface EditorOpQueue<Api> {
  readonly runOrQueue: (
    api: Api | undefined,
    contextReady: boolean,
    contextKey: string,
    op: (api: Api) => void,
  ) => void;
  readonly discardStale: (contextReady: boolean, contextKey: string) => void;
  readonly flush: (api: Api, contextKey: string) => void;
  readonly size: () => number;
}

export function createEditorOpQueue<Api>(): EditorOpQueue<Api> {
  let pending: PendingEditorOp<Api>[] = [];

  return {
    runOrQueue(api, contextReady, contextKey, op) {
      if (api) {
        op(api);
        return;
      }
      if (contextReady) pending.push({ contextKey, op });
    },
    discardStale(contextReady, contextKey) {
      pending = contextReady ? pending.filter((entry) => entry.contextKey === contextKey) : [];
    },
    flush(api, contextKey) {
      const queued = pending.filter((entry) => entry.contextKey === contextKey);
      pending = [];
      for (const { op } of queued) op(api);
    },
    size() {
      return pending.length;
    },
  };
}
