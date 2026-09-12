import { NotImplementedError } from '@riftydev/io';
import type {
  AgentHost,
  AgentSession,
  AgentSessionOptions,
  WorkbenchAgentHostOptions,
} from './types.ts';

export type * from './types.ts';
export type { AgentEvent, AgentMessage, AgentTool, StreamFn } from '@earendil-works/pi-agent-core';
export { Type } from '@earendil-works/pi-ai';

/** Contract+RED boundary; no implementation before its independent checkpoint. */
export function createAgentSession(_options: AgentSessionOptions): AgentSession {
  throw new NotImplementedError('agent.session');
}

export function createWorkbenchAgentHost(_options: WorkbenchAgentHostOptions): AgentHost {
  throw new NotImplementedError('agent.workbench-host');
}

export function createBrowserAgentPreview(_options: {
  readonly url: () => string;
  readonly frame?: () => HTMLIFrameElement;
}): import('./types.ts').AgentPreview {
  throw new NotImplementedError('agent.browser-preview');
}
