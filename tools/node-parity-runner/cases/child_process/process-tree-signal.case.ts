/** Finite ps discovery and both exact nodemon SIGUSR2 paths agree with Node. */
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
      'project/signal.js': `
        process.once('SIGUSR2', () => {
          process.stdout.write('signal-stdout');
          process.stderr.write('signal-stderr');
          process.kill(process.pid, 'SIGUSR2');
        });
        process.send('ready');
        setInterval(() => {}, 1000);
      `,
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
      const bare = await execAsync('ps');
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

      const directChild = fork('signal.js', [], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      let directStdout = '';
      let directStderr = '';
      const directOrder = [];
      directChild.stdout.on('data', (chunk) => { directStdout += chunk.toString(); });
      directChild.stderr.on('data', (chunk) => { directStderr += chunk.toString(); });
      directChild.on('exit', (code, signal) => {
        directOrder.push('exit:' + code + '/' + signal);
      });
      const directClosePromise = new Promise((resolve) => {
        directChild.on('close', (code, signal) => {
          directOrder.push('close:' + code + '/' + signal);
          resolve({ code, signal });
        });
      });
      await new Promise((resolve) => directChild.once('message', resolve));
      const directAccepted = directChild.kill('SIGUSR2');
      const directExit = await directClosePromise;

      const execChild = fork('idle.js', [], { cwd, stdio: 'ignore' });
      const execExitPromise = waitExit(execChild);
      const killed = await execAsync('kill -USR2 ' + execChild.pid);
      const execExit = await execExitPromise;
      const bareHeader = bare.stdout.trim().split(/\\r?\\n/, 1)[0] || '';
      const formattedHeader = ps.stdout.trim().split(/\\r?\\n/, 1)[0] || '';
      console.log(
        'tree:' + coherent +
        '|bare:' + (bare.error === null && bare.stderr === '') + ':' +
          bareHeader.trim().split(/\\s+/).sort().join(',') +
        '|formatted:' + (ps.error === null && ps.stderr === '') + ':' +
          formattedHeader.trim().split(/\\s+/).sort().join(',') +
        '|direct:' + directAccepted + ':' + directExit.code + '/' + directExit.signal +
          ':' + directStdout + '/' + directStderr + ':' + directOrder.join('>') +
        '|kill:' + (killed.error === null && killed.stdout === '' && killed.stderr === '') +
        ':' + execExit.code + '/' + execExit.signal
      );
    });
  `,
  expected:
    'tree:true|bare:true:CMD,PID,TIME,TTY|formatted:true:PID,PPID|' +
    'direct:true:null/SIGUSR2:signal-stdout/signal-stderr:' +
    'exit:null/SIGUSR2>close:null/SIGUSR2|kill:true:null/SIGUSR2',
};

export default c;
