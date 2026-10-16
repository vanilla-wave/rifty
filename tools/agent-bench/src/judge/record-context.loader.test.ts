import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

// The bench runs judges through `node --import tsx`; Playwright specs use another transform.
// A serialized `page.evaluate` callback must not depend on loader-injected helpers (`__name`).
it('record discovery works through the production tsx loader', () => {
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', resolve('tools/agent-bench/tests/probes/cancel-aliases-tsx.ts')],
    { encoding: 'utf8', timeout: 120_000 },
  );
  expect(child.status, child.stdout + child.stderr).toBe(0);
}, 150_000);
