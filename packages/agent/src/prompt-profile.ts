import { NotImplementedError } from '@riftydev/vfs';

/** Common coding policy; host/tool facts are assembled separately by each consumer. */
export interface AgentPromptProfile {
  readonly id: string;
  readonly intro: string;
  readonly guidance: string;
  readonly recovery: string;
  readonly verification: string;
}

export function getAgentPromptProfile(): AgentPromptProfile {
  throw new NotImplementedError('agent.prompt-profile');
}
