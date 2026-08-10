import { afterEach, describe, expect, it } from 'vitest';
import { resetSyncMirror } from '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts';
import { writeFileSync } from '../../../packages/runtime-js/src/builtins/fs.ts';
import workerThreadsModule, {
  Worker,
} from '../../../packages/runtime-js/src/builtins/worker_threads.ts';

afterEach(() => resetSyncMirror());

describe('worker_threads.MessageChannel', () => {
  it('is the exact host constructor and delivers through its real port pair', async () => {
    const messageChannel = workerThreadsModule.MessageChannel;

    expect(messageChannel).toBe(globalThis.MessageChannel);

    const channel = new (messageChannel as typeof MessageChannel)();
    expect(channel.port1).toBeInstanceOf(globalThis.MessagePort);
    expect(channel.port2).toBeInstanceOf(globalThis.MessagePort);

    const received = new Promise<unknown>((resolve) => {
      channel.port1.onmessage = (event) => resolve(event.data);
    });
    channel.port2.postMessage({ answer: 42 });
    await expect(received).resolves.toEqual({ answer: 42 });
    channel.port1.close();
    channel.port2.close();
  });
});

describe('worker_threads.Worker', () => {
  it('parent receives messages from the child via parentPort.postMessage', async () => {
    writeFileSync(
      '/w-out.js',
      `parentPort.postMessage('hello');
       parentPort.postMessage({ greeting: 'world' });`,
    );
    const w = new Worker('/w-out.js');
    const messages: unknown[] = [];
    w.on('message', (m) => messages.push(m));
    await new Promise<void>((resolve) => w.on('exit', () => resolve()));
    expect(messages).toEqual(['hello', { greeting: 'world' }]);
  });

  it('child receives messages from the parent via parentPort "message" event', async () => {
    writeFileSync(
      '/w-in.js',
      `parentPort.on('message', (m) => {
         parentPort.postMessage('echo:' + m);
       });`,
    );
    const w = new Worker('/w-in.js');
    const replies: unknown[] = [];
    w.on('message', (m) => replies.push(m));
    // Give the worker a tick to install its listener.
    await Promise.resolve();
    await Promise.resolve();
    w.postMessage('ping');
    w.postMessage('two');
    await new Promise((r) => setTimeout(r, 10));
    expect(replies).toEqual(['echo:ping', 'echo:two']);
  });

  it('workerData is passed through to the child', async () => {
    writeFileSync('/w-data.js', `parentPort.postMessage('got:' + JSON.stringify(workerData));`);
    const w = new Worker('/w-data.js', { workerData: { x: 1, name: 'hi' } });
    const messages: unknown[] = [];
    w.on('message', (m) => messages.push(m));
    await new Promise<void>((resolve) => w.on('exit', () => resolve()));
    expect(messages).toEqual(['got:{"x":1,"name":"hi"}']);
  });
});
