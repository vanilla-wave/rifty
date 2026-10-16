import { inspect } from 'node:util';

interface OwnedMutation {
  identity: string;
  restore: () => Promise<void>;
  state: 'active' | 'restoring' | 'settled' | 'failed';
  failure?: Error;
}

/** One explicit observation owns every temporary write, including uncertain writes. */
export class RecordObservation {
  private readonly reserved = new Set<string>();
  private readonly mutations: OwnedMutation[] = [];
  private closed = false;

  reserve(identity: string, originalValues: Iterable<string>): string {
    if (this.closed) throw new Error('Record observation is closed');
    if (!identity || this.reserved.has(identity) || new Set(originalValues).has(identity))
      throw new Error(`Temporary record identity collision: ${identity}`);
    this.reserved.add(identity);
    return identity;
  }

  reserveGenerated(generate: () => string, originalValues: Iterable<string>): string {
    if (this.closed) throw new Error('Record observation is closed');
    const originals = new Set(originalValues);
    for (let attempt = 0; attempt < 32; attempt++) {
      const value = generate();
      if (!value || originals.has(value) || this.reserved.has(value)) continue;
      return this.reserve(value, originals);
    }
    throw new Error('Temporary record identity collision after bounded allocation');
  }

  async apply<T>(identity: string, restore: () => Promise<void>, write: () => Promise<T>) {
    if (this.closed) throw new Error('Record observation is closed');
    if (!this.reserved.has(identity)) throw new Error('Unreserved temporary record identity');
    if (this.mutations.some((mutation) => mutation.identity === identity))
      throw new Error('Temporary record identity already applied');
    // Admission precedes the await: a thrown command can already have applied its write.
    this.mutations.push({ identity, restore, state: 'active' });
    return write();
  }

  async release(identity: string): Promise<void> {
    const mutation = this.mutations.find((entry) => entry.identity === identity);
    if (!mutation || mutation.state !== 'active')
      throw new Error(`Temporary record mutation is not active: ${identity}`);
    mutation.state = 'restoring';
    try {
      await mutation.restore();
      mutation.state = 'settled';
    } catch (cause) {
      mutation.state = 'failed';
      mutation.failure = new Error(`Temporary record restore failed: ${identity}`, { cause });
      throw mutation.failure;
    }
  }

  async close(): Promise<unknown[]> {
    this.closed = true;
    for (const mutation of [...this.mutations].reverse()) {
      if (mutation.state !== 'active') continue;
      try {
        await this.release(mutation.identity);
      } catch {
        /* release retains the failure even if its consumer catches it. */
      }
    }
    return this.mutations.flatMap((mutation) => (mutation.failure ? [mutation.failure] : []));
  }
}

/** Querying candidates stays pure; callers invoke and witness this lifecycle explicitly. */
export async function withRecordObservation<T>(
  observe: (scope: RecordObservation) => Promise<T>,
): Promise<T> {
  const scope = new RecordObservation();
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await observe(scope) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  const failures = [
    ...new Set([...(!outcome.ok ? [outcome.error] : []), ...(await scope.close())]),
  ];
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, 'Record observation and restore failed');
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

/** Preserve cause/cleanup evidence when a judge stores its failure. */
export const recordObservationError = (error: unknown) => inspect(error, { depth: null });
