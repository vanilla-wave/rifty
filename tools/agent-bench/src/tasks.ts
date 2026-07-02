/**
 * Task set `task-set-v1` (docs/backlog/distribution/agent-bench-harness.md).
 * Layout per task: tasks/<slug>/prompt.md (+ optional seed/, judge.ts).
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type FileTree, readSeedSpec } from './seed.ts';
import type { TemplateId } from './templates.ts';

export interface BenchTask {
  readonly slug: string;
  readonly templateId: TemplateId;
  /** Absolute path of tasks/<slug>/ (judge.ts lives here). */
  readonly taskDir: string;
  /**
   * Exact prompt text delivered to BOTH lanes (parity: byte-identical). The
   * single editor-enforced trailing newline of prompt.md is stripped at LOAD
   * time (a chat input cannot contain a trailing submit-newline); after this
   * one shared normalization the string reaches each lane verbatim.
   */
  readonly prompt: string;
  readonly seed: FileTree;
}

/** Pinned task → template mapping; the Node control task runs over hono-api (ADR-0191). */
export const TASK_TEMPLATES: Record<string, TemplateId> = {
  'add-search': 'react-vite',
  'url-filters': 'react-vite',
  'fix-date-sort': 'react-vite',
  'new-issue-form': 'react-vite',
  'node-endpoint': 'hono-api',
};

export const ALL_TASK_SLUGS = Object.keys(TASK_TEMPLATES);

export function tasksRoot(): string {
  return fileURLToPath(new URL('../tasks', import.meta.url));
}

export function loadTask(slug: string): BenchTask {
  const templateId = TASK_TEMPLATES[slug];
  if (!templateId) {
    throw new Error(`agent-bench: unknown task '${slug}' (known: ${ALL_TASK_SLUGS.join(', ')})`);
  }
  const taskDir = join(tasksRoot(), slug);
  statSync(taskDir); // loud ENOENT if the task dir is missing
  const raw = readFileSync(join(taskDir, 'prompt.md'), 'utf8');
  const prompt = raw.replace(/\n$/, '');
  if (prompt.length === 0) throw new Error(`agent-bench: tasks/${slug}/prompt.md is empty`);
  statSync(join(taskDir, 'judge.ts')); // every task MUST ship a judge
  return { slug, templateId, taskDir, prompt, seed: readSeedSpec(taskDir) };
}

export function loadTasks(slugs?: string[]): BenchTask[] {
  return (slugs ?? ALL_TASK_SLUGS).map(loadTask);
}
