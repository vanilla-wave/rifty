import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Config, Endpoint } from '../config.ts';
import type { FileTree } from '../files.ts';
import type { JudgeContext } from '../judge/context.ts';
import type { Metrics } from '../metrics.ts';
import type { Task } from '../tasks.ts';
export type Lane = 'rifty' | 'rifty-no-coi' | 'local-reference' | 'native-codex';
export interface Observation extends Metrics {
  agentStatus: string;
  turns: number;
  toolCalls: number;
  usage: unknown;
  trace: unknown;
  terminalTail: string;
  unavailableMetrics?: (keyof Metrics)[];
  error?: string;
}
export interface Prepared {
  context: BrowserContext;
  page: Page;
  before: FileTree;
  workspace?: string;
  codexVersion?: string;
  apply(files: FileTree): Promise<void>;
  command(line: string): Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
  run(): Promise<Observation>;
  preview(): Promise<JudgeContext>;
  snapshot(): Promise<FileTree>;
  close(): Promise<void>;
}
export interface Input {
  browser: Browser;
  task: Task;
  config: Config;
  endpoint: Endpoint;
  key?: string;
  dir: string;
  playgroundUrl: string;
  noCoiUrl?: string;
  signal?: AbortSignal;
}
