import type { Endpoint } from '../src/config.ts';

export function catalogEndpoint(baseUrl: string, overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    id: 'scripted',
    name: 'scripted',
    provider: 'bench',
    api: 'openai-completions',
    baseUrl,
    contextWindow: 32768,
    maxTokens: 4096,
    input: ['text'],
    reasoning: true,
    thinking: 'medium',
    temperature: 1,
    samplingParams: { top_p: 0.95 },
    compat: { supportsReasoningEffort: true },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...overrides,
  };
}
