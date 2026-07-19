import type { PersistFailureReport } from '@riftydev/vfs';

/** One scoped durability decision over the complete persistence ledger. */
export function ownerVfsScopeHasFailure(
  report: PersistFailureReport,
  predicate: (path: string) => boolean,
): boolean {
  if (!Number.isSafeInteger(report.total) || report.total < 0) {
    throw new TypeError('Owner VFS persistence report total is invalid');
  }
  if (report.failures.length > report.total) {
    throw new TypeError('Owner VFS persistence report sample exceeds its total');
  }
  if (report.total === 0) {
    if (report.failures.length !== 0) {
      throw new TypeError('Owner VFS clean persistence report contains failures');
    }
    return false;
  }
  if (report.anyFailure !== undefined) return report.anyFailure(predicate);
  if (report.total !== report.failures.length) {
    throw new Error('Owner VFS persistence report is truncated without a full-ledger predicate');
  }
  return report.failures.some((failure) => predicate(failure.path));
}
