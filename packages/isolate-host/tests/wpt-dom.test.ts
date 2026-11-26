/**
 * WPT `dom/abort` and `dom/events` (Node v24.16.0's vendored copy, `tests/wpt/fixtures`) through
 * the shared harness: every subtest of every `.any.js` file Node runs gives the guest live Node's
 * result (ADR-0579, goal `isolate-guest-web-api` I3). `Event-isTrusted` and
 * `EventTarget-removeEventListener` fail in Node too: compared, an equal failure is equal.
 */
import { describe, expect, it } from 'vitest';
import { runCode } from '../src/index.ts';
import { type Report, coverageProblems, differences, runWpt } from './wpt-guest.ts';

/** Files run, with the subtests excluded from the comparison (none). */
const FILES: Readonly<Record<string, readonly string[]>> = {
  'dom/abort/AbortSignal.any.js': [],
  'dom/abort/abort-signal-any.any.js': [],
  'dom/abort/event.any.js': [],
  'dom/abort/timeout.any.js': [],
  'dom/events/AddEventListenerOptions-once.any.js': [],
  'dom/events/AddEventListenerOptions-passive.any.js': [],
  'dom/events/AddEventListenerOptions-signal.any.js': [],
  'dom/events/Event-constructors.any.js': [],
  'dom/events/Event-isTrusted.any.js': [],
  'dom/events/EventTarget-add-remove-listener.any.js': [],
  'dom/events/EventTarget-addEventListener.any.js': [],
  'dom/events/EventTarget-constructible.any.js': [],
  'dom/events/EventTarget-removeEventListener.any.js': [],
};
/** Files whose `addEventListener(type, null)` makes Node's EventTarget print a process warning. */
const WARNS = new Set([
  'dom/events/AddEventListenerOptions-passive.any.js',
  'dom/events/EventTarget-addEventListener.any.js',
]);
/** The warning hint names `process.argv0`, `'rifty'` in the guest (compat `isolate-host.md` Identity row). */
const RIFTY_HINT = '(Use `rifty --trace-warnings ...`';
const NODE_HINT = '(Use `node --trace-warnings ...`';
/**
 * `.any.js` files not run, each with guest code printing `gap` while its reason holds. Not run
 * either: every `.html`/`.window.js`/`.worker.js` file (Node skips them).
 */
const NOT_RUN: Readonly<Record<string, { readonly why: string; readonly gap: string }>> = {
  'dom/abort/timeout-shadowrealm.any.js': {
    why: '`ShadowRealm` (`global=shadowrealm`; absent in Node too)',
    gap: "if (typeof ShadowRealm === 'undefined') console.log('gap');",
  },
};

function declaredHint(guest: Report): Report {
  if (guest.stderr === undefined) return guest;
  return { ...guest, stderr: guest.stderr.split(RIFTY_HINT).join(NODE_HINT) };
}

describe("WPT dom/abort, dom/events: the guest gives every subtest live Node's result", () => {
  for (const [test, excluded] of Object.entries(FILES)) {
    it(test, { timeout: 180_000 }, async () => {
      const { node, guest } = await runWpt(test, { stderr: WARNS.has(test) });
      expect(node.harness, 'Node completes the file').toBe('OK');
      expect(node.subtests.length).toBeGreaterThan(0);
      if (WARNS.has(test)) {
        expect(node.stderr).toContain('AddEventListenerArgumentTypeWarning');
        expect(guest.stderr).toContain(RIFTY_HINT);
      }
      expect(differences(node, declaredHint(guest), excluded)).toEqual([]);
    });
  }
});

it('every vendored dom test file is run or listed as not run', () => {
  expect(coverageProblems('dom/', Object.keys(FILES), Object.keys(NOT_RUN))).toEqual([]);
});

describe('WPT dom files not run still have their reason', () => {
  for (const [test, { why, gap }] of Object.entries(NOT_RUN)) {
    it(`${test}: ${why}`, async () => {
      expect(await runCode(gap)).toEqual({ stdout: 'gap\n', stderr: '', exitCode: 0 });
    });
  }
});
