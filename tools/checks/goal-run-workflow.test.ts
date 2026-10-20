// Control-flow trace of .claude/workflows/goal-run.js: the script body runs with
// scripted leaf exits at the harness boundary (agent()). Proves the sequencing
// docs/process/README.md §Route names; the leaves themselves are real agents.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Call = { label: string; prompt: string; phase?: string };
type Leaf = (call: Call, n: number) => unknown;
type Blocker = { authority: string; summary: string };

const SCRIPT = readFileSync(join(__dirname, '../../.claude/workflows/goal-run.js'), 'utf8').replace(
  /^export const meta = /m,
  'const meta = ',
);

async function trace(args: unknown, leaves: Record<string, Leaf | unknown[]>) {
  const calls: Call[] = [];
  const seen = new Map<string, number>();
  const agent = async (prompt: string, opts: { label?: string; phase?: string } = {}) => {
    const call = { label: opts.label ?? '', prompt, phase: opts.phase };
    calls.push(call);
    const key = Object.keys(leaves).find((k) => call.label === k || call.label.startsWith(`${k}:`));
    if (key === undefined) throw new Error(`unscripted leaf ${call.label}`);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const leaf = leaves[key];
    return Array.isArray(leaf) ? leaf[Math.min(n, leaf.length - 1)] : (leaf as Leaf)(call, n);
  };
  const body = new Function(
    'args',
    'agent',
    'phase',
    'log',
    `return (async () => {${SCRIPT}\n})()`,
  ) as (...a: unknown[]) => Promise<Record<string, unknown>>;
  const result = await body(
    args,
    agent,
    () => undefined,
    () => undefined,
  );
  return { result, calls, labels: calls.map((c) => c.label) };
}

const st = (o: Record<string, unknown> = {}) => ({
  goalReady: true,
  treeClean: true,
  mapEmpty: false,
  hasCarrier: true,
  unit: 'docs/backlog/a/u1.md',
  unitCertified: false,
  base: 'b1',
  branchBase: 'b0',
  notes: '',
  ...o,
});
const done = (o: Record<string, unknown> = {}) => ({ outcome: 'done', report: 'ok', ...o });
const left = { outcome: 'left-path', report: 'resisted' };
const pass = (verdictPath = 'v-pass') => ({ pass: true, verdictPath, exitCode: 0, blockers: [] });
const fail = (verdictPath: string, ...blockers: Blocker[]) => ({
  pass: false,
  verdictPath,
  exitCode: 1,
  blockers,
});
const B1 = { authority: 'I1', summary: 'carrier missing' };
const B2 = { authority: 'ADR-0001', summary: 'wrong owner' };
const GOAL = { goal: 'g' };

// Leaves that let a run reach CLOSE once the unit loop is done.
const closing = {
  gate: [done({ report: 'gate green @ sha-c' })],
  'review:Final+GREEN': [pass()],
  'Final+GREEN': [done()],
  CLOSE: [done({ report: 'merged' })],
};

describe('goal-run workflow sequencing', () => {
  it('refuses missing or JSON-encoded args before any leaf', async () => {
    for (const args of [undefined, {}, '{"goal":"g"}', '["g"]', '  ']) {
      const { result, calls } = await trace(args, {});
      expect(result.stop).toBe('args');
      expect(calls).toHaveLength(0);
    }
  });

  it('stops at Preflight on a goal that is not ready or a dirty tree', async () => {
    const notReady = await trace('g', { state: [st({ goalReady: false })] });
    expect(notReady.result.stop).toBe('precondition');
    expect(notReady.labels).toEqual(['state:initial']);
    expect(notReady.calls[0].phase).toBe('Preflight');
    const dirty = await trace(GOAL, { state: [st({ treeClean: false })] });
    expect(dirty.result).toMatchObject({
      stop: 'precondition',
      report: expect.stringContaining('dirty tree'),
    });
  });

  it('seeds the carrier (RECHART 2), runs one unit through every stage, then CLOSE', async () => {
    const { result, labels, calls } = await trace(GOAL, {
      state: [st({ hasCarrier: false, unit: null }), st(), st({ mapEmpty: true })],
      RECHART: [done(), done()],
      PICKUP: [done({ needsContractRed: true, report: 'contract + RED at sha-p' })],
      'review:Contract+RED': [pass('v-cr')],
      'Contract+RED': [done()],
      IMPLEMENT: [done({ report: 'green; pr:check log /tmp/g.log @ sha-i' })],
      'review:Final+GREEN': [pass('v-fg'), pass('v-goal')],
      'Final+GREEN': [done(), done()],
      gate: [done({ report: 'gate green @ sha-c' })],
      CLOSE: [done({ report: 'merged' })],
    });
    expect(labels).toEqual([
      'state:initial',
      'RECHART',
      'state:1',
      'PICKUP:u1',
      'review:Contract+RED:u1',
      'Contract+RED:u1',
      'IMPLEMENT:u1',
      'review:Final+GREEN:u1',
      'Final+GREEN:u1',
      'RECHART:u1',
      'state:2',
      'gate',
      'review:Final+GREEN:goal',
      'Final+GREEN:goal',
      'CLOSE',
    ]);
    expect(result).toEqual({ closed: true, goal: 'g', landed: 1, report: 'merged' });
    const prompt = (label: string) => calls.find((c) => c.label === label)?.prompt ?? '';
    expect(prompt('RECHART')).toContain('RECHART 2');
    expect(prompt('Contract+RED:u1')).toContain("'ready-verdict:'");
    expect(prompt('Final+GREEN:u1')).toContain('REV-8');
    expect(prompt('Final+GREEN:goal')).toContain('final-green.json');
    expect(prompt('review:Final+GREEN:goal')).toContain('BASE b0');
    expect(prompt('review:Final+GREEN:u1')).toContain('BASE b1');
    expect(calls.find((c) => c.label === 'review:Final+GREEN:goal')?.phase).toBe('Close');
    expect(prompt('PICKUP:u1')).toContain('never spawn agents');
    expect(prompt('review:Contract+RED:u1')).toContain('Stage report: contract + RED at sha-p');
    expect(prompt('review:Final+GREEN:u1')).toContain(
      'Stage report: green; pr:check log /tmp/g.log @ sha-i',
    );
    expect(prompt('review:Final+GREEN:u1')).toContain('never re-run');
    expect(prompt('IMPLEMENT:u1')).toContain('pr:check once');
    expect(prompt('gate')).toContain('--all once');
    expect(prompt('review:Final+GREEN:goal')).toContain('Stage report: gate green @ sha-c');
    expect(prompt('CLOSE')).toContain('gate green @ sha-c');
    expect(calls.find((c) => c.label === 'gate')?.phase).toBe('Close');
  });

  it('picks up a seeded carrier unit instead of re-charting while the carrier is uncommitted', async () => {
    const { labels } = await trace(GOAL, {
      state: [st({ hasCarrier: false }), st({ mapEmpty: true })],
      PICKUP: [done({ needsContractRed: false })],
      IMPLEMENT: [done()],
      RECHART: [done()],
      ...closing,
    });
    expect(labels.slice(0, 4)).toEqual([
      'state:initial',
      'PICKUP:u1',
      'IMPLEMENT:u1',
      'review:Final+GREEN:u1',
    ]);
    expect(labels).not.toContain('RECHART');
  });

  it('skips PICKUP for a certified unit and continues after a declined one', async () => {
    const certified = await trace(GOAL, {
      state: [st({ unitCertified: true }), st({ mapEmpty: true })],
      IMPLEMENT: [done()],
      RECHART: [done()],
      ...closing,
    });
    expect(certified.labels[1]).toBe('IMPLEMENT:u1');
    expect(certified.labels).not.toContain('PICKUP:u1');
    const declined = await trace(GOAL, {
      state: [st(), st({ mapEmpty: true })],
      PICKUP: [{ outcome: 'declined', report: 'draft deleted' }],
      ...closing,
    });
    expect(declined.labels.slice(0, 4)).toEqual(['state:initial', 'PICKUP:u1', 'state:1', 'gate']);
    expect(declined.result.closed).toBe(true);
    // Only PICKUP may decline: a declined IMPLEMENT is a unit leaving the path, never a skipped Final+GREEN.
    const late = await trace(GOAL, {
      state: [st({ unitCertified: true }), st({ mapEmpty: true })],
      IMPLEMENT: [{ outcome: 'declined', report: 'nothing to do' }],
      RECHART: [done()],
      ...closing,
    });
    expect(late.labels.slice(1, 4)).toEqual(['IMPLEMENT:u1', 'RECHART:u1', 'state:1']);
    expect(late.labels).not.toContain('review:Final+GREEN:u1');
    expect(late.calls[2].prompt).toContain('left the path (STOP-4): nothing to do');
  });

  it('routes a unit that leaves the path at Contract+RED to RECHART, never to IMPLEMENT', async () => {
    const { labels, calls } = await trace(GOAL, {
      state: [st(), st({ mapEmpty: true })],
      PICKUP: [done({ needsContractRed: true })],
      'review:Contract+RED': [fail('v1', B1)],
      'Contract+RED': [left],
      RECHART: [done()],
      ...closing,
    });
    expect(labels.slice(0, 5)).toEqual([
      'state:initial',
      'PICKUP:u1',
      'review:Contract+RED:u1',
      'Contract+RED:u1',
      'RECHART:u1',
    ]);
    expect(labels).not.toContain('IMPLEMENT:u1');
    expect(calls[4].prompt).toContain('left the path (STOP-4): resisted');
  });

  it('declares a STOP-3 stall when a blocker survives a fix + verify pass unchanged, keeping the rest in reception', async () => {
    const { labels, calls } = await trace(GOAL, {
      state: [st({ unitCertified: true }), st({ mapEmpty: true })],
      IMPLEMENT: [done()],
      'review:Final+GREEN': [fail('v1', B1), fail('v2', B1, B2), pass()],
      'Final+GREEN': [done({ report: 'fixed B1; pr:check log /tmp/f.log @ sha-f' }), left, done()],
      RECHART: [done()],
      gate: [done()],
      CLOSE: [done()],
    });
    const reception = calls.filter((c) => c.label === 'Final+GREEN:u1');
    expect(calls.filter((c) => c.label === 'review:Final+GREEN:u1')[1].prompt).toContain(
      'Stage report: fixed B1; pr:check log /tmp/f.log @ sha-f',
    );
    expect(reception[0].prompt).toContain('returned blockers (verdict v1)');
    expect(reception[0].prompt).not.toContain('STOP-3');
    expect(reception[1].prompt).toContain('STOP-3 stall at verdict v2');
    expect(reception[1].prompt).toContain('[I1] carrier missing');
    expect(reception[1].prompt).toContain('other blockers of this pass');
    expect(reception[1].prompt).toContain('[ADR-0001] wrong owner');
    expect(
      calls.find((c) => c.label === 'review:Final+GREEN:u1' && c.prompt.includes('Verify pass'))
        ?.prompt,
    ).toContain('prior verdict is v1');
    expect(labels).toContain('RECHART:u1');
  });

  it('closes the valve after maxPasses verify passes without an unverified fix', async () => {
    let n = 0;
    const { calls, labels } = await trace(
      { goal: 'g', maxPasses: 2 },
      {
        state: [st({ unitCertified: true }), st({ mapEmpty: true })],
        IMPLEMENT: [done()],
        'review:Final+GREEN': (c) =>
          c.label.endsWith(':goal')
            ? pass()
            : fail(`v${++n}`, { authority: 'I1', summary: `defect ${n}` }),
        'Final+GREEN': [done(), done(), done()],
        RECHART: [done()],
        gate: [done()],
        CLOSE: [done()],
      },
    );
    const unitReviews = calls.filter((c) => c.label === 'review:Final+GREEN:u1');
    const receptions = calls.filter((c) => c.label === 'Final+GREEN:u1');
    expect(unitReviews).toHaveLength(3); // first review + 2 verify passes
    expect(receptions).toHaveLength(2); // no reception after the last review
    expect(labels[labels.indexOf('RECHART:u1') - 1]).toBe('review:Final+GREEN:u1');
    expect(calls.find((c) => c.label === 'RECHART:u1')?.prompt).toContain('2 verify passes spent');
  });

  it('sends disputed blockers to a fresh critic and does not count a demoted one as a stall', async () => {
    const { labels, calls } = await trace(GOAL, {
      state: [st({ unitCertified: true }), st({ mapEmpty: true })],
      IMPLEMENT: [done()],
      'review:Final+GREEN': [fail('v1', B1), fail('v2', B1), pass()],
      'Final+GREEN': [done({ disputed: [B1.summary] }), done(), done(), done()],
      critic: [{ rulings: [{ summary: B1.summary, ruling: 'FALSE' }] }],
      RECHART: [done()],
      gate: [done()],
      CLOSE: [done()],
    });
    expect(labels.slice(2, 6)).toEqual([
      'review:Final+GREEN:u1',
      'Final+GREEN:u1',
      'critic:Final+GREEN:u1',
      'Final+GREEN:u1',
    ]);
    const receptions = calls.filter((c) => c.label === 'Final+GREEN:u1');
    expect(receptions[1].prompt).toContain('FALSE — carrier missing');
    expect(receptions[2].prompt).not.toContain('STOP-3');
    expect(calls.find((c) => c.label === 'critic:Final+GREEN:u1')?.prompt).toContain(
      'v1: carrier missing',
    );
  });

  it('retries a malformed verdict once, then reports a harness failure', async () => {
    const malformed = { pass: false, verdictPath: 'bad', exitCode: 2, blockers: [] };
    const once = await trace(GOAL, {
      state: [st({ unitCertified: true }), st({ mapEmpty: true })],
      IMPLEMENT: [done()],
      'review:Final+GREEN': [malformed, pass(), pass()],
      'Final+GREEN': [done(), done()],
      RECHART: [done()],
      gate: [done()],
      CLOSE: [done()],
    });
    expect(once.labels.filter((l) => l === 'review:Final+GREEN:u1')).toHaveLength(2);
    expect(once.result.closed).toBe(true);
    const twice = await trace(GOAL, {
      state: [st({ unitCertified: true })],
      IMPLEMENT: [done()],
      'review:Final+GREEN': [malformed, malformed],
    });
    expect(twice.result).toMatchObject({
      stop: 'harness',
      report: expect.stringContaining('malformed verdict twice'),
    });
    expect(twice.labels).not.toContain('Final+GREEN:u1');
  });

  it('turns a leaf that returns nothing into a harness stop at every boundary', async () => {
    const pickup = await trace(GOAL, { state: [st()], PICKUP: [null] });
    expect(pickup.result).toMatchObject({ stop: 'harness' });
    const record = await trace(GOAL, {
      state: [st({ unitCertified: true })],
      IMPLEMENT: [done()],
      'review:Final+GREEN': [pass()],
      'Final+GREEN': [null],
    });
    expect(record.result).toMatchObject({
      stop: 'harness',
      report: expect.stringContaining('record leaf'),
    });
    const gateNull = await trace(GOAL, { state: [st({ mapEmpty: true })], gate: [null] });
    expect(gateNull.result).toMatchObject({
      stop: 'harness',
      report: expect.stringContaining('gate'),
    });
    const close = await trace(GOAL, {
      gate: [done()],
      state: [st({ mapEmpty: true })],
      'review:Final+GREEN': [pass()],
      'Final+GREEN': [done()],
      CLOSE: [null],
    });
    expect(close.result).toMatchObject({
      stop: 'harness',
      report: expect.stringContaining('CLOSE'),
    });
    const stateNull = await trace(GOAL, { state: [null] });
    expect(stateNull.result).toMatchObject({ stop: 'harness' });
  });

  it('reports a fully blocked map and guards a loop that never closes', async () => {
    const blocked = await trace(GOAL, {
      state: [st({ unit: null, notes: 'row 2 blocked by owner: user' })],
    });
    expect(blocked.result).toMatchObject({
      stop: 'report',
      report: expect.stringContaining('owner: user'),
    });
    const forever = await trace(GOAL, {
      state: [st()],
      PICKUP: [{ outcome: 'declined', report: 'again' }],
    });
    expect(forever.result).toMatchObject({
      stop: 'harness',
      report: expect.stringContaining('runaway guard'),
    });
    expect(forever.labels.filter((l) => l === 'PICKUP:u1')).toHaveLength(24);
  });
});
