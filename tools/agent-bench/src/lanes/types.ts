/**
 * Lane adapter contract — one suite, two implementations (ADR-0191): the
 * runner is lane-agnostic and only ever talks to this interface.
 */
import type { Page } from '@playwright/test';
import type { BenchTask } from '../tasks.ts';

export type LaneId = 'rifty' | 'local-reference';

/** Outcome of waiting for the agent run; judging turns 'done' into pass/fail. */
export type RunOutcome = 'done' | 'budget-exceeded';

/** A page the judge may navigate freely; `close()` after the verdict. */
export interface JudgePageHandle {
  readonly page: Page;
  close(): Promise<void>;
}

export interface LaneTrace {
  /** Completed model turns observed during the run. */
  readonly turns: number;
  /** Tool executions observed during the run. */
  readonly toolCalls: number;
  /** Artifact name → absolute file path under the runDir (events JSONL, session, logs). */
  readonly artifacts: Record<string, string>;
  /** Agent process exit code (local lane); null when not applicable / killed. */
  readonly agentExitCode: number | null;
  /** Which budget tripped when outcome is 'budget-exceeded'; null otherwise. */
  readonly budgetReason: string | null;
}

/** A prepared cold-start run: fresh workspace + live preview, agent not yet prompted. */
export interface PreparedRun {
  /** Project root: fs path (local lane) / VFS workspace label (rifty lane). */
  readonly workspace: string;
  readonly previewUrl: string;
  /** Deliver the prompt verbatim (parity: byte-identical across lanes) and start the agent. */
  sendPrompt(text: string): Promise<void>;
  /** Resolve when the agent run ends or a limit (run/tool timeout, max tool calls) trips. */
  waitDone(): Promise<RunOutcome>;
  collectTrace(): Promise<LaneTrace>;
  /** Tail of the run's terminal output (dev server + agent stderr for the local lane). */
  terminalTail(): Promise<string>;
  /** Diff of the workspace vs the pre-run baseline (includes untracked files). */
  gitDiff(): Promise<string>;
  /** Read a workspace file (judge-facing). */
  readFile(relPath: string): Promise<string>;
  /**
   * Lane-provided judge page. The rifty preview is served by the run's OWN
   * browser context (service worker + workspace owner live there), so its
   * judge page must come from that context; absent → the runner uses its own
   * chromium (local lane).
   */
  createJudgePage?(): Promise<JudgePageHandle>;
  /** Kill leftover processes / drop the temp workspace. Artifacts in runDir survive. */
  cleanup(): Promise<void>;
}

export interface LaneAdapter {
  readonly id: LaneId;
  /** Prompt profile this lane runs (recorded in the report header, ADR-0190). */
  readonly promptProfile: string;
  /** Version facts for the report header (pi version, node version, ...). */
  laneVersions(): Promise<Record<string, string>>;
  /** Cold start: fresh workspace per run; artifacts go under `runDir`. */
  prepare(task: BenchTask, runDir: string): Promise<PreparedRun>;
  /** Release lane-level resources (browser, spawned playground server). */
  dispose?(): Promise<void>;
}
