import type { Task } from '../src/tasks.ts';

/** Dependency-free real Node preview; no registry, model, or Rifty host required. */
export function lifecycleTask(): Task {
  return {
    id: 'lifecycle',
    prompt: 'Lifecycle fault control',
    preset: 'node',
    port: 3000,
    node: true,
    files: {
      'package.json': JSON.stringify({ name: 'lifecycle-control', private: true, type: 'module' }),
      'src/main.js': `import { createServer } from 'node:http';
createServer((_request, response) => response.end(String(process.pid)))
  .listen(Number(process.env.PORT), '127.0.0.1');`,
    },
    controls: { reference: {} },
    judgeFiles: ['tools/agent-bench/tests/lifecycle-task.ts'],
    judge: async () => ({ pass: true, probes: [] }),
  };
}
