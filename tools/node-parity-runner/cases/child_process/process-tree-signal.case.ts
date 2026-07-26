/** Recursive PPID/PID discovery and the exact nodemon restart signal agree with Node. */
import type { ParityCase } from '../../src/types.ts';

const idleChild = 'setInterval(() => {}, 1000);';
const parentChild = `
  const { fork } = require('node:child_process');
  const child = fork('idle.js', [], { cwd: process.cwd(), stdio: 'ignore' });
  process.send({ childPid: child.pid });
  process.on('message', (message) => {
    if (message === 'stop') {
      child.once('exit', () => process.exit(0));
      child.kill('SIGTERM');
    }
  });
`;

const c: ParityCase = {
  cwd: '/project',
  setup: {
    files: {
      'project/idle.js': idleChild,
      'project/parent.js': parentChild,
    },
  },
  code: `
    const { exec, fork } = require('node:child_process');
    const cwd = require('node:process').cwd();
    const execAsync = (command) => new Promise((resolve) => {
      exec(command, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    });
    const waitExit = (child) => new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });

    const parent = fork('parent.js', [], { cwd, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    parent.once('message', async ({ childPid }) => {
      const ps = await execAsync('ps -A -o ppid,pid');
      const rows = ps.stdout.trim().split(/\\r?\\n/).map((line) => line.trim().split(/\\s+/));
      const row = (pid) => rows.find((parts) => parts[1] === String(pid));
      const parentRow = row(parent.pid);
      const childRow = row(childPid);
      const coherent =
        parentRow?.[0] === String(process.pid) &&
        childRow?.[0] === String(parent.pid);
      parent.send('stop');
      await waitExit(parent);

      const signalled = fork('idle.js', [], { cwd, stdio: 'ignore' });
      const signalExit = waitExit(signalled);
      const killed = await execAsync('kill -USR2 ' + signalled.pid);
      const exit = await signalExit;
      console.log(
        'tree:' + coherent +
        '|ps:' + (ps.error === null && ps.stderr === '') +
        '|kill:' + (killed.error === null && killed.stdout === '' && killed.stderr === '') +
        '|exit:' + exit.code + '/' + exit.signal
      );
    });
  `,
  expected: 'tree:true|ps:true|kill:true|exit:null/SIGUSR2',
};

export default c;
