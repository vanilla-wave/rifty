/**
 * Versioned prompt profile (ADR-0190): Pi baseline + rifty adapter block, NO
 * benchmark tuning — bench deltas must measure the environment, not prompt
 * drift. The local bench reference (Pi's own CLI) runs the same profile.
 *
 * Baseline text vendored from `@earendil-works/pi-coding-agent`
 * `dist/core/system-prompt.js` (MIT, © Mario Zechner / earendil-works/pi),
 * v0.80.3. The pi-docs section (local README/docs/examples paths of the pi
 * CLI install) is omitted — those files do not exist in the browser; the
 * tool list and guidelines are parameterized exactly like upstream.
 */

export const PROMPT_PROFILE_ID = 'pi-baseline+rifty-adapter-v1';

export interface PromptToolSummary {
  readonly name: string;
  /** One-line snippet shown in the "Available tools" list (upstream contract). */
  readonly snippet: string;
}

function isoDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** The rifty adapter block: tool mapping + browser-environment facts + preview habit. */
function riftyAdapterBlock(): string {
  return `Environment (rifty — Node.js in the browser):
- You are working inside rifty, a browser-based Node.js-compatible runtime. The workspace, shell, npm and dev server all run inside this browser tab; nothing touches the user's machine.
- The shell tool runs real commands in a dedicated "AI agent" terminal session, visible to the user. node, npm and npx work; there is no sudo, no apt/brew, and no network access beyond the npm registry.
- File tools (read_file, write_file, edit_file, apply_patch, list_files, grep, glob) operate on the open workspace only; paths resolve against the workspace root and may not escape it. node_modules is not listed or searchable through these tools — use the shell for anything under node_modules.
- edit_file replaces one EXACT, UNIQUE occurrence of the old string — no fuzzy matching. apply_patch takes a standard unified diff and rejects on any hunk mismatch.
- Tool results are capped at 16 KiB with an explicit [truncated N bytes] marker; narrow your reads (offset/limit, tighter grep) instead of re-running the same call.
- A dev server may already be running and hot-reloads on file writes; do not start a second one. After changing user-visible behavior, verify the result (run the code, or check the dev server output) before declaring it done.`;
}

/**
 * Build the profile's system prompt. Structure and always-on guidelines
 * follow the Pi baseline verbatim; rifty facts arrive only via the adapter
 * block and the tool list.
 */
export function buildSystemPrompt(options: {
  readonly cwd: string;
  readonly tools: readonly PromptToolSummary[];
  readonly now?: Date;
}): string {
  const toolsList =
    options.tools.length > 0
      ? options.tools.map((tool) => `- ${tool.name}: ${tool.snippet}`).join('\n')
      : '(none)';
  // Upstream always-on guidelines (system-prompt.js `addGuideline` tail).
  const guidelines = [
    '- Be concise in your responses',
    '- Show file paths clearly when working with files',
  ].join('\n');

  let prompt = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines}`;

  prompt += `\n\n${riftyAdapterBlock()}`;
  prompt += `\nCurrent date: ${isoDate(options.now ?? new Date())}`;
  prompt += `\nCurrent working directory: ${options.cwd}`;
  return prompt;
}
