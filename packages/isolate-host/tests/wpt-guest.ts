/**
 * The shared WPT harness (`tests/wpt/`, repo root) on the isolate host: each file runs as a
 * sandbox `exec` of `t.cjs`, a fresh isolate per file.
 */
import {
  type Report,
  type ReportOptions,
  inNode,
  parseReport,
  wptFile,
} from '../../../tests/wpt/harness.ts';
import { createSandbox } from '../src/index.ts';

export {
  coverageProblems,
  differences,
  inNode,
  type Report,
  wptFile,
} from '../../../tests/wpt/harness.ts';

/** A harness file (`wptFile`) as a sandbox `exec`: exit code, stderr and termination included. */
export async function inGuest(
  file: string,
  timeoutMs = 120_000,
  options: ReportOptions = {},
): Promise<Report> {
  const sb = await createSandbox();
  try {
    await sb.writeFile('t.cjs', file);
    return parseReport(
      await sb.exec('t.cjs', { timeoutMs, maxOutputBytes: 64 * 2 ** 20 }),
      options,
    );
  } finally {
    await sb.destroy();
  }
}

/** One WPT test file in live Node and in the guest. */
export async function runWpt(
  test: string,
  options: ReportOptions = {},
): Promise<{ node: Report; guest: Report }> {
  const file = wptFile(test);
  return { node: inNode(file, 120_000, options), guest: await inGuest(file, 120_000, options) };
}
