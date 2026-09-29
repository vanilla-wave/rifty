/**
 * Default JSON fork IPC, top-level `send()` refusals on both sides (ADR-0448
 * Decision 3: the validation shared with advanced carries Node's `Received …`
 * text). One program for the Worker route and the same-realm route cases.
 */

/** Ambient `process`: the same-realm route passes it as a wrapper parameter. */
const REFUSALS_SOURCE = `
const errorShape = (error) => ({
  class: error.constructor.name,
  code: error.code ?? null,
  message: error.message,
});
const refusals = (send, symbolDescription) => [
  ['undefined', undefined],
  ['anonymous-function', () => {}],
  ['named-function', function namedFn() {}],
  ['symbol', Symbol(symbolDescription)],
  ['bigint', 1n],
].map(([label, value]) => {
  try {
    return [label, 'sent:' + String(send(value))];
  } catch (error) {
    return [label, errorShape(error)];
  }
});
`;

export const JSON_REFUSAL_FILES = {
  'project/refuse.cjs': `
    ${REFUSALS_SOURCE}
    process.once('message', () => {
      process.send({ refusals: refusals((value) => process.send(value), 'child') });
      process.disconnect();
    });
  `,
};

export const JSON_REFUSAL_CODE = `
  const { fork } = require('node:child_process');
  const cwd = require('node:process').cwd();
  ${REFUSALS_SOURCE}
  const rows = [];
  const row = (label, value) => rows.push(label + ' ' + JSON.stringify(value));

  void (async () => {
    const child = fork('refuse.cjs', [], { cwd, stdio: 'pipe' });
    for (const [label, value] of refusals((value) => child.send(value), 'parent')) {
      row('parent:' + label, value);
    }
    const report = new Promise((resolve) => child.once('message', resolve));
    const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
    child.send({ command: 'refuse' });
    for (const [label, value] of (await report).refusals) row('child:' + label, value);
    row('exit', await exited);

    console.log(rows.join('\\n'));
  })().catch((error) => {
    console.log('case-error:' + error.name + ':' + error.message);
  });
`;
