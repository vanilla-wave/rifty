/**
 * Typed AgentTool builder: keeps typebox `Static<S>` inference on `execute`
 * while the tool registry stores the erased `AgentTool` shape Pi consumes.
 * Every result funnels through the shared 16 KiB cap (truncate.ts).
 */
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
// typebox comes via Pi's re-export (ADR-0190 decision) — never @sinclair/typebox.
import type { Static, TSchema } from '@earendil-works/pi-ai';
import { capToolText } from '../truncate.ts';

export type AiToolDetails = Record<string, unknown>;
export type AiAgentTool = AgentTool<TSchema, AiToolDetails>;

export interface AiToolSpec<S extends TSchema> {
  readonly name: string;
  readonly label: string;
  /** One-liner reused in the system-prompt tool list (prompt-profile). */
  readonly snippet: string;
  readonly description: string;
  readonly parameters: S;
  readonly execute: (
    params: Static<S>,
    signal?: AbortSignal,
  ) => Promise<AgentToolResult<AiToolDetails>>;
}

export interface DefinedAiTool {
  readonly tool: AiAgentTool;
  readonly snippet: string;
}

export function defineAiTool<S extends TSchema>(spec: AiToolSpec<S>): DefinedAiTool {
  const tool: AgentTool<S, AiToolDetails> = {
    name: spec.name,
    label: spec.label,
    description: spec.description,
    parameters: spec.parameters,
    execute: (_toolCallId, params, signal) => spec.execute(params, signal),
  };
  // Erase the schema generic for the registry: Pi validates args against
  // `parameters` before calling `execute`, so the narrower param type is safe
  // (the unchecked contravariant assignment TS rejects cannot occur at runtime).
  return { tool: tool as unknown as AiAgentTool, snippet: spec.snippet };
}

/** Build a size-capped text result; the cap applied is recorded in `details`. */
export function cappedResult(
  text: string,
  details: AiToolDetails = {},
): AgentToolResult<AiToolDetails> {
  const capped = capToolText(text);
  return {
    content: [{ type: 'text', text: capped.text }],
    details: { ...details, truncatedBytes: capped.truncatedBytes },
  };
}
