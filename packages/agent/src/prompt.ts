import { type AgentTool, formatSkillsForSystemPrompt } from '@earendil-works/pi-agent-core';
import { getAgentPromptProfile } from './prompt-profile.ts';
import type { AgentCapabilities, AgentResourceReport, AgentSkill } from './types.ts';

export const PROMPT_PROFILE_ID = getAgentPromptProfile().id;

/** Pi's coding-assistant baseline plus host facts; no task-specific tuning. */
export function systemPrompt(
  root: string,
  tools: readonly AgentTool[],
  capabilities: AgentCapabilities,
  instructions: readonly string[],
  resources?: AgentResourceReport,
): string {
  const profile = getAgentPromptProfile();
  const unavailable = [
    ...(!capabilities.files ? ['file tools'] : []),
    ...(!capabilities.shell ? ['shell'] : []),
    ...(!capabilities.preview ? ['preview'] : []),
    ...(!capabilities.diagnostics ? ['diagnostics'] : []),
    ...(!capabilities.diff ? ['SCM diff'] : []),
  ];
  let prompt = [
    profile.intro,
    `Available tools:\n${tools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')}`,
    profile.guidance,
    'Rifty runs Node-compatible programs in a browser. Use the offered host tools; unsupported shell features fail loudly. Do not assume a full system shell or native binaries. No sudo, apt, brew or native addons. Existing project commands and dependency policy belong to the host.',
    'File tools use project paths. edit_file requires an exact unique old string; apply_patch accepts standard unified diffs without fuzzy matching. File listing/search excludes node_modules, .git and dist; direct file reads remain available.',
    `Tool text is capped to 16 KiB, preserving head/tail and naming truncated bytes. Narrow large reads. ${profile.recovery}`,
    profile.verification,
    `Unavailable host capabilities: ${unavailable.length ? unavailable.join(', ') : 'none'}.`,
    ...(capabilities.notes ?? []),
    `Current date: ${new Date().toISOString().slice(0, 10)}`,
  ].join('\n\n');
  if (resources?.fileAccess === 'unavailable')
    prompt += '\n\nProject resources were not read: host file access is unavailable.';
  const append = instructions.join('\n\n');
  if (append) prompt += `\n\n${append}`;
  if (resources?.contextFiles.length) {
    prompt += '\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n';
    for (const { path, content } of resources.contextFiles)
      prompt += `<project_instructions path="${path}">\n${content}\n</project_instructions>\n\n`;
    prompt += '</project_context>\n';
  }
  if (capabilities.files && resources?.skills.length) {
    // Pi's pinned formatter consumes metadata only; its Skill body is unused.
    const format = formatSkillsForSystemPrompt as (skills: readonly AgentSkill[]) => string;
    const block = format(resources.skills);
    if (block)
      prompt += `\n\n${block.replace('Read the full skill file when the task matches its description.', "Use the read_file tool to load a skill's file when the task matches its description.")}`;
  }
  return `${prompt}\nCurrent working directory: ${root.replace(/\\/g, '/')}\n`;
}
