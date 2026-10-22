import { execFileSync } from 'node:child_process';

// RSS samples are renderer process measurements, never sums of browser-wide shared pages.
export async function memoryProbe(browser, context, page, browserPid) {
  const pageCdp = await context.newCDPSession(page);
  const cdp = await browser.newBrowserCDPSession();
  const pending = new Map();
  let sequence = 1;
  cdp.on('Target.receivedMessageFromTarget', (event) => {
    const message = JSON.parse(event.message);
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
    else callback.resolve(message.result);
  });
  const call = (sessionId, method) =>
    new Promise((resolve, reject) => {
      const id = sequence++;
      pending.set(id, { resolve, reject });
      cdp
        .send('Target.sendMessageToTarget', {
          sessionId,
          message: JSON.stringify({ id, method, params: {} }),
        })
        .catch(reject);
    });
  function rss() {
    const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,rss=,args='], { encoding: 'utf8' })
      .split('\n')
      .flatMap((line) => {
        const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
        return m
          ? [
              {
                pid: +m[1],
                parent: +m[2],
                rssKiB: +m[3],
                type: m[4].match(/--type=([^ ]+)/)?.[1] ?? 'browser',
              },
            ]
          : [];
      });
    const included = new Set([browserPid]);
    let size;
    do {
      size = included.size;
      for (const row of rows) if (included.has(row.parent)) included.add(row.pid);
    } while (included.size !== size);
    const renderers = rows.filter((row) => included.has(row.pid) && row.type === 'renderer');
    if (renderers.length !== 1)
      throw new Error(`Expected one renderer, saw ${renderers.length}; refuse ambiguous RSS sum`);
    return {
      at: Date.now(),
      rendererRssBytes: renderers.reduce((sum, row) => sum + row.rssKiB * 1024, 0),
      renderers,
    };
  }
  async function retained(label) {
    const workers = [];
    for (const target of (await cdp.send('Target.getTargets')).targetInfos.filter((t) =>
      ['worker', 'service_worker'].includes(t.type),
    )) {
      let sessionId;
      try {
        ({ sessionId } = await cdp.send('Target.attachToTarget', {
          targetId: target.targetId,
          flatten: false,
        }));
        await call(sessionId, 'HeapProfiler.collectGarbage');
        workers.push({
          type: target.type,
          url: target.url,
          ...(await call(sessionId, 'Runtime.getHeapUsage')),
        });
      } catch (error) {
        if (!/No target|not attached|closed|No session|Session with given id/.test(String(error)))
          throw error;
      } finally {
        if (sessionId) await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
      }
    }
    await pageCdp.send('HeapProfiler.collectGarbage');
    const pageHeap = await pageCdp.send('Runtime.getHeapUsage');
    return { label, page: pageHeap, workers, ...rss() };
  }
  async function sampled(operation) {
    const samples = [rss()];
    const timer = setInterval(() => samples.push(rss()), 100);
    try {
      const value = await operation();
      samples.push(rss());
      return {
        value,
        samples,
        sampledMaxRendererRssBytes: Math.max(...samples.map((s) => s.rendererRssBytes)),
      };
    } finally {
      clearInterval(timer);
    }
  }
  return { retained, sampled };
}
