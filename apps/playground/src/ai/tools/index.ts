/**
 * The full ADR-0190 tool surface: shell + read_file + write_file + edit_file +
 * apply_patch + list_files + grep + glob + preview_fetch/query/click/type +
 * diagnostics. Names + observable behavior are bench-measured (ADR-0191) —
 * keep them stable.
 */
import type { AiAppContext } from '../app-context.ts';
import type { PromptToolSummary } from '../prompt-profile.ts';
import { buildDiagnosticsTool } from './diagnostics.ts';
import { buildFsTools } from './fs-tools.ts';
import { buildPreviewTools } from './preview-tools.ts';
import { buildShellTool } from './shell.ts';
import type { AiAgentTool, DefinedAiTool } from './tool-def.ts';

export interface AiToolSet {
  readonly tools: AiAgentTool[];
  readonly summaries: PromptToolSummary[];
}

export function buildAgentTools(ctx: AiAppContext): AiToolSet {
  const defined: DefinedAiTool[] = [
    buildShellTool(ctx),
    ...buildFsTools(ctx),
    ...buildPreviewTools(ctx),
    buildDiagnosticsTool(ctx),
  ];
  return {
    tools: defined.map((d) => d.tool),
    summaries: defined.map((d) => ({ name: d.tool.name, snippet: d.snippet })),
  };
}
