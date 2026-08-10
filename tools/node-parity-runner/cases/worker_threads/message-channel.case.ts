import type { ParityCase } from '../../src/types.ts';

// Vite 7/8 statically imports MessageChannel from node:worker_threads. The
// builtin must therefore link the named export and retain the host constructor
// identity; the real host port pair supplies structured-clone delivery.
const c: ParityCase = {
  kind: 'esm',
  code: `
    import workerThreads, { MessageChannel } from 'node:worker_threads';

    const channel = new MessageChannel();
    console.log(
      'identity',
      MessageChannel === globalThis.MessageChannel,
      workerThreads.MessageChannel === MessageChannel,
    );
    console.log(
      'instances',
      channel instanceof MessageChannel,
      channel.port1 instanceof globalThis.MessagePort,
      channel.port2 instanceof globalThis.MessagePort,
    );

    const received = new Promise((resolve) => {
      channel.port1.onmessage = (event) => resolve(event.data);
    });
    channel.port2.postMessage({ answer: 42 });
    console.log('message', JSON.stringify(await received));
    channel.port1.close();
    channel.port2.close();
  `,
  expected: 'identity true true\n' + 'instances true true true\n' + 'message {"answer":42}\n',
};

export default c;
