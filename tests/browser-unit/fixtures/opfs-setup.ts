import type { OpfsFsSync } from '@riftydev/vfs';

/** Setup joins native settlement before judging a deliberately short report budget. */
export async function settleOpfsSetup(fs: OpfsFsSync): Promise<void> {
  await fs.fence();
  const report = await fs.flush();
  if (report.total) throw new Error(`OPFS setup unclean: ${JSON.stringify(report.failures)}`);
}
