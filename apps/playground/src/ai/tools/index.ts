/**
 * PASS-1 tool surface (ADR-0190): shell + read_file + write_file + edit_file +
 * apply_patch + list_files + grep + glob. The preview_* and diagnostics tools
 * are PASS 2 of docs/backlog/distribution/ai-mode-playground.md — absent from
 * the registry (never stubbed).
 */
import type { AiAppContext } from '../app-context.ts';
import type { PromptToolSummary } from '../prompt-profile.ts';
import { buildFsTools } from './fs-tools.ts';
import { buildShellTool } from './shell.ts';
import type { AiAgentTool, DefinedAiTool } from './tool-def.ts';

export interface AiToolSet {
  readonly tools: AiAgentTool[];
  readonly summaries: PromptToolSummary[];
}

export function buildAgentTools(ctx: AiAppContext): AiToolSet {
  const defined: DefinedAiTool[] = [buildShellTool(ctx), ...buildFsTools(ctx)];
  return {
    tools: defined.map((d) => d.tool),
    summaries: defined.map((d) => ({ name: d.tool.name, snippet: d.snippet })),
  };
}
