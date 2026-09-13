import type { AgentTool } from '@earendil-works/pi-agent-core';
import { getAgentPromptProfile } from './prompt-profile.ts';
import type { AgentCapabilities } from './types.ts';

export const PROMPT_PROFILE_ID = getAgentPromptProfile().id;

/** Pi's coding-assistant baseline plus host facts; no task-specific tuning. */
export function systemPrompt(
  root: string,
  tools: readonly AgentTool[],
  capabilities: AgentCapabilities,
  instructions: readonly string[],
): string {
  const profile = getAgentPromptProfile();
  const unavailable = [
    ...(!capabilities.files ? ['file tools'] : []),
    ...(!capabilities.shell ? ['shell'] : []),
    ...(!capabilities.preview ? ['preview'] : []),
    ...(!capabilities.diagnostics ? ['diagnostics'] : []),
    ...(!capabilities.diff ? ['SCM diff'] : []),
  ];
  return [
    profile.intro,
    `Available tools:\n${tools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')}`,
    profile.guidance,
    'Rifty runs Node-compatible programs in a browser. Use the offered host tools; unsupported shell features fail loudly. Do not assume a full system shell or native binaries. No sudo, apt, brew or native addons. Existing project commands and dependency policy belong to the host.',
    'File tools use project paths. edit_file requires an exact unique old string; apply_patch accepts standard unified diffs without fuzzy matching. File listing/search excludes node_modules, .git and dist; direct file reads remain available.',
    `Tool text is capped to 16 KiB, preserving head/tail and naming truncated bytes. Narrow large reads. ${profile.recovery}`,
    profile.verification,
    `Unavailable host capabilities: ${unavailable.length ? unavailable.join(', ') : 'none'}.`,
    ...(capabilities.notes ?? []),
    `Current working directory: ${root}`,
    `Current date: ${new Date().toISOString().slice(0, 10)}`,
    ...instructions,
  ].join('\n\n');
}
