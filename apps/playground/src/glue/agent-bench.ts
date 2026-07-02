/**
 * agent-bench hook: external validation harness only. Not public API.
 *
 * ADR-0191: the ONLY product-side surface for the external agent-bench is this
 * observation namespace, installed as `globalThis.__riftyAgentBench` when the
 * page loads with `?agentBench=1` (parseAgentBenchFlag). It grants the agent
 * nothing — `seed` writes through the same acked owner path the explorer
 * uses; `exportTrace`/`sessionMetadata` only observe the live AI session.
 * Without the flag the namespace is never installed.
 */

export interface AgentBenchSessionMetadata {
  readonly promptProfile: string;
  /** Model id only — never the apiKey. */
  readonly model: string;
  readonly limits: { readonly maxToolCalls: number; readonly runTimeoutMs: number };
}

/** Registered by the AI chat panel for the CURRENT session (null on reset). */
export interface AgentBenchSessionBridge {
  exportTrace(): Promise<unknown>;
  sessionMetadata(): AgentBenchSessionMetadata;
}

export interface AgentBenchHost {
  /** Acked pre-run file overlay (workspace-relative paths → text). */
  seedFiles(files: Record<string, string>): Promise<void>;
  /** Active starter id (bench report header). */
  presetId(): string;
}

export interface AgentBenchNamespace {
  seed(files: Record<string, string>): Promise<void>;
  /** The SAME object the "Export session" button downloads. */
  exportTrace(): Promise<unknown>;
  sessionMetadata(): AgentBenchSessionMetadata & { readonly presetId: string };
}

export interface AgentBenchRegistrar {
  registerSession(bridge: AgentBenchSessionBridge | null): void;
}

export function installAgentBench(host: AgentBenchHost): AgentBenchRegistrar {
  let session: AgentBenchSessionBridge | null = null;

  function requireSession(): AgentBenchSessionBridge {
    if (session === null) {
      throw new Error('__riftyAgentBench: no AI session — open AI mode and send a prompt first');
    }
    return session;
  }

  const namespace: AgentBenchNamespace = {
    seed: (files) => host.seedFiles(files),
    // async so a missing session REJECTS (awaitable by the harness), never
    // throws synchronously out of a promise-shaped API.
    exportTrace: async () => requireSession().exportTrace(),
    sessionMetadata: () => ({ ...requireSession().sessionMetadata(), presetId: host.presetId() }),
  };
  // agent-bench hook: external validation harness only. Not public API.
  (
    globalThis as typeof globalThis & { __riftyAgentBench?: AgentBenchNamespace }
  ).__riftyAgentBench = namespace;

  return {
    registerSession(bridge) {
      session = bridge;
    },
  };
}
