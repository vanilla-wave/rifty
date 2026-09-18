import type { AgentEvent, AgentMessage, AgentTool, StreamFn } from '@earendil-works/pi-agent-core';
import type { ProviderRequestOptions } from '@earendil-works/pi-ai';
import type { SandboxProjectOptions, ToolchainSandbox } from '@riftydev/sdk';
import type { ProjectSession, ProjectTerminal } from '@riftydev/workbench';
import type { PlaygroundSessionTools } from '@riftydev/workbench/playground';

export interface AgentFiles {
  read(path: string): Promise<string>;
  /** Entries carry `${path}/${name}`; resource discovery reports and skips other entries. */
  list(path: string): Promise<readonly { readonly path: string; readonly kind: 'file' | 'dir' }[]>;
  /** Host owns read/transform/write. Workbench retains the read's CAS version. */
  change(path: string, transform: (current: string | null) => string | null): Promise<void>;
}

export interface AgentCommandResult {
  readonly status: 'exited' | 'cancelled' | 'failed';
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly worker?: 'retained' | 'replaced' | 'terminated';
  readonly effects?: unknown;
  readonly error?: unknown;
}

export interface AgentPreview {
  fetch(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ readonly status: number; readonly body: string }>;
  query?(selector: string): Promise<unknown>;
  click?(selector: string): Promise<unknown>;
  type?(selector: string, text: string): Promise<unknown>;
}

export interface AgentCapabilities {
  readonly files?: AgentFiles;
  readonly shell?: (
    command: string,
    signal: AbortSignal | undefined,
    onOutput: (chunk: string, stream: 'stdout' | 'stderr') => void,
  ) => Promise<AgentCommandResult>;
  readonly preview?: AgentPreview;
  readonly diagnostics?: (path: string) => Promise<unknown>;
  readonly diff?: () => Promise<unknown>;
  readonly notes?: readonly string[];
}

export interface AgentHost {
  readonly root: string;
  /** Read before each model turn; the host owns mode changes. */
  capabilities(): AgentCapabilities;
  close(): Promise<void>;
}

export interface WorkbenchAgentHostOptions {
  readonly session: ProjectSession<unknown>;
  /** Supply the visible host terminal, or let the adapter own a dedicated one. */
  readonly terminal?: ProjectTerminal;
  readonly companion?: PlaygroundSessionTools;
  readonly preview?: () => AgentPreview | undefined;
}

export interface SandboxAgentHostOptions {
  readonly sandbox: ToolchainSandbox;
  readonly project: SandboxProjectOptions;
  /** Host owns startBin/stopResident; report preview while a resident owns the Worker. */
  readonly mode: () => 'commands' | 'preview';
  readonly preview?: () => AgentPreview | undefined;
}

export interface AgentSettings {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
}

export interface AgentRunLimits {
  readonly maxToolCalls?: number;
  readonly runTimeoutMs?: number;
}

export interface AgentContextFile {
  readonly path: string;
  readonly content: string;
}

export interface AgentSkill {
  readonly name: string;
  readonly description: string;
  readonly filePath: string;
  readonly disableModelInvocation?: boolean;
}

export interface AgentResourceDiagnostic {
  readonly type: 'warning' | 'collision';
  readonly path: string;
  readonly message: string;
  readonly collision?: {
    readonly resourceType: 'skill';
    readonly name: string;
    readonly winnerPath: string;
    readonly loserPath: string;
  };
}

export interface AgentResourceReport {
  readonly fileAccess: 'available' | 'unavailable';
  readonly contextFiles: readonly AgentContextFile[];
  readonly skills: readonly AgentSkill[];
  readonly diagnostics: readonly AgentResourceDiagnostic[];
  readonly unsupported: readonly { readonly kind: string; readonly path: string }[];
}

export interface AgentSessionCommonOptions extends AgentRunLimits {
  readonly host: AgentHost;
  readonly tools?: readonly AgentTool[];
  readonly instructions?: readonly string[];
  readonly contextFiles?: boolean;
  readonly skills?: boolean;
  readonly userContextFiles?: readonly AgentContextFile[];
  /** Locations must be readable with the host's rooted read_file tool. */
  readonly userSkills?: readonly AgentSkill[];
}

export type AgentSessionOptions = AgentSessionCommonOptions &
  (
    | {
        readonly settings: AgentSettings;
        readonly fetch?: ProviderRequestOptions['fetch'];
        readonly streamFn?: never;
      }
    | {
        readonly streamFn: StreamFn;
        readonly settings?: never;
        readonly fetch?: never;
      }
  );

export type AgentStatus = 'idle' | 'running' | 'done' | 'error' | 'aborted' | 'budget-exceeded';

export type AgentSessionEvent =
  | { readonly type: 'resources'; readonly report: AgentResourceReport }
  | { readonly type: 'agent'; readonly event: AgentEvent }
  | { readonly type: 'status'; readonly status: AgentStatus; readonly detail?: string }
  | {
      readonly type: 'capabilities';
      readonly tools: readonly string[];
      readonly notes: readonly string[];
    }
  | {
      readonly type: 'output';
      readonly command: string;
      readonly chunk: string;
      readonly stream: 'stdout' | 'stderr';
    };

export interface AgentTrace {
  readonly version: 1;
  readonly profile: string;
  readonly config:
    | {
        readonly transport: 'openai-compatible';
        readonly baseUrl: string;
        readonly model: string;
        readonly maxToolCalls: number;
        readonly runTimeoutMs: number;
      }
    | {
        readonly transport: 'custom';
        readonly maxToolCalls: number;
        readonly runTimeoutMs: number;
      };
  readonly transcript: readonly AgentMessage[];
  readonly events: readonly { readonly at: number; readonly event: AgentSessionEvent }[];
  readonly status: AgentStatus;
  readonly timings: readonly { readonly startedAt: number; readonly endedAt: number }[];
  readonly usage: { readonly input: number; readonly output: number; readonly totalTokens: number };
  readonly finalDiff: unknown;
}

export interface AgentSession {
  status(): AgentStatus;
  detail(): string | undefined;
  /** A new prompt continues the retained history, including prior tool results. */
  send(prompt: string): Promise<void>;
  /** Re-read resources while idle; retains conversation history. */
  reload(): Promise<AgentResourceReport>;
  stop(): Promise<void>;
  reset(): void;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  exportTrace(): Promise<AgentTrace>;
  dispose(): Promise<void>;
}
