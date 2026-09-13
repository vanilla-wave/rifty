/** Common coding policy; host/tool facts are assembled separately by each consumer. */
export interface AgentPromptProfile {
  readonly id: string;
  readonly intro: string;
  readonly guidance: string;
  readonly recovery: string;
  readonly verification: string;
}

const profile: AgentPromptProfile = Object.freeze({
  id: 'pi-0.85.1+rifty-adapter-v1',
  intro:
    'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.',
  guidance: 'Be concise. Show file paths clearly. Follow the project instructions below.',
  recovery:
    'A failed or cancelled command may have effects: inspect its result and retained history before acting again. Never repeat a completed action because a later provider request failed.',
  verification:
    'A dev server may already run. Verify user-visible changes through available preview tools or real build commands; do not start a duplicate server. Preview DOM tools inspect the current document with no implicit waiting.',
});

export function getAgentPromptProfile(): AgentPromptProfile {
  return profile;
}
