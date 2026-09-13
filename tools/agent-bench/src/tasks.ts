import { readFile } from 'node:fs/promises';
import { HONO_API_TEMPLATE } from '../../../apps/playground/src/templates/hono-api.ts';
import { resolveBootstrapConfig } from '../../../apps/playground/src/templates/project-spec.ts';
import { REACT_VITE_TEMPLATE } from '../../../apps/playground/src/templates/react-vite/index.ts';
import { judge as search } from '../tasks/add-search/judge.ts';
import { judge as date } from '../tasks/fix-date-sort/judge.ts';
import { judge as form } from '../tasks/new-issue-form/judge.ts';
import { judge as node } from '../tasks/node-endpoint/judge.ts';
import { judge as filters } from '../tasks/url-filters/judge.ts';
import type { FileTree } from './files.ts';
import type { TaskJudge } from './judge/context.ts';
export interface Task {
  id: string;
  prompt: string;
  files: FileTree;
  preset: string;
  port: number;
  judge: TaskJudge;
  node: boolean;
}
export const taskIds = [
  'fix-date-sort',
  'add-search',
  'url-filters',
  'new-issue-form',
  'node-endpoint',
] as const;
export async function loadTasks(): Promise<Task[]> {
  const judges = [date, search, filters, form, node];
  return Promise.all(
    taskIds.map(async (id, i) => {
      const node = id === 'node-endpoint';
      const spec = node ? HONO_API_TEMPLATE : REACT_VITE_TEMPLATE;
      const config = resolveBootstrapConfig(spec, spec.defaultPort, '');
      const files = Object.fromEntries(
        Object.entries(config.seedFiles)
          .map(([path, text]) => [path.replace(/^\//, ''), text])
          .filter(([path]) => !path!.startsWith('.git/')),
      ) as FileTree;
      return {
        id,
        prompt: await readFile(new URL(`../tasks/${id}/prompt.md`, import.meta.url), 'utf8'),
        files,
        preset: node ? 'hono-api' : 'real-vite',
        port: spec.defaultPort,
        judge: judges[i]!,
        node,
      };
    }),
  );
}
