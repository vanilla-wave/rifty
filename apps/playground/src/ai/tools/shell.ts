/**
 * Shell tool (ADR-0190): runs one line in the dedicated, user-visible
 * "AI agent" terminal session over the SAME owner pty path a typed command
 * uses (parity case: identical stdout/exit code). Serialization + capture
 * live app-side in the context adapter; a non-zero exit is a RESULT (exit
 * code + output), not a tool error — infra failures still throw.
 */
// typebox comes via Pi's re-export (ADR-0190 decision) — never @sinclair/typebox.
import { Type } from '@earendil-works/pi-ai';
import type { AiAppContext } from '../app-context.ts';
import { type DefinedAiTool, cappedResult, defineAiTool } from './tool-def.ts';

export function buildShellTool(ctx: AiAppContext): DefinedAiTool {
  return defineAiTool({
    name: 'shell',
    label: 'Shell',
    snippet: 'run a command in the visible "AI agent" terminal session',
    description:
      'Run one shell line in the workspace (node, npm, npx and the rifty shell built-ins work; ' +
      'no sudo, no network beyond the npm registry). The command runs in a dedicated "AI agent" ' +
      'terminal session visible to the user; commands are serialized. Returns the exit code and ' +
      'the captured output (capped at 16 KiB).',
    parameters: Type.Object({
      command: Type.String({ description: 'The shell line to run' }),
    }),
    execute: async (params, signal) => {
      const { exitCode, output } = await ctx.runShellLine(params.command, signal);
      return cappedResult(`exit code: ${exitCode}\n${output}`, {
        command: params.command,
        exitCode,
      });
    },
  });
}
