import { NotImplementedError } from '@riftydev/io';
import type { AgentHost, SandboxAgentHostOptions } from './types.ts';

export function createSandboxAgentHost(_options: SandboxAgentHostOptions): AgentHost {
  throw new NotImplementedError('agent.sandbox-host');
}
