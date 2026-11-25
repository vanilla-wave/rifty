/**
 * The shared WPT harness (`tests/wpt/`, repo root) on the isolate host: each file runs as a
 * sandbox `exec` of `t.cjs`, a fresh isolate per file.
 */
import { type Report, inNode, parseReport, wptFile } from '../../../tests/wpt/harness.ts';
import { createSandbox } from '../src/index.ts';

export { differences, type Report } from '../../../tests/wpt/harness.ts';

/** One WPT test file in live Node and in the guest. */
export async function runWpt(test: string): Promise<{ node: Report; guest: Report }> {
  const file = wptFile(test);
  const sb = await createSandbox();
  try {
    await sb.writeFile('t.cjs', file);
    const r = await sb.exec('t.cjs', { timeoutMs: 120_000, maxOutputBytes: 64 * 2 ** 20 });
    return { node: inNode(file), guest: parseReport(r) };
  } finally {
    await sb.destroy();
  }
}
