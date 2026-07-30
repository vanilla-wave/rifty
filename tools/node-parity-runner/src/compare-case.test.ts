import { describe, expect, it } from 'vitest';
import { compareCaseOutputs } from './compare-case.ts';
import type { ParityCase } from './types.ts';

const marker = '__RIFTY_TTY_RESULT__';
const baseTrace = {
  initial: '80x24',
  final: '132x43',
  window: [132, 43],
  events: ['stdout:132x43', 'stderr:132x43', 'SIGWINCH:132x43'],
};

function output(events: readonly string[] = baseTrace.events): string {
  return `${marker}${JSON.stringify({ ...baseTrace, events })}`;
}

const ttyCase: ParityCase = {
  kind: 'tty-resize',
  code: '',
  expected: output(),
};

describe('compareCaseOutputs', () => {
  it('keeps exact stdout equality as the default', () => {
    const testCase: ParityCase = { code: '', expected: 'same' };

    expect(compareCaseOutputs(testCase, 'same', 'same')).toEqual({ match: true });
    expect(compareCaseOutputs(testCase, 'node', 'rifty')).toEqual({ match: false });
    expect(compareCaseOutputs(testCase, 'other', 'other')).toEqual({ match: false });
  });

  it('admits the evidenced second native SIGWINCH without dropping its trace', () => {
    const native = output([...baseTrace.events, 'SIGWINCH:132x43']);

    expect(compareCaseOutputs(ttyCase, native, output())).toEqual({
      match: true,
      note: 'native SIGWINCH=2, rifty=1',
    });
  });

  it.each([
    ['missing native signal', baseTrace.events.slice(0, 2), baseTrace.events],
    [
      'early native signal',
      ['stdout:132x43', 'SIGWINCH:132x43', 'stderr:132x43'],
      baseTrace.events,
    ],
    [
      'third native signal',
      [...baseTrace.events, 'SIGWINCH:132x43', 'SIGWINCH:132x43'],
      baseTrace.events,
    ],
    ['changed duplicate native signal', [...baseTrace.events, 'SIGWINCH:131x43'], baseTrace.events],
    ['duplicate native stream event', ['stdout:132x43', ...baseTrace.events], baseTrace.events],
    ['duplicate rifty signal', baseTrace.events, [...baseTrace.events, 'SIGWINCH:132x43']],
  ])('rejects %s', (_name, nativeEvents, riftyEvents) => {
    expect(compareCaseOutputs(ttyCase, output(nativeEvents), output(riftyEvents))).toEqual({
      match: false,
    });
  });
});
