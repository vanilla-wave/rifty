import { describe, expect, it } from 'vitest';
import {
  type WorkbenchConstructionLease,
  createWorkbenchConstructionTransaction,
} from './workbench-construction-transaction.ts';

type ConstructionBoundary = 'storage' | 'source' | 'manager' | 'packages' | 'controller';

function ownNamed(
  own: (cleanup: () => void | Promise<void>) => WorkbenchConstructionLease,
  name: string,
  events: string[],
  failure?: Error,
): WorkbenchConstructionLease {
  return own(() => {
    events.push(`${name}:close`);
    if (failure !== undefined) throw failure;
  });
}

function constructionPrefix(boundary: ConstructionBoundary, events: string[]) {
  const transaction = createWorkbenchConstructionTransaction();
  const storage = ownNamed(transaction.own, 'storage', events);
  if (boundary === 'storage') return transaction;
  const source = ownNamed(transaction.own, 'source', events);
  if (boundary === 'source') return transaction;
  const manager = transaction.transfer([source, storage], () => {
    events.push('manager:close');
  });
  if (boundary === 'manager') return transaction;
  const packages = ownNamed(transaction.own, 'packages', events);
  if (boundary === 'packages') return transaction;
  transaction.transfer([packages, manager], () => {
    events.push('controller:close');
  });
  return transaction;
}

describe('torn-state: Workbench construction ownership transaction', () => {
  it.each([
    ['storage', ['storage:close']],
    ['source', ['source:close', 'storage:close']],
    ['manager', ['manager:close']],
    ['packages', ['packages:close', 'manager:close']],
    ['controller', ['controller:close']],
  ] as const)('rolls back exactly the owned %s prefix', async (boundary, expected) => {
    const events: string[] = [];
    const failure = new Error(`${boundary} construction failed`);
    const transaction = constructionPrefix(boundary, events);

    await expect(transaction.rollback(failure, 'construction failed')).rejects.toBe(failure);
    expect(events).toEqual(expected);
  });

  it('keeps the construction cause first and every reverse-order cleanup failure', async () => {
    const events: string[] = [];
    const constructionFailure = new Error('construction failed');
    const packageCleanupFailure = new Error('packages cleanup failed');
    const managerCleanupFailure = new Error('manager cleanup failed');
    const transaction = createWorkbenchConstructionTransaction();
    ownNamed(transaction.own, 'manager', events, managerCleanupFailure);
    ownNamed(transaction.own, 'packages', events, packageCleanupFailure);

    const failure = await transaction
      .rollback(constructionFailure, 'Workbench construction failed')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      constructionFailure,
      packageCleanupFailure,
      managerCleanupFailure,
    ]);
    expect(events).toEqual(['packages:close', 'manager:close']);
  });
});
