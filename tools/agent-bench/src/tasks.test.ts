import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_TASK_SLUGS, loadTask, loadTasks, tasksRoot } from './tasks.ts';

describe('task-set-v1', () => {
  it('contains exactly the 5 pinned tasks', () => {
    expect(ALL_TASK_SLUGS.sort()).toEqual(
      ['add-search', 'fix-date-sort', 'new-issue-form', 'node-endpoint', 'url-filters'].sort(),
    );
  });

  it('loads every task with prompt, template and judge', () => {
    for (const task of loadTasks()) {
      expect(task.prompt.length).toBeGreaterThan(0);
      expect(['react-vite', 'hono-api']).toContain(task.templateId);
    }
  });

  it('node control task runs over hono-api, the rest over react-vite', () => {
    expect(loadTask('node-endpoint').templateId).toBe('hono-api');
    for (const slug of ALL_TASK_SLUGS.filter((s) => s !== 'node-endpoint')) {
      expect(loadTask(slug).templateId).toBe('react-vite');
    }
  });

  it('task.prompt is byte-identical to prompt.md minus the single trailing newline', () => {
    for (const slug of ALL_TASK_SLUGS) {
      const raw = readFileSync(join(tasksRoot(), slug, 'prompt.md'));
      const task = loadTask(slug);
      const expected = raw.toString('utf8').replace(/\n$/, '');
      expect(Buffer.from(task.prompt, 'utf8').equals(Buffer.from(expected, 'utf8')), slug).toBe(
        true,
      );
      // prompts stay user-voice: no tool docs, no harness vocabulary
      expect(task.prompt).not.toMatch(/judge|playwright|agent-bench/i);
    }
  });

  it('rejects unknown slugs loudly', () => {
    expect(() => loadTask('nope')).toThrow(/unknown task 'nope'/);
  });
});
