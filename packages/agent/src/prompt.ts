import type { AgentTool } from '@earendil-works/pi-agent-core';
import { formatSkillsForPrompt } from './pi-cli/skills.ts';
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
  recipe = true,
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
    'Rifty runs Node-compatible programs in a browser. Use the offered host tools. The shell is a bash subset: heredocs, here-strings, compound commands (if/for/while/case, {…}, (…), functions), $(…)/backticks, process substitution and fd redirects such as 2> or 2>&1 fail with NotImplementedError; other bash features may be missing or differ. There is no python or other native binary: use node and npm packages. No sudo, apt, brew or native addons.',
    'File tools use project paths. edit_file requires an exact unique old string; apply_patch accepts standard unified diffs without fuzzy matching. File listing/search excludes node_modules, .git and dist; direct file reads remain available.',
    `Built-in Rifty tools prefix their output with a JSON budget receipt. Tool text is capped to 16 KiB, preserving head/tail and naming truncated bytes. Narrow large reads. ${profile.recovery}`,
    profile.verification,
    ...(recipe ? [profile.recipe] : []),
    `Unavailable host capabilities: ${unavailable.length ? unavailable.join(', ') : 'none'}.`,
    ...(capabilities.notes ?? []),
    `Current date: ${new Date().toISOString().slice(0, 10)}`,
  ].join('\n\n');
  if (resources?.fileAccess === 'unavailable')
    prompt += '\n\nProject resources were not read: host file access is unavailable.';
  const append = instructions.join('\n\n');
  if (append) prompt += `\n\n${append}`;
  if (resources?.contextFiles.length) {
    // CLI 1.x `project_context` section bytes.
    const files = resources.contextFiles.map(
      ({ path, content }) =>
        `<project_instructions path="${path}">\n${content}\n</project_instructions>`,
    );
    prompt += `\n\n<project_context>\n${['Project-specific instructions and guidelines:', ...files].join('\n\n')}\n</project_context>`;
  }
  if (capabilities.files && resources?.skills.length) {
    const block = formatSkillsForPrompt(resources.skills);
    if (block) prompt += block.replace('Use the read tool', 'Use the read_file tool');
  }
  return `${prompt}\nCurrent working directory: ${root.replace(/\\/g, '/')}\n`;
}
