import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

type Entry = 'port' | 'worker' | 'worker-global' | 'clone';

// Runs inside a real module Worker, with and without the production installer.
async function transferOptionsProbe(entry: Entry, installUrl: string | null) {
  const report = postMessage.bind(globalThis);
  if (installUrl) {
    const compat = await import(/* @vite-ignore */ installUrl);
    compat.installWorkerRealmCompat();
  }
  const results = [];
  for (const variant of ['changing', 'once', 'invalid'] as const) {
    const pair = new MessageChannel();
    const channel = new MessageChannel();
    const buffer = new Uint8Array([2, 5, 9]).buffer;
    let reads = 0;
    let transferReads = 0;
    const options = {
      get [Symbol.iterator]() {
        reads++;
        if (variant === 'invalid') return 42;
        if (reads === 1) return undefined;
        if (variant === 'once') throw new Error('iterator reread');
        return function* () {
          yield pair.port1;
          yield buffer;
        };
      },
      get transfer() {
        transferReads++;
        return variant === 'changing' ? [] : [buffer];
      },
    };
    const data = {
      transport: true,
      buffer,
      ...(variant === 'changing' ? { port: pair.port1 } : {}),
    };
    let deliver!: (value: number[]) => void;
    const received = new Promise<number[]>((resolve) => {
      deliver = resolve;
    });
    const accept = (event: MessageEvent) => {
      if (!event.data.transport) return;
      event.data.port?.close();
      deliver(Array.from(new Uint8Array(event.data.buffer)));
    };
    channel.port2.onmessage = accept;
    const workerUrl = URL.createObjectURL(
      new Blob(
        [
          'onmessage=e=>{e.data.port?.close();postMessage({transport:true,buffer:e.data.buffer},[e.data.buffer]);};',
        ],
        { type: 'text/javascript' },
      ),
    );
    const worker = new Worker(workerUrl);
    worker.onmessage = accept;
    addEventListener('message', accept);
    let outcome = 'sent';
    let cloneBytes: number[] | undefined;
    try {
      if (entry === 'port') channel.port1.postMessage(data, options);
      if (entry === 'worker') worker.postMessage(data, options);
      if (entry === 'worker-global') postMessage(data, options);
      if (entry === 'clone') {
        const copy = structuredClone(data, options);
        cloneBytes = Array.from(new Uint8Array(copy.buffer));
      }
    } catch (error) {
      outcome = (error as Error).name;
    }
    let bytes: number[] | null;
    if (variant === 'changing') {
      bytes = await Promise.race([
        new Promise<number[]>((resolve) => {
          pair.port1.onmessage = (event) => resolve(Array.from(event.data));
          pair.port2.postMessage(new Uint8Array([4, 8, 12]));
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
      ]);
    } else {
      bytes =
        cloneBytes ??
        (outcome === 'sent'
          ? await Promise.race([
              received,
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
            ])
          : null);
    }
    results.push({ variant, reads, transferReads, outcome, length: buffer.byteLength, bytes });
    removeEventListener('message', accept);
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
    for (const port of [pair.port1, pair.port2, channel.port1, channel.port2]) port.close();
  }
  report({ result: results });
}

for (const entry of ['port', 'worker', 'worker-global', 'clone'] as const) {
  test(`MessagePort transfer options are read once through ${entry}`, async ({ page }) => {
    await gotoHarness(page);
    const results = await page.evaluate(
      async ({ source, entry, installer }) => {
        const runs = [];
        for (const installed of [false, true]) {
          const code = `(${source})(${JSON.stringify(entry)},${JSON.stringify(installed ? location.origin + installer : null)}).catch(error=>postMessage({error:String(error)}));`;
          const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
          const worker = new Worker(url, { type: 'module' });
          try {
            runs.push(
              await new Promise((resolve, reject) => {
                worker.onmessage = (event) => {
                  if (event.data.error) reject(new Error(event.data.error));
                  else if (event.data.result) resolve(event.data.result);
                  else if (event.data.transport) {
                    event.data.port?.close();
                    worker.postMessage({ transport: true, buffer: event.data.buffer }, [
                      event.data.buffer,
                    ]);
                  }
                };
                worker.onerror = (event) => reject(new Error(event.message));
              }),
            );
          } finally {
            worker.terminate();
            URL.revokeObjectURL(url);
          }
        }
        return runs;
      },
      {
        source: transferOptionsProbe.toString(),
        entry,
        installer: `/@fs${process.cwd()}/packages/runtime-js/src/ipc/worker-realm-compat.ts`,
      },
    );
    const native = [
      {
        variant: 'changing',
        transferReads: 1,
        reads: entry === 'clone' ? 0 : 1,
        outcome: 'DataCloneError',
        length: 3,
        bytes: [4, 8, 12],
      },
      {
        variant: 'once',
        transferReads: 1,
        reads: entry === 'clone' ? 0 : 1,
        outcome: 'sent',
        length: 0,
        bytes: [2, 5, 9],
      },
      {
        variant: 'invalid',
        reads: entry === 'clone' ? 0 : 1,
        transferReads: entry === 'clone' ? 1 : 0,
        outcome: entry === 'clone' ? 'sent' : 'TypeError',
        length: entry === 'clone' ? 0 : 3,
        bytes: entry === 'clone' ? [2, 5, 9] : null,
      },
    ];
    expect(results[0]).toEqual(native);
    expect(results[1]).toEqual(native);
  });
}
