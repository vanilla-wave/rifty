import { type Context, getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai';

/** Pi 1.x carries prompt and tools as system messages; tests read the collapsed view. */
export function contextView(context: Context): Context {
  return {
    systemPrompt: getCurrentSystemPrompt(context.messages),
    tools: getCurrentTools(context.messages),
    messages: structuredClone(context.messages.filter(({ role }) => role !== 'system')),
  };
}
