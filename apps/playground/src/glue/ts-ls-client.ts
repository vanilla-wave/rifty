/**
 * Page-side TS language-service client (ADR-0166 P1.9b).
 *
 * An id-correlated request/response client over the page↔owner↔LS relay
 * (realVite.ts `sendTsLsp` / `onTsLsp`). There is no direct page→LS channel — the
 * LS is a grandchild the owner spawned — so every request envelope travels to the
 * owner, which forwards it to its LS child; the LS reply travels back the same way.
 *
 * Correlation machinery mirrors {@link ./node-modules-port.ts}: a monotonic `id`,
 * a `pending` map of `{resolve,reject,timer}`, a per-request timeout that REJECTS
 * (never a silent hang — the extra page→owner→LS hop means a dropped frame must
 * surface loud), and `dispose()` that rejects every in-flight call. Inbound frames
 * are routed via `onTsLsp` filtered by `isTsResponseMessage`.
 *
 * The `lspToMonacoMarkers` mapper converts the service's LSP {@link Diagnostic}
 * (0-based line/character, severity 1..4) to Monaco's `IMarkerData` (1-based
 * line/column, `MarkerSeverity`).
 */

import {
  type Diagnostic,
  DiagnosticSeverity,
  TS_IPC_TYPE,
  type TsRequest,
  type TsResponse,
  isTsResponseMessage,
} from '@riftydev/ts-language-service';
import type * as monaco from 'monaco-editor';
import { MarkerSeverity } from 'monaco-editor';

/** Relay seam the client posts requests on / subscribes responses through. */
export interface TsLspRelay {
  /** Post a `rifty:ts-lsp` request envelope to the owner (relayed to the LS child). */
  sendTsLsp(message: unknown): void;
  /** Subscribe to relayed `rifty:ts-lsp` response envelopes; returns an unsubscribe. */
  onTsLsp(cb: (message: unknown) => void): () => void;
}

export interface TsLanguageServiceClient {
  /** Bind the service to a project root (tsconfig discovered from here). Once per session. */
  init(projectRoot: string): Promise<void>;
  /** Open an editor buffer (overlay wins over disk). */
  open(path: string, text: string): Promise<void>;
  /** Replace the open buffer text. */
  update(path: string, text: string): Promise<void>;
  /** Close the buffer (revert to on-disk bytes). */
  close(path: string): Promise<void>;
  /** Drop the cached copy of `path` after an external VFS write. */
  invalidate(path: string): Promise<void>;
  /** Type (semantic) diagnostics for `path`. */
  getSemanticDiagnostics(path: string): Promise<readonly Diagnostic[]>;
  /** Parse (syntactic) diagnostics for `path`. */
  getSyntacticDiagnostics(path: string): Promise<readonly Diagnostic[]>;
  /** tsconfig (config-file) diagnostics. */
  getConfigFileDiagnostics(): Promise<readonly Diagnostic[]>;
  /** Reject every in-flight request and detach the relay listener. Idempotent. */
  dispose(): void;
}

interface Pending {
  resolve(response: TsResponse): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Build the client. `timeoutMs` arms a per-request reject (default 15s — generous:
 * a cold first `init` builds the whole `ts.LanguageService` + lib.d.ts over fs.*
 * RPC, and the page→owner→LS relay adds an async hop).
 */
export function createTsLanguageServiceClient(
  relay: TsLspRelay,
  opts: { readonly timeoutMs?: number } = {},
): TsLanguageServiceClient {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const pending = new Map<number, Pending>();
  let counter = 0;
  let torn = false;

  const unsubscribe = relay.onTsLsp((message: unknown) => {
    if (!isTsResponseMessage(message)) return;
    const { response } = message;
    const waiter = pending.get(response.id);
    if (!waiter) return; // unknown/late frame, or another client instance's
    pending.delete(response.id);
    clearTimeout(waiter.timer);
    waiter.resolve(response);
  });

  function request(build: (id: number) => TsRequest): Promise<TsResponse> {
    if (torn) return Promise.reject(new Error('ts-lsp client disposed'));
    const id = ++counter;
    return new Promise<TsResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`ts-lsp request ${id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      relay.sendTsLsp({ type: TS_IPC_TYPE, request: build(id) });
    });
  }

  /** A mutation/init request: resolves on `ack`, rejects on a service error. */
  async function ack(build: (id: number) => TsRequest): Promise<void> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    // ok:true here is always kind:'ack' for mutation/init requests.
  }

  /** A diagnostics query: resolves the diagnostics array, rejects on a service error. */
  async function diagnostics(build: (id: number) => TsRequest): Promise<readonly Diagnostic[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'diagnostics') {
      throw new Error(`ts-lsp: expected diagnostics response, got kind=${response.kind}`);
    }
    return response.diagnostics;
  }

  return {
    init: (projectRoot) => ack((id) => ({ id, type: 'ts:init', projectRoot })),
    open: (path, text) => ack((id) => ({ id, type: 'ts:open', path, text })),
    update: (path, text) => ack((id) => ({ id, type: 'ts:update', path, text })),
    close: (path) => ack((id) => ({ id, type: 'ts:close', path })),
    invalidate: (path) => ack((id) => ({ id, type: 'ts:invalidate', path })),
    getSemanticDiagnostics: (path) =>
      diagnostics((id) => ({ id, type: 'ts:getSemanticDiagnostics', path })),
    getSyntacticDiagnostics: (path) =>
      diagnostics((id) => ({ id, type: 'ts:getSyntacticDiagnostics', path })),
    getConfigFileDiagnostics: () =>
      diagnostics((id) => ({ id, type: 'ts:getConfigFileDiagnostics' })),
    dispose() {
      if (torn) return;
      torn = true;
      unsubscribe();
      for (const [, waiter] of pending) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('ts-lsp client disposed'));
      }
      pending.clear();
    },
  };
}

function errorFrom(error: { readonly name: string; readonly message: string }): Error {
  const err = new Error(error.message);
  err.name = error.name;
  return err;
}

/** LSP severity (1=Error..4=Hint) → Monaco `MarkerSeverity`. */
function toMarkerSeverity(severity: DiagnosticSeverity): monaco.MarkerSeverity {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return MarkerSeverity.Error;
    case DiagnosticSeverity.Warning:
      return MarkerSeverity.Warning;
    case DiagnosticSeverity.Information:
      return MarkerSeverity.Info;
    case DiagnosticSeverity.Hint:
      return MarkerSeverity.Hint;
    default:
      return MarkerSeverity.Error;
  }
}

/**
 * Map the service's LSP diagnostics to Monaco markers. LSP positions are 0-based
 * (line, character); Monaco markers are 1-based (lineNumber, column). The `+1` on
 * each coordinate is the whole translation. `code`/`source`/`message` carry over.
 */
export function lspToMonacoMarkers(diags: readonly Diagnostic[]): monaco.editor.IMarkerData[] {
  return diags.map((d) => ({
    severity: toMarkerSeverity(d.severity),
    message: d.message,
    startLineNumber: d.range.start.line + 1,
    startColumn: d.range.start.character + 1,
    endLineNumber: d.range.end.line + 1,
    endColumn: d.range.end.character + 1,
    code: d.code === undefined ? undefined : String(d.code),
    source: d.source,
  }));
}
