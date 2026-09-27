import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 1,
  cwd: '/project',
  setup: {
    files: {
      'project/listener.cjs': `
        process.on('message', message => {
          process.send({ received: message.value });
          process.disconnect();
        });
        process.send({ ready: true });
      `,
    },
  },
  code: `
    const { fork } = require('node:child_process');
    void new Promise((resolve, reject) => {
      const child = fork('listener.cjs', [], {
        cwd: process.cwd(), serialization: 'advanced', stdio: 'pipe',
      });
      const events = [];
      child.on('error', reject);
      child.on('message', message => {
        if (message.ready) {
          events.push('ready');
          setTimeout(() => child.send({ value: 42n }), 80);
        } else events.push('received:' + typeof message.received + ':' + String(message.received));
      });
      child.on('disconnect', () => events.push('disconnect'));
      child.once('exit', (code, signal) => resolve({ events, code, signal, connected: child.connected }));
    }).then(result => console.log(JSON.stringify(result)))
      .catch(error => console.log('case-error:' + error.name + ':' + error.message));
  `,
};

export default c;
