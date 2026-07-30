import type { ParityCase } from '../../src/types.ts';

/** A real PTY resize updates both TTY streams before Node's first SIGWINCH. */
const c: ParityCase = {
  kind: 'tty-resize',
  expected:
    '__RIFTY_TTY_RESULT__{"initial":"80x24","final":"132x43","window":[132,43],"events":["stdout:132x43","stderr:132x43","SIGWINCH:132x43"]}',
  code: `
    const process = require('node:process');
    const events = [];
    const size = (stream) => stream.columns + 'x' + stream.rows;
    const initial = size(process.stdout);
    process.stdout.on('resize', () => events.push('stdout:' + size(process.stdout)));
    process.stderr.on('resize', () => events.push('stderr:' + size(process.stderr)));
    process.once('SIGWINCH', () => events.push('SIGWINCH:' + size(process.stdout)));
    globalThis.__riftyTtyResize(132, 43);
    setTimeout(() => {
      console.log('__RIFTY_TTY_RESULT__' + JSON.stringify({
        initial,
        final: size(process.stdout),
        window: process.stdout.getWindowSize(),
        events,
      }));
    }, 50);
  `,
};

export default c;
