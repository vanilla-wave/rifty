import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  CompactionSettings,
} from '@earendil-works/pi-agent-core';
import type {
  Api,
  AssistantMessage,
  ImageContent,
  Model,
  Models,
  RetryPolicy,
  SimpleStreamOptions,
  Usage,
} from '@earendil-works/pi-ai';
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
  /** Absent fields inherit project; present undefined removes the common restriction. */
  readonly policies?: {
    readonly files?: Omit<SandboxProjectOptions, 'root'>;
    readonly shell?: Omit<SandboxProjectOptions, 'root'>;
  };
  /** Host owns startBin/stopResident; report preview while a resident owns the Worker. */
  readonly mode: () => 'commands' | 'preview';
  readonly preview?: () => AgentPreview | undefined;
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
  /** Native history, copied at creation. Incomplete tool pairs throw TypeError. */
  readonly initialMessages?: readonly AgentMessage[];
  readonly host: AgentHost;
  readonly tools?: readonly AgentTool[];
  readonly instructions?: readonly string[];
  readonly contextFiles?: boolean;
  readonly skills?: boolean;
  readonly userContextFiles?: readonly AgentContextFile[];
  /** Locations must be readable with the host's rooted read_file tool. */
  readonly userSkills?: readonly AgentSkill[];
}

export interface AgentSessionOptions extends AgentSessionCommonOptions {
  readonly recipe?: boolean;
  readonly retry?: Partial<RetryPolicy>;
  readonly compaction?: Partial<CompactionSettings>;
  readonly models: Models;
  readonly model: string;
  readonly modelOptions?: Readonly<
    Record<string, Pick<SimpleStreamOptions, 'reasoning' | 'temperature' | 'samplingParams'>>
  >;
  /**
   * Exact strings masked as `[redacted]` in provider error text at ingress, besides built-in
   * provider apiKeys; assistant content stays raw. Catalog headers are not implicit secrets.
   * Copied at creation.
   */
  readonly secrets?: readonly string[];
}

export type AgentStatus =
  | 'idle'
  | 'running'
  | 'done'
  | 'error'
  | 'aborted'
  | 'budget-exceeded'
  | 'context-exceeded';

export type AgentSessionEvent =
  | {
      readonly type: 'repeated-call';
      readonly toolName: string;
      readonly count: 3;
      readonly message: string;
    }
  | {
      readonly type: 'retry';
      readonly phase: 'start' | 'end';
      readonly source: 'assistant' | 'summary';
      /** Discarded assistant attempt, retained for native compaction provenance. */
      readonly message?: AssistantMessage;
      readonly attempt: number;
      readonly maxAttempts?: number;
      readonly delayMs?: number;
      readonly success?: boolean;
      readonly errorMessage?: string;
    }
  | {
      readonly type: 'compaction';
      readonly phase: 'start' | 'end';
      readonly reason: 'threshold' | 'overflow';
      readonly source: 'usage' | 'estimate';
      readonly tokensBefore: number;
      readonly tokensAfter?: number;
      readonly success?: boolean;
      readonly aborted?: boolean;
      readonly errorMessage?: string;
      readonly usage?: Usage;
      readonly summary?: AgentMessage;
      readonly retainedMessageCount?: number;
    }
  | { readonly type: 'model'; readonly model: string; readonly provider: string }
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
  readonly config: Omit<Model<Api>, 'id' | 'headers'> & {
    readonly model: string;
    readonly transport: 'openai-compatible' | 'custom';
    readonly thinking: string;
    readonly temperature?: number;
    readonly recipe: boolean;
    readonly retry: RetryPolicy;
    readonly compaction: CompactionSettings;
    readonly maxToolCalls: number;
    readonly runTimeoutMs: number;
  };
  readonly transcript: readonly AgentMessage[];
  /** Number of messages admitted at creation; compaction may replace them. Reset clears it. */
  readonly restoredMessageCount: number;
  readonly events: readonly { readonly at: number; readonly event: AgentSessionEvent }[];
  readonly status: AgentStatus;
  readonly timings: readonly { readonly startedAt: number; readonly endedAt: number }[];
  readonly usage: { readonly input: number; readonly output: number; readonly totalTokens: number };
  readonly finalDiff: unknown;
}

export interface AgentSession {
  setModel(id: string): void;
  status(): AgentStatus;
  detail(): string | undefined;
  /** A new prompt continues the retained history, including prior tool results. */
  send(prompt: string, images?: readonly ImageContent[]): Promise<void>;
  /** Re-read resources while idle; retains conversation history. */
  reload(): Promise<AgentResourceReport>;
  stop(): Promise<void>;
  reset(): void;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  exportTrace(): Promise<AgentTrace>;
  dispose(): Promise<void>;
}
