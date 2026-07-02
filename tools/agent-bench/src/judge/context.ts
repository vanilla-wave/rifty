/**
 * Lane-agnostic judge contract: one judge.ts per task executes UNMODIFIED
 * against both lanes' contexts (ADR-0191 — no judge DSL). Judges assert
 * user-observable outcomes and must carry evidence strings on failure.
 */
import type { Page } from '@playwright/test';

export interface JudgeContext {
  readonly previewUrl: string;
  /** Fresh Playwright page pointed at nothing; judge navigates it itself. */
  readonly page: Page;
  readFile(relPath: string): Promise<string>;
  gitDiff(): Promise<string>;
  terminalTail(): Promise<string>;
}

export interface JudgeProbe {
  readonly name: string;
  readonly pass: boolean;
  /** Human-readable evidence — REQUIRED, especially on failure. */
  readonly evidence: string;
}

export interface JudgeVerdict {
  readonly pass: boolean;
  readonly probes: JudgeProbe[];
}

export type TaskJudge = (ctx: JudgeContext) => Promise<JudgeVerdict>;

/** All probes must pass. */
export function verdictFromProbes(probes: JudgeProbe[]): JudgeVerdict {
  return { pass: probes.length > 0 && probes.every((p) => p.pass), probes };
}
